/*! noble-secp256k1 - MIT License (c) Paul Miller (paulmillr.com) */
'use strict';
// https://www.secg.org/sec2-v2.pdf
// Curve fomula is y^2 = x^3 + ax + b
const CURVE = {
  // Params: a, b
  a: BigInt(0),
  b: BigInt(7),
  // Field over which we'll do calculations
  P: BigInt(2) ** BigInt(256) - BigInt(2) ** BigInt(32) - BigInt(977),
  // Subgroup order aka prime_order
  n: BigInt(2) ** BigInt(256) - BigInt("432420386565659656852420866394968145599"),
  // Cofactor
  h: BigInt(1),
  // Base point (x, y) aka generator point
  Gx: BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240"),
  Gy: BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424"),

  // For endomorphism, see below.
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
};

const PRIME_SIZE = 256;
const P_DIV4_1 = (CURVE.P + BigInt(1)) / BigInt(4);

// Cleaner js output if that's on a separate line.
export { CURVE };

// Short weistrass curve formula.
// y**2 = x**3 + ax + b
// Returns sqrY
function weistrass(x: bigint) {
  const { a, b } = CURVE;
  return mod(x ** BigInt(3) + a * x + b);
}

type Hex = Uint8Array | string;
type PrivKey = Hex | bigint | number;
type PubKey = Hex | Point;
type Signature = Hex | SignResult;

// Note: cannot be reused for other curves when a != 0.
// If we're using Koblitz curve, we can improve efficiency by using endomorphism.
// Uses 2x less RAM, speeds up precomputation by 2x and ECDH / sign key recovery by 20%.
// Should always be used for Jacobian's double-and-add multiplication.
// For affines cached multiplication, it trades off 1/2 init time & 1/3 ram for 20% perf hit.
// https://gist.github.com/paulmillr/eb670806793e84df628a7c434a873066
const USE_ENDOMORPHISM = CURVE.a === BigInt(0);

// Default Point works in 2d / affine coordinates: (x, y)
// Jacobian Point works in 3d / jacobi coordinates: (x, y, z) ∋ (x=x/z^2, y=y/z^3)
// We're doing calculations in jacobi, because its operations don't require costly inversion.
class JacobianPoint {
  constructor(public x: bigint, public y: bigint, public z: bigint) {}

  static BASE = new JacobianPoint(CURVE.Gx, CURVE.Gy, BigInt(1));
  static ZERO = new JacobianPoint(BigInt(0), BigInt(1), BigInt(0));
  static fromAffine(p: Point): JacobianPoint {
    if (!(p instanceof Point)) {
      throw new TypeError('JacobianPoint#fromAffine: expected Point');
    }
    return new JacobianPoint(p.x, p.y, BigInt(1));
  }

  // Takes a bunch of Jacobian Points but executes only one
  // invert on all of them. invert is very slow operation,
  // so this improves performance massively.
  static toAffineBatch(points: JacobianPoint[]): Point[] {
    const toInv = invertBatch(points.map((p) => p.z));
    return points.map((p, i) => p.toAffine(toInv[i]));
  }

  static normalizeZ(points: JacobianPoint[]): JacobianPoint[] {
    return JacobianPoint.toAffineBatch(points).map(JacobianPoint.fromAffine);
  }

  // Compare one point to another.
  equals(other: JacobianPoint): boolean {
    const a = this;
    const b = other;
    const az2 = mod(a.z * a.z);
    const az3 = mod(a.z * az2);
    const bz2 = mod(b.z * b.z);
    const bz3 = mod(b.z * bz2);
    return mod(a.x * bz2) === mod(az2 * b.x) && mod(a.y * bz3) === mod(az3 * b.y);
  }

  // Flips point to one corresponding to (x, -y) in Affine coordinates.
  negate(): JacobianPoint {
    return new JacobianPoint(this.x, mod(-this.y), this.z);
  }

