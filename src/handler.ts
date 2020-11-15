import {recoverAddress} from '@ethersproject/transactions'

declare const PRIVATE_STORE: any;
declare const global: any;
function setData(key: string, data: string) {
  if (typeof PRIVATE_STORE === "undefined") {
    global.PRIVATE_STORE_DATA = {};
    global.PRIVATE_STORE = {
      put(key: string, value: string) {
        global.PRIVATE_STORE_DATA[key] = value;
      },
      get(key: string): string {
        return global.PRIVATE_STORE_DATA[key];
      }
    }
  }
  return PRIVATE_STORE.put(key, data);
}
function getData(key: string): string {
  return PRIVATE_STORE.get(key);
}

const test = {
  messageHash: "9c1185a5c5e9fc54612808977ee8f548b2258d31",
  publicKey: "0x04385c3a6ec0b9d57a4330dbd6284989be5bd00e41c535f9ca39b6ae7c521b81cd2443fef29e7f34aa8c8002eceaff422cd1f622bb4830714110e736044d8f084f",
  signature: "0x304402202a8d35a6725f54cec6d5e948fc9b26d19857d293af7ede2d38f2aa7671e12564022063d20f972923bc6b3748f19ccd73d49e21fe41a8dc6fb5c93f62480f19b561e4",
}

export async function handleTestRequest(request: Request): Promise<Response> {

  // const privateKey = "6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e";
  const messageHash = "9c1185a5c5e9fc54612808977ee8f548b2258d31";
  const publicKey = "04385c3a6ec0b9d57a4330dbd6284989be5bd00e41c535f9ca39b6ae7c521b81cd2443fef29e7f34aa8c8002eceaff422cd1f622bb4830714110e736044d8f084f"; //secp.getPublicKey(privateKey);
  const signature = "304402202a8d35a6725f54cec6d5e948fc9b26d19857d293af7ede2d38f2aa7671e12564022063d20f972923bc6b3748f19ccd73d49e21fe41a8dc6fb5c93f62480f19b561e4"; // await secp.sign(messageHash, privateKey);
  /*
  const signature = "
  30440220
  2a8d35a6725f54cec6d5e948fc9b26d19857d293af7ede2d38f2aa7671e12564
  0220
  63d20f972923bc6b3748f19ccd73d49e21fe41a8dc6fb5c93f62480f19b561e4"; // await secp.sign(messageHash, privateKey);
  const ethersSignature = '0x
  2a8d35a6725f54cec6d5e948fc9b26d19857d293af7ede2d38f2aa7671e12564
  63d20f972923bc6b3748f19ccd73d49e21fe41a8dc6fb5c93f62480f19b561e4
  1c'
  */


 const address = recoverAddress("0x" + messageHash, '0x2a8d35a6725f54cec6d5e948fc9b26d19857d293af7ede2d38f2aa7671e1256463d20f972923bc6b3748f19ccd73d49e21fe41a8dc6fb5c93f62480f19b561e41c');
 console.log({address});

 return new Response(JSON.stringify({address, signature, publicKey}));

  // const isSigned = secp.verify(signature, messageHash, publicKey);

  // return new Response(JSON.stringify({isSigned, signature, publicKey}));
}

type JSONRequest = {method: string; params: any[]; id:number;};

export async function handleRPC(request: Request): Promise<Response> {
  
  if (request.method === 'POST') {
    let jsonRequest;
    try {
      jsonRequest = await request.json();
    } catch (e) {
      return new Response(e, {status: 400});
    }
    if (request.url.indexOf("?test") !== -1) {
      jsonRequest.params = ["planet-wars", test.publicKey, test.signature, "dsdsd"]
    }
    const method = jsonRequest.method;
    switch (method) {
      case 'signedDB_getString':
        return handleGetString(jsonRequest);
      case 'signedDB_putString':
        return handlePutString(jsonRequest);
      default:
        return new Response(`"${method}" not supported`, {status: 501});
    }
  } else {
    if (request.url.indexOf("?test") !== -1) {
      return handleTestRequest(request);
    }
    return new Response('please use jsonrpc POST request');
  }
}

