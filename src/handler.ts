import * as secp from "./lib/noble-secp256k1";


function setData(key, data) {
  return PRIVATE_STORE.put(key, data);
}

function getData(key) {
  return PRIVATE_STORE.get(key);
}


export async function handleTestRequest(request: Request): Promise<Response> {

  // const privateKey = "6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e";
  const messageHash = "9c1185a5c5e9fc54612808977ee8f548b2258d31";
  const publicKey = "04385c3a6ec0b9d57a4330dbd6284989be5bd00e41c535f9ca39b6ae7c521b81cd2443fef29e7f34aa8c8002eceaff422cd1f622bb4830714110e736044d8f084f"; //secp.getPublicKey(privateKey);
  const signature = "304402202a8d35a6725f54cec6d5e948fc9b26d19857d293af7ede2d38f2aa7671e12564022063d20f972923bc6b3748f19ccd73d49e21fe41a8dc6fb5c93f62480f19b561e4"; // await secp.sign(messageHash, privateKey);
  const isSigned = secp.verify(signature, messageHash, publicKey);

  return new Response(JSON.stringify({isSigned, signature, publicKey}));
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
    const method = jsonRequest.method;
    switch (method) {
      case 'db_getString':
        return handleGetString(jsonRequest);
      case 'db_putString':
        return handlePutString(jsonRequest);
      default:
        return new Response(`"${method}" not supported`, {status: 501});
    }
  } else {
    return handleTestRequest(request);
    // return new Response('please use jsonrpc POST request');
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
  let data;
  try {
    data = await getData(jsonRequest.params[1]);
  } catch (e) {
    return new Response(wrapRequest(jsonRequest, null, e));
  }
  return new Response(wrapRequest(jsonRequest, data));
}

function toTypedArray(hexString: string): ArrayBuffer {
  const matches = hexString
  .slice(2)
  .match(/..?/g);
  if (matches) {
    return new Uint8Array(
      matches
        .map(function (h: string) {
          return parseInt(h, 16);
        })
    ).buffer;
  }
  return new Uint8Array().buffer;
}

function str2ab(str: string) {
  str = str.slice(2);
  var buf = new ArrayBuffer(str.length / 2);
  var bufView = new Uint8Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i += 2) {
    bufView[i] = parseInt(str.slice(i, i + 2));
  }
  return buf;
}

async function handlePutString(jsonRequest: JSONRequest) {
  const invalidResponse = checkValidity(jsonRequest, 4);
  if (invalidResponse) {
    return invalidResponse;
  }
  const address = jsonRequest.params[1];
  const signature = jsonRequest.params[2];
  const data = jsonRequest.params[3];

  const validSignature = await crypto.subtle.verify(
    'ECDSA',
    address,
    str2ab(signature),
    data
  );

  if (!validSignature) {
    return new Response(wrapRequest(jsonRequest, null, 'invalid signature'));
  }

  try {
    await setData(address, data);
  } catch (e) {
    return new Response(wrapRequest(jsonRequest, null, e));
  }

  return new Response(wrapRequest(jsonRequest, true));
}