  // Fast algo for doubling 2 Jacobian Points when curve's a=0.
  // Note: cannot be reused for other curves when a != 0.
  // From: http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-0.html#doubling-dbl-2009-l
  // Cost: 2M + 5S + 6add + 3*2 + 1*3 + 1*8.
  double(): JacobianPoint {
    const X1 = this.x;
    const Y1 = this.y;
    const Z1 = this.z;
    const A = X1 ** BigInt(2);
    const B = Y1 ** BigInt(2);
    const C = B ** BigInt(2);
    const D = BigInt(2) * ((X1 + B) ** BigInt(2) - A - C);
    const E = BigInt(3) * A;
    const F = E ** BigInt(2);
    const X3 = mod(F - BigInt(2) * D);
    const Y3 = mod(E * (D - X3) - BigInt(8) * C);
    const Z3 = mod(BigInt(2) * Y1 * Z1);
    return new JacobianPoint(X3, Y3, Z3);
  }

  // Fast algo for adding 2 Jacobian Points when curve's a=0.
  // Note: cannot be reused for other curves when a != 0.
  // http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-0.html#addition-add-1998-cmo-2
  // Cost: 12M + 4S + 6add + 1*2.
  // Note: 2007 Bernstein-Lange (11M + 5S + 9add + 4*2) is actually *slower*. No idea why.
  add(other: JacobianPoint): JacobianPoint {
    if (!(other instanceof JacobianPoint)) {
      throw new TypeError('JacobianPoint#add: expected JacobianPoint');
    }
    const X1 = this.x;
    const Y1 = this.y;
    const Z1 = this.z;
    const X2 = other.x;
    const Y2 = other.y;
    const Z2 = other.z;
    if (X2 === BigInt(0) || Y2 === BigInt(0)) return this;
    if (X1 === BigInt(0) || Y1 === BigInt(0)) return other;
    const Z1Z1 = Z1 ** BigInt(2);
    const Z2Z2 = Z2 ** BigInt(2);
    const U1 = X1 * Z2Z2;
    const U2 = X2 * Z1Z1;
    const S1 = Y1 * Z2 * Z2Z2;
    const S2 = Y2 * Z1 * Z1Z1;
    const H = mod(U2 - U1);
    const r = mod(S2 - S1);
    // H = 0 meaning it's the same point.
    if (H === BigInt(0)) {
      if (r === BigInt(0)) {
        return this.double();
      } else {
        return JacobianPoint.ZERO;
      }
    }
    const HH = mod(H ** BigInt(2));
    const HHH = mod(H * HH);
    const V = U1 * HH;
    const X3 = mod(r ** BigInt(2) - HHH - BigInt(2) * V);
    const Y3 = mod(r * (V - X3) - S1 * HHH);
    const Z3 = mod(Z1 * Z2 * H);
    return new JacobianPoint(X3, Y3, Z3);
  }

  // Non-constant-time multiplication. Uses double-and-add algorithm.
  // It's faster, but should only be used when you don't care about
  // an exposed private key e.g. sig verification, which works over *public* keys.
  multiplyUnsafe(scalar: bigint): JacobianPoint {
    if (typeof scalar !== 'number' && typeof scalar !== 'bigint') {
      throw new TypeError('Point#multiply: expected number or bigint');
    }
    let n = mod(BigInt(scalar), CURVE.n);
    if (n <= 0) {
      throw new Error('Point#multiply: invalid scalar, expected positive integer');
    }
    if (!USE_ENDOMORPHISM) {
      let p = JacobianPoint.ZERO;
      let d: JacobianPoint = this;
      while (n > BigInt(0)) {
        if (n & BigInt(1)) p = p.add(d);
        d = d.double();
        n >>= BigInt(1);
      }
      return p;
    }
    let [k1neg, k1, k2neg, k2] = splitScalarEndo(n);
    let k1p = JacobianPoint.ZERO;
    let k2p = JacobianPoint.ZERO;
    let d: JacobianPoint = this;
    while (k1 > BigInt(0) || k2 > BigInt(0)) {
      if (k1 & BigInt(1)) k1p = k1p.add(d);
      if (k2 & BigInt(1)) k2p = k2p.add(d);
      d = d.double();
      k1 >>= BigInt(1);
      k2 >>= BigInt(1);
    }
    if (k1neg) k1p = k1p.negate();
    if (k2neg) k2p = k2p.negate();
    k2p = new JacobianPoint(mod(k2p.x * CURVE.beta), k2p.y, k2p.z);
    return k1p.add(k2p);
  }

