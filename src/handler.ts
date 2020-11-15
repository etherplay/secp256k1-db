import {recoverAddress} from '@ethersproject/transactions'

declare const PRIVATE_STORE: any;
declare const global: any;
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
function setData(key: string, data: string, timestamp: BigInt) {
  const dataToStore = JSON.stringify({data, timestamp: timestamp.toString()}); 
  return PRIVATE_STORE.put(key, dataToStore);
}
async function getData(key: string): Promise<{data: string; timestamp: string;} | null> {
  const str = await PRIVATE_STORE.get(key);
  if (!str) {
    return null;
  }
  return JSON.parse(str);
}

const namespace = 'planet-wars';

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
      case 'wallet_getString':
        return handleGetString(jsonRequest);
      case 'wallet_putString':
        return handlePutString(jsonRequest);
      default:
        return new Response(wrapRequest(jsonRequest, null, `"${method}" not supported`, "all"));
    }
  } else {
    return new Response('please use jsonrpc POST request');
  }
}

type ParsedRequest = {
  namespace: string;
  address: string;
}

type ParsedReadRequest = ParsedRequest;

type ParsedWriteRequest = ParsedRequest & {
  signature: string;
  data: string;
  timestamp: BigInt;
}

function parseReadRequest(jsonRequest: JSONRequest, numParams?: number): ParsedReadRequest {
  if (numParams && (!jsonRequest.params || jsonRequest.params.length !== numParams)) {
    throw new Error(`invalid number of parameters, expected ${numParams}, receiped ${jsonRequest.params ? jsonRequest.params.length: 'none'}`);
  }
  const address = jsonRequest.params[0];
  if (typeof address !== 'string') {
    throw new Error(`invalid address: not a string`);
  }
  if (!address.startsWith('0x')) {
    throw new Error(`invalid address: not 0x prefix`);
  }
  if (address.length !== 42) {
    throw new Error('invalid address length');
  }
  const namespace = jsonRequest.params[1];
  if (typeof namespace !== 'string') {
    throw new Error(`invalid namespace: not a string`);
  }
  if (namespace.length === 0) {
    throw new Error('invalid namespace length');
  }

  return {address, namespace};
}

function parseWriteRequest(jsonRequest: JSONRequest): ParsedWriteRequest {
  if (!jsonRequest.params || jsonRequest.params.length !== 5) {
    throw new Error(`invalid number of parameters, expected 5, receiped ${jsonRequest.params ? jsonRequest.params.length: 'none'}`);
  }
  const {namespace, address} = parseReadRequest(jsonRequest);

  const timestampMs = jsonRequest.params[2];
  if (typeof timestampMs !== 'string') {
    throw new Error(`invalid timestampMs: not a string`);
  }
  const timestamp = BigInt(timestampMs);

  const data = jsonRequest.params[3];
  if (typeof data !== 'string') {
    throw new Error(`invalid data: not a string`);
  }

  const signature = jsonRequest.params[4];
  if (typeof signature !== 'string') {
    throw new Error(`invalid signature: not a string`);
  }
  if (!signature.startsWith('0x')) {
    throw new Error(`invalid signature: not 0x prefix`);
  }
  if (signature.length !== 132) {
    throw new Error('invalid signature length');
  }
  return {namespace, address, signature, data, timestamp}
}

type Usage = "wallet_putString" | "wallet_getString" | "all";

function wrapRequest(jsonRequest: JSONRequest, data: any, error?: any, usage?: Usage) {
  if (usage && error) {
    if (usage === "wallet_getString" || usage === "all") {
      error = `${error}\n{"method":"wallet_getString", "params":["<address>","<namespace>"]`;  
    }
    if (usage === "wallet_putString" || usage === "all") {
      error = `${error}\n{"method":"wallet_putString", "params":["<address>","<namespace>","<timestampMs>","<data>","<signature>"]}`;
    }
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id: jsonRequest.id,
    result: data === undefined ? null : data,
    error,
  });
}

async function handleGetString(jsonRequest: JSONRequest) {
  let request: ParsedReadRequest;
  try {
    request = parseReadRequest(jsonRequest, 2);
  } catch(e) {
    console.error(e);
    return new Response(wrapRequest(jsonRequest, null, e, "wallet_getString"));
  }

  if (request.namespace !== namespace) {
    return new Response(wrapRequest(jsonRequest, null, `namespace "${request.namespace}" not supported`));
  }
  
  let data;
  try {
    data = await getData(request.address.toLowerCase());
  } catch (e) {
    console.error(e);
    return new Response(wrapRequest(jsonRequest, null, e));
  }
  return new Response(wrapRequest(jsonRequest, data? data.data: null));
}

function toHex(ab: ArrayBuffer) : string {
  const hashArray = Array.from(new Uint8Array(ab));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  return hashHex;
}

async function handlePutString(jsonRequest: JSONRequest) {
  let request: ParsedWriteRequest;
  try {
    request = parseWriteRequest(jsonRequest);
  } catch(e) {
    return new Response(wrapRequest(jsonRequest, null, e, "wallet_putString"));
  }

  if (request.namespace !== namespace) {
    return new Response(wrapRequest(jsonRequest, null, `namespace "${request.namespace}" not supported`));
  }
  
  let messageHash;
  try {
    messageHash = await hash256("put:" + request.namespace + ":" + request.timestamp + ":" + request.data);
  } catch(e) {
    console.error(e);
    return new Response(wrapRequest(jsonRequest, null, e));
  }

  const authorized = await isAuthorized(request.address, messageHash, request.signature);

  if (!authorized) {
    return new Response(wrapRequest(jsonRequest, null, 'invalid signature'));
  }

  
  try {
    const currentData = await getData(request.address.toLowerCase());
    if (currentData && request.timestamp <= BigInt(currentData.timestamp)) {
      return new Response(wrapRequest(jsonRequest, null, `cannot override with older/same timestamp`));  
    }
    const now = Date.now();
    if (request.timestamp > BigInt(now)) {
      return new Response(wrapRequest(jsonRequest, null, `cannot use future timestamp`));  
    }
    await setData(request.address.toLowerCase(), request.data, request.timestamp);
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

async function isAuthorized(address: string, msgHash: string, signature: string): Promise<boolean> {
  let addressFromSignature
  try {
    addressFromSignature = recoverAddress(msgHash, signature);
  } catch(e) {
    return false;
  }
  return address.toLowerCase() == addressFromSignature.toLowerCase();
}