function checkValidity(jsonRequest: JSONRequest, numParams: number): Response | undefined {
  if (!jsonRequest.params || jsonRequest.params.length !== numParams) {
    return new Response('invalid request', {status: 400});
  }
  const db = jsonRequest.params[0];
  if (db !== 'planet-wars') {
    return new Response(`db ${db} not supported`, {status: 400});
  }
  const address = jsonRequest.params[1];
  if (typeof address !== 'string') {
    return new Response(`invalid address: not a string`, {status: 400});
  }
  if (!address.startsWith('0x')) {
    return new Response(`invalid address: not 0x prefix`, {status: 400});
  }
  if (address.length !== 42) {
    return new Response('invalid address length', {status: 400});
  }
  if (jsonRequest.params.length >= 3) {
    const signature = jsonRequest.params[2];
    if (typeof signature !== 'string') {
      return new Response(`invalid signature: not a string`, {status: 400});
    }
    if (!signature.startsWith('0x')) {
      return new Response(`invalid signature: not 0x prefix`, {status: 400});
    }
    if (signature.length !== 132) {
      return new Response('invalid signature length', {status: 400});
    }
  }
}

function wrapRequest(jsonRequest: JSONRequest, data: any, error?: any) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: jsonRequest.id,
    result: data === undefined ? null : data,
    error,
  });
}

async function handleGetString(jsonRequest: JSONRequest) {
  const invalidResponse = checkValidity(jsonRequest, 2);
  if (invalidResponse) {
    return invalidResponse;
  }
  const address = jsonRequest.params[1];

  let data;
  try {
    data = await getData(address.toLowerCase());
  } catch (e) {
    console.error(e);
    return new Response(wrapRequest(jsonRequest, null, e));
  }
  return new Response(wrapRequest(jsonRequest, data));
}

// function toTypedArray(hexString: string): ArrayBuffer {
//   const matches = hexString
//   .slice(2)
//   .match(/..?/g);
//   if (matches) {
//     return new Uint8Array(
//       matches
//         .map(function (h: string) {
//           return parseInt(h, 16);
//         })
//     ).buffer;
//   }
//   return new Uint8Array().buffer;
// }

// function str2ab(str: string) {
//   str = str.slice(2);
//   var buf = new ArrayBuffer(str.length / 2);
//   var bufView = new Uint8Array(buf);
//   for (var i = 0, strLen = str.length; i < strLen; i += 2) {
//     bufView[i] = parseInt(str.slice(i, i + 2));
//   }
//   return buf;
// }

const db = 'planet-wars';

function toHex(ab: ArrayBuffer) : string {
  const hashArray = Array.from(new Uint8Array(ab));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  return hashHex;
}

async function handlePutString(jsonRequest: JSONRequest) {
  const invalidResponse = checkValidity(jsonRequest, 4);
  if (invalidResponse) {
    return invalidResponse;
  }
  const address = jsonRequest.params[1];
  const signature = jsonRequest.params[2];
  const dataAsString = jsonRequest.params[3];

  let messageHash;
  try {
    messageHash = await hash256("db:" + db + ":" + dataAsString);
  } catch(e) {
    console.error(e);
    return new Response("could not hash message", {status: 400})
  }
  
  console.log("WORKER", {messageHash, signature, address});

  const authorized = await isAuthorized(address, messageHash, signature);

  if (!authorized) {
    return new Response(wrapRequest(jsonRequest, null, 'invalid signature'));
  }

  try {
    await setData(address.toLowerCase(), dataAsString);
  } catch (e) {
    console.error(e);
    return new Response(wrapRequest(jsonRequest, null, e));
  }

  return new Response(wrapRequest(jsonRequest, true));
}

async function hash256(dataAsString: string) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(dataAsString);
    return "0x" + toHex(await crypto.subtle.digest("SHA-256", data));
  } else {
    const nodeCrypto = await import("crypto");
    const hash = nodeCrypto.createHash('sha256');
    hash.update(dataAsString);
    return "0x" + hash.digest().toString("hex");
  }
}

// async function isAuthorized(address: string, msgHash: string, signature: string): Promise<boolean> {
//  return secp.verify(signature as any, new Uint8Array(messageHash), publicKey);
// }

async function isAuthorized(address: string, msgHash: string, signature: string): Promise<boolean> {
  let addressFromSignature
  try {
    addressFromSignature = recoverAddress(msgHash, signature);
  } catch(e) {
    return false;
  }
  return address.toLowerCase() == addressFromSignature.toLowerCase();
}