  private precomputeWindow(W: number): JacobianPoint[] {
    const windows = USE_ENDOMORPHISM ? 128 / W + 2 : 256 / W + 1;
    let points: JacobianPoint[] = [];
    let p: JacobianPoint = this;
    let base = p;
    for (let window = 0; window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1; i < 2 ** (W - 1); i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }

  private wNAF(n: bigint, affinePoint?: Point): [JacobianPoint, JacobianPoint] {
    if (!affinePoint && this.equals(JacobianPoint.BASE)) affinePoint = Point.BASE;
    const W = (affinePoint && affinePoint._WINDOW_SIZE) || 1;
    if (256 % W) {
      throw new Error('Point#wNAF: Invalid precomputation window, must be power of 2');
    }

    let precomputes = affinePoint && pointPrecomputes.get(affinePoint);
    if (!precomputes) {
      precomputes = this.precomputeWindow(W);
      if (affinePoint && W !== 1) {
        precomputes = JacobianPoint.normalizeZ(precomputes);
        pointPrecomputes.set(affinePoint, precomputes);
      }
    }

    let p = JacobianPoint.ZERO;
    let f = JacobianPoint.ZERO;

    const windows = USE_ENDOMORPHISM ? 128 / W + 2 : 256 / W + 1;
    const windowSize = 2 ** (W - 1);
    const mask = BigInt(2 ** W - 1); // Create mask with W ones: 0b1111 for W=4 etc.
    const maxNumber = 2 ** W;
    const shiftBy = BigInt(W);

    for (let window = 0; window < windows; window++) {
      const offset = window * windowSize;
      // Extract W bits.
      let wbits = Number(n & mask);

      // Shift number by W bits.
      n >>= shiftBy;

      // If the bits are bigger than max size, we'll split those.
      // +224 => 256 - 32
      if (wbits > windowSize) {
        wbits -= maxNumber;
        n += BigInt(1);
      }

      // Check if we're onto Zero point.
      // Add random point inside current window to f.
      if (wbits === 0) {
        f = f.add(window % 2 ? precomputes[offset].negate() : precomputes[offset]);
      } else {
        const cached = precomputes[offset + Math.abs(wbits) - 1];
        p = p.add(wbits < 0 ? cached.negate() : cached);
      }
    }
    return [p, f];
  }

  // Constant time multiplication.
  // Uses wNAF method. Windowed method may be 10% faster,
  // but takes 2x longer to generate and consumes 2x memory.
  multiply(scalar: number | bigint, affinePoint?: Point): JacobianPoint {
    if (typeof scalar !== 'number' && typeof scalar !== 'bigint') {
      throw new TypeError('Point#multiply: expected number or bigint');
    }
    let n = mod(BigInt(scalar), CURVE.n);
    if (n <= 0) {
      throw new Error('Point#multiply: invalid scalar, expected positive integer');
    }
    // Real point.
    let point: JacobianPoint;
    // Fake point, we use it to achieve constant-time multiplication.
    let fake: JacobianPoint;
    if (USE_ENDOMORPHISM) {
      const [k1neg, k1, k2neg, k2] = splitScalarEndo(n);
      let k1p, k2p, f1p, f2p;
      [k1p, f1p] = this.wNAF(k1, affinePoint);
      [k2p, f2p] = this.wNAF(k2, affinePoint);
      if (k1neg) k1p = k1p.negate();
      if (k2neg) k2p = k2p.negate();
      k2p = new JacobianPoint(mod(k2p.x * CURVE.beta), k2p.y, k2p.z);
      [point, fake] = [k1p.add(k2p), f1p.add(f2p)];
    } else {
      [point, fake] = this.wNAF(n, affinePoint);
    }
    return JacobianPoint.normalizeZ([point, fake])[0];
  }

  // Converts Jacobian point to default (x, y) coordinates.
  // Can accept precomputed Z^-1 - for example, from invertBatch.
  toAffine(invZ: bigint = invert(this.z)): Point {
    const invZ2 = invZ ** BigInt(2);
    const x = mod(this.x * invZ2);
    const y = mod(this.y * invZ2 * invZ);
    return new Point(x, y);
  }
}

// Stores precomputed values for points.
const pointPrecomputes = new WeakMap<Point, JacobianPoint[]>();

// Default Point works in default aka affine coordinates: (x, y)
export class Point {
  // Base point aka generator
  // public_key = Point.BASE * private_key
  static BASE: Point = new Point(CURVE.Gx, CURVE.Gy);
  // Identity point aka point at infinity
  // point = point + zero_point
  static ZERO: Point = new Point(BigInt(0), BigInt(0));
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  _WINDOW_SIZE?: number;

