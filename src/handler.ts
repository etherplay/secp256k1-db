import * as secp from "./lib/noble-secp256k1";

export async function handleRequest(request: Request): Promise<Response> {

  const privateKey = "6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e";
  const messageHash = "9c1185a5c5e9fc54612808977ee8f548b2258d31";
  const publicKey = secp.getPublicKey(privateKey);
  const signature = await secp.sign(messageHash, privateKey);
  const isSigned = secp.verify(signature, messageHash, publicKey);

  return new Response(JSON.stringify({isSigned}));
}