  constructor(public x: bigint, public y: bigint) {}

  // "Private method", don't use it directly.
  _setWindowSize(windowSize: number) {
    this._WINDOW_SIZE = windowSize;
    pointPrecomputes.delete(this);
  }

  private static fromCompressedHex(bytes: Uint8Array) {
    if (bytes.length !== 33) {
      throw new TypeError(`Point.fromHex: compressed expects 66 bytes, not ${bytes.length * 2}`);
    }
    const x = bytesToNumber(bytes.slice(1));
    const sqrY = weistrass(x);
    let y = powMod(sqrY, P_DIV4_1, CURVE.P);
    const isFirstByteOdd = (bytes[0] & 1) === 1;
    const isYOdd = (y & BigInt(1)) === BigInt(1);
    if (isFirstByteOdd !== isYOdd) {
      y = mod(-y);
    }
    const point = new Point(x, y);
    point.assertValidity();
    return point;
  }

  private static fromUncompressedHex(bytes: Uint8Array) {
    if (bytes.length !== 65) {
      throw new TypeError(`Point.fromHex: uncompressed expects 130 bytes, not ${bytes.length * 2}`);
    }
    const x = bytesToNumber(bytes.slice(1, 33));
    const y = bytesToNumber(bytes.slice(33));
    const point = new Point(x, y);
    point.assertValidity();
    return point;
  }

  // Converts hash string or Uint8Array to Point.
  static fromHex(hex: Hex) {
    const bytes = hex instanceof Uint8Array ? hex : hexToArray(hex);
    const header = bytes[0];
    if (header === 0x02 || header === 0x03) return this.fromCompressedHex(bytes);
    if (header === 0x04) return this.fromUncompressedHex(bytes);
    throw new TypeError('Point.fromHex: received invalid point');
  }

  // Multiplies generator point by privateKey.
  static fromPrivateKey(privateKey: PrivKey) {
    return Point.BASE.multiply(normalizePrivateKey(privateKey));
  }

  // Recovers public key from ECDSA signature.
  // TODO: Ensure proper hash length
  // Uses following formula:
  // Q = (r ** -1)(sP - hG)
  // https://crypto.stackexchange.com/questions/60218
  static fromSignature(msgHash: Hex, signature: Signature, recovery: number): Point | undefined {
    const sign = normalizeSignature(signature);
    const { r, s } = sign;
    if (r === BigInt(0) || s === BigInt(0)) return;
    const rinv = invert(r, CURVE.n);
    const h = typeof msgHash === 'string' ? hexToNumber(msgHash) : bytesToNumber(msgHash);
    const P_ = Point.fromHex(`0${2 + (recovery & 1)}${pad64(r)}`);
    const sP = JacobianPoint.fromAffine(P_).multiplyUnsafe(s);
    const hG = JacobianPoint.BASE.multiply(h).negate();
    const Q = sP.add(hG).multiplyUnsafe(rinv);
    const point = Q.toAffine();
    point.assertValidity();
    return point;
  }

  toRawBytes(isCompressed = false) {
    return hexToArray(this.toHex(isCompressed));
  }

  toHex(isCompressed = false) {
    const x = pad64(this.x);
    if (isCompressed) {
      return `${this.y & BigInt(1) ? '03' : '02'}${x}`;
    } else {
      return `04${x}${pad64(this.y)}`;
    }
  }

  // A point on curve is valid if it conforms to equation.
  assertValidity(): void {
    const { x, y } = this;
    if (x === BigInt(0) || y === BigInt(0) || x >= CURVE.P || y >= CURVE.P) {
      throw new TypeError('Point is not on elliptic curve');
    }
    const left = mod(y * y);
    const right = weistrass(x);
    const valid = (left - right) % CURVE.P === BigInt(0);
    if (!valid) throw new TypeError('Point is not on elliptic curve');
  }

  equals(other: Point): boolean {
    return this.x === other.x && this.y === other.y;
  }

  negate() {
    return new Point(this.x, mod(-this.y));
  }

  double() {
    return JacobianPoint.fromAffine(this).double().toAffine();
  }

  add(other: Point) {
    return JacobianPoint.fromAffine(this).add(JacobianPoint.fromAffine(other)).toAffine();
  }

  subtract(other: Point) {
    return this.add(other.negate());
  }

  multiply(scalar: number | bigint) {
    return JacobianPoint.fromAffine(this).multiply(scalar, this).toAffine();
  }
}

function sliceDer(s: string): string {
  // Proof: any([(i>=0x80) == (int(hex(i).replace('0x', '').zfill(2)[0], 16)>=8)  for i in range(0, 256)])
  // Padding done by numberToHex
  return parseInt(s[0], 16) >= 8 ? '00' + s : s;
}

export class SignResult {
  constructor(public r: bigint, public s: bigint) {}

  // DER encoded ECDSA signature
  // https://bitcoin.stackexchange.com/questions/57644/what-are-the-parts-of-a-bitcoin-transaction-input-script
  static fromHex(hex: Hex) {
    // `30${length}02${rLen}${rHex}02${sLen}${sHex}`
    const str = hex instanceof Uint8Array ? bytesToHex(hex) : hex;
    if (typeof str !== 'string') throw new TypeError({}.toString.call(hex));

    const check1 = str.slice(0, 2);
    const length = parseByte(str.slice(2, 4));
    const check2 = str.slice(4, 6);
    if (check1 !== '30' || length !== str.length - 4 || check2 !== '02') {
      throw new Error('SignResult.fromHex: Invalid signature');
    }

    // r
    const rLen = parseByte(str.slice(6, 8));
    const rEnd = 8 + rLen;
    const r = hexToNumber(str.slice(8, rEnd));

    // s
    const check3 = str.slice(rEnd, rEnd + 2);
    if (check3 !== '02') {
      throw new Error('SignResult.fromHex: Invalid signature');
    }
    const sLen = parseByte(str.slice(rEnd + 2, rEnd + 4));
    const sStart = rEnd + 4;
    const s = hexToNumber(str.slice(sStart, sStart + sLen));

    return new SignResult(r, s);
  }

  toRawBytes(isCompressed = false) {
    return hexToArray(this.toHex(isCompressed));
  }

  toHex(isCompressed = false) {
    const sHex = sliceDer(numberToHex(this.s));
    if (isCompressed) return sHex;
    const rHex = sliceDer(numberToHex(this.r));
    const rLen = numberToHex(rHex.length / 2);
    const sLen = numberToHex(sHex.length / 2);
    const length = numberToHex(rHex.length / 2 + sHex.length / 2 + 4);
    return `30${length}02${rLen}${rHex}02${sLen}${sHex}`;
  }
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 1) return arrays[0];
  const length = arrays.reduce((a, arr) => a + arr.length, 0);
  const result = new Uint8Array(length);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const arr = arrays[i];
    result.set(arr, pad);
    pad += arr.length;
  }
  return result;
}

// Convert between types
// ---------------------
function bytesToHex(uint8a: Uint8Array): string {
  // pre-caching chars could speed this up 6x.
  let hex = '';
  for (let i = 0; i < uint8a.length; i++) {
    hex += uint8a[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function pad64(num: number | bigint): string {
  return num.toString(16).padStart(64, '0');
}

function numberToHex(num: number | bigint): string {
  const hex = num.toString(16);
  return hex.length & 1 ? `0${hex}` : hex;
}

function hexToNumber(hex: string): bigint {
  if (typeof hex !== 'string') {
    throw new TypeError('hexToNumber: expected string, got ' + typeof hex);
  }
  // Big Endian
  return BigInt(`0x${hex}`);
}

function hexToArray(hex: string): Uint8Array {
  hex = hex.length & 1 ? `0${hex}` : hex;
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    let j = i * 2;
    array[i] = Number.parseInt(hex.slice(j, j + 2), 16);
  }
  return array;
}

// Big Endian
function bytesToNumber(bytes: Uint8Array): bigint {
  return hexToNumber(bytesToHex(bytes));
}

function parseByte(str: string): number {
  return Number.parseInt(str, 16) * 2;
}

// -------------------------

function mod(a: bigint, b: bigint = CURVE.P): bigint {
  const result = a % b;
  return result >= 0 ? result : b + result;
}

function powMod(x: bigint, power: bigint, order: bigint) {
  let res = BigInt(1);
  while (power > 0) {
    if (power & BigInt(1)) {
      res = mod(res * x, order);
    }
    power >>= BigInt(1);
    x = mod(x * x, order);
  }
  return res;
}

// Eucledian GCD
// https://brilliant.org/wiki/extended-euclidean-algorithm/
function egcd(a: bigint, b: bigint) {
  let [x, y, u, v] = [BigInt(0), BigInt(1), BigInt(1), BigInt(0)];
  while (a !== BigInt(0)) {
    let q = b / a;
    let r = b % a;
    let m = x - u * q;
    let n = y - v * q;
    [b, a] = [a, r];
    [x, y] = [u, v];
    [u, v] = [m, n];
  }
  const gcd = b;
  return [gcd, x, y];
}

function invert(number: bigint, modulo: bigint = CURVE.P) {
  if (number === BigInt(0) || modulo <= BigInt(0)) {
    throw new Error('invert: expected positive integers');
  }
  const [gcd, x] = egcd(mod(number, modulo), modulo);
  if (gcd !== BigInt(1)) {
    throw new Error('invert: does not exist');
  }
  return mod(x, modulo);
}

function invertBatch(nums: bigint[], n: bigint = CURVE.P): bigint[] {
  const len = nums.length;
  const scratch = new Array(len);
  let acc = BigInt(1);
  for (let i = 0; i < len; i++) {
    if (nums[i] === BigInt(0)) continue;
    scratch[i] = acc;
    acc = mod(acc * nums[i], n);
  }
  acc = invert(acc, n);
  for (let i = len - 1; i >= 0; i--) {
    if (nums[i] === BigInt(0)) continue;
    let tmp = mod(acc * nums[i], n);
    nums[i] = mod(acc * scratch[i], n);
    acc = tmp;
  }
  return nums;
}

// Split 256-bit K into 2 128-bit (k1, k2) for which k1 + k2 * lambda = K.
// Used for endomorphism.
// https://gist.github.com/paulmillr/eb670806793e84df628a7c434a873066
function splitScalarEndo(k: bigint): [boolean, bigint, boolean, bigint] {
  const { n } = CURVE;
  const a1 = BigInt("0x3086d221a7d46bcde86c90e49284eb15");
  const b1 = BigInt("-303414439467246543595250775667605759171");
  const a2 = BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8");
  const b2 = a1;
  const c1 = (b2 * k) / n;
  const c2 = (-b1 * k) / n;
  const k1 = k - c1 * a1 - c2 * a2;
  const k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < 0;
  const k2neg = k2 < 0;
  // let lambda = 0x5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72n;
  return [k1neg, k1neg ? -k1 : k1, k2neg, k2neg ? -k2 : k2];
}

function truncateHash(hash: string | Uint8Array): bigint {
  hash = typeof hash === 'string' ? hash : bytesToHex(hash);
  let msg = hexToNumber(hash || '0');
  const delta = (hash.length / 2) * 8 - PRIME_SIZE;
  if (delta > 0) {
    msg = msg >> BigInt(delta);
  }
  if (msg >= CURVE.n) {
    msg -= CURVE.n;
  }
  return msg;
}

type QRS = [Point, bigint, bigint];

// Deterministic k generation as per RFC6979.
// Generates k, and then calculates Q & Signature {r, s} based on it.
// https://tools.ietf.org/html/rfc6979#section-3.1
async function getQRSrfc6979(msgHash: Hex, privateKey: bigint) {
  // Step A is ignored, since we already provide hash instead of msg
  const num = typeof msgHash === 'string' ? hexToNumber(msgHash) : bytesToNumber(msgHash);
  const h1 = hexToArray(pad64(num));
  const x = hexToArray(pad64(privateKey));
  const h1n = bytesToNumber(h1);

  // Step B
  let v = new Uint8Array(32).fill(1);
  // Step C
  let k = new Uint8Array(32).fill(0);
  const b0 = Uint8Array.from([0x00]);
  const b1 = Uint8Array.from([0x01]);

  // Step D
  k = await utils.hmacSha256(k, v, b0, x, h1);
  // Step E
  v = await utils.hmacSha256(k, v);
  // Step F
  k = await utils.hmacSha256(k, v, b1, x, h1);
  // Step G
  v = await utils.hmacSha256(k, v);

  // Step H3, repeat until 1 < T < n - 1
  for (let i = 0; i < 1000; i++) {
    v = await utils.hmacSha256(k, v);
    const T = bytesToNumber(v);
    let qrs: QRS;
    if (isValidPrivateKey(T) && (qrs = calcQRSFromK(T, h1n, privateKey)!)) {
      return qrs;
    }
    k = await utils.hmacSha256(k, v, b0);
    v = await utils.hmacSha256(k, v);
  }

  throw new TypeError('secp256k1: Tried 1,000 k values for sign(), all were invalid');
}

function isValidPrivateKey(privateKey: bigint): boolean {
  return 0 < privateKey && privateKey < CURVE.n;
}

function calcQRSFromK(k: bigint, msg: bigint, priv: bigint): QRS | undefined {
  const max = CURVE.n;
  const q = Point.BASE.multiply(k);
  const r = mod(q.x, max);
  const s = mod(invert(k, max) * (msg + r * priv), max);
  if (r === BigInt(0) || s === BigInt(0)) return;
  return [q, r, s];
}

function normalizePrivateKey(privateKey: PrivKey): bigint {
  if (!privateKey) throw new Error(`Expected receive valid private key, not "${privateKey}"`);
  let key: bigint;
  if (privateKey instanceof Uint8Array) {
    key = bytesToNumber(privateKey);
  } else if (typeof privateKey === 'string') {
    key = hexToNumber(privateKey);
  } else {
    key = BigInt(privateKey);
  }
  return key;
}

function normalizePublicKey(publicKey: PubKey): Point {
  return publicKey instanceof Point ? publicKey : Point.fromHex(publicKey);
}

function normalizeSignature(signature: Signature): SignResult {
  return signature instanceof SignResult ? signature : SignResult.fromHex(signature);
}

export function getPublicKey(
  privateKey: Uint8Array | bigint | number,
  isCompressed?: boolean
): Uint8Array;
export function getPublicKey(privateKey: string, isCompressed?: boolean): string;
export function getPublicKey(privateKey: PrivKey, isCompressed = false): PubKey {
  const point = Point.fromPrivateKey(privateKey);
  if (typeof privateKey === 'string') {
    return point.toHex(isCompressed);
  }
  return point.toRawBytes(isCompressed);
}

export function recoverPublicKey(
  msgHash: string,
  signature: string,
  recovery: number
): string | undefined;
export function recoverPublicKey(
  msgHash: Uint8Array,
  signature: Uint8Array,
  recovery: number
): Uint8Array | undefined;
export function recoverPublicKey(
  msgHash: Hex,
  signature: Signature,
  recovery: number
): Hex | undefined {
  const point = Point.fromSignature(msgHash, signature, recovery);
  if (!point) return;
  return typeof msgHash === 'string' ? point.toHex() : point.toRawBytes();
}

function isPub(item: PrivKey | PubKey): boolean {
  const arr = item instanceof Uint8Array;
  const str = typeof item === 'string';
  const len = (arr || str) && (item as Hex).length;
  if (arr) return len === 33 || len === 65;
  if (str) return len === 66 || len === 130;
  if (item instanceof Point) return true;
  return false;
}

// ECDH (Elliptic Curve Diffie Hellman) implementation.
export function getSharedSecret(privateA: PrivKey, publicB: PubKey, isCompressed = false): Hex {
  if (isPub(privateA) && !isPub(publicB)) {
    [privateA, publicB] = [publicB as PrivKey, privateA as PubKey];
  } else if (!isPub(publicB)) {
    throw new Error('Received invalid keys');
  }
  const b = publicB instanceof Point ? publicB : Point.fromHex(publicB);
  b.assertValidity();
  const shared = b.multiply(normalizePrivateKey(privateA));
  return typeof privateA === 'string'
    ? shared.toHex(isCompressed)
    : shared.toRawBytes(isCompressed);
}

type OptsRecovered = { recovered: true; canonical?: true };
type OptsNoRecovered = { recovered?: false; canonical?: true };
type Opts = { recovered?: boolean; canonical?: true };

export async function sign(
  msgHash: Uint8Array,
  privateKey: PrivKey,
  opts: OptsRecovered
): Promise<[Uint8Array, number]>;
export async function sign(
  msgHash: string,
  privateKey: PrivKey,
  opts: OptsRecovered
): Promise<[string, number]>;
export async function sign(
  msgHash: Uint8Array,
  privateKey: PrivKey,
  opts?: OptsNoRecovered
): Promise<Uint8Array>;
export async function sign(
  msgHash: string,
  privateKey: PrivKey,
  opts?: OptsNoRecovered
): Promise<string>;
export async function sign(
  msgHash: string,
  privateKey: PrivKey,
  opts?: OptsNoRecovered
): Promise<string>;
export async function sign(
  msgHash: Hex,
  privateKey: PrivKey,
  { recovered, canonical }: Opts = {}
): Promise<Hex | [Hex, number]> {
  if (msgHash == null) throw new Error(`Expected valid msgHash, not "${msgHash}"`);
  const priv = normalizePrivateKey(privateKey);
  // We are using deterministic signature scheme
  // instead of letting user specify random `k`.
  const [q, r, s] = await getQRSrfc6979(msgHash, priv);

  let recovery = (q.x === r ? 0 : 2) | Number(q.y & BigInt(1));
  let adjustedS = s;
  const HIGH_NUMBER = CURVE.n >> BigInt(1);
  if (s > HIGH_NUMBER && canonical) {
    adjustedS = CURVE.n - s;
    recovery ^= 1;
  }
  const sig = new SignResult(r, adjustedS);
  const hashed = typeof msgHash === 'string' ? sig.toHex() : sig.toRawBytes();
  return recovered ? [hashed, recovery] : hashed;
}

export function verify(signature: Signature, msgHash: Hex, publicKey: PubKey): boolean {
  const h = truncateHash(msgHash);
  const { r, s } = normalizeSignature(signature);
  const pubKey = JacobianPoint.fromAffine(normalizePublicKey(publicKey));
  const s1 = invert(s, CURVE.n);
  const Ghs1 = JacobianPoint.BASE.multiply(mod(h * s1, CURVE.n));
  const Prs1 = pubKey.multiplyUnsafe(mod(r * s1, CURVE.n));
  const res = Ghs1.add(Prs1).toAffine();
  return res.x === r;
}

// Enable precomputes. Slows down first publicKey computation by 20ms.
Point.BASE._setWindowSize(8);

export const utils = {
  isValidPrivateKey(privateKey: PrivKey) {
    return isValidPrivateKey(normalizePrivateKey(privateKey));
  },

  randomPrivateKey: (bytesLength: number = 32): Uint8Array => {
    // @ts-ignore
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  },

  hmacSha256: async (key: Uint8Array, ...messages: Uint8Array[]): Promise<Uint8Array> => {
    // @ts-ignore
    const ckey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: { name: 'SHA-256' } },
        false,
        ['sign', 'verify']
    );
    const message = concatBytes(...messages);
    // @ts-ignore
    const buffer = await crypto.subtle.sign('HMAC', ckey, message);
    return new Uint8Array(buffer);
      // @ts-ignore
    
  },

  precompute(windowSize = 8, point = Point.BASE): Point {
    const cached = point === Point.BASE ? point : new Point(point.x, point.y);
    cached._setWindowSize(windowSize);
    cached.multiply(BigInt(3));
    return cached;
  },
};