import { verifyMessage } from '@ethersproject/wallet';
import { Env } from '.';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  "Access-Control-Allow-Headers": "Content-Type",
  'Access-Control-Max-Age': '86400',
};

async function setData(
	env: Env,
	namespace: string,
	key: string,
	data: string,
	counter: BigInt,
	signature: string
): Promise<{ data: string; counter: string }> {
	key = ((namespace && namespace !== '') ? namespace + "_": "") + key;
	const obj = { data, counter: counter.toString(), signature};
	const dataToStore = JSON.stringify(obj);
	await env.PRIVATE_STORE.put(key, dataToStore);
	return obj;
}
async function getData(
	env: Env,
	namespace: string,
	key: string
): Promise<{ data: string; counter: string; signature: string; }> {
	key = ((namespace && namespace !== '') ? namespace + "_": "") + key;
	const str = await env.PRIVATE_STORE.get(key);
	if (!str) {
		return {
			data: '',
			counter: '0',
			signature: ''
		};
	}
	return JSON.parse(str);
}

type JSONRequest = { method: string; params: any[]; id: number };

function handleOptions(request: Request) {
  if (request.headers.get("Origin") !== null &&
      request.headers.get("Access-Control-Request-Method") !== null &&
      request.headers.get("Access-Control-Request-Headers") !== null) {
    // Handle CORS pre-flight request.
    return new Response(null, {
      headers: corsHeaders
    })
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        "Allow": "GET, HEAD, POST, OPTIONS",
      }
    })
  }
}

export async function handleRPC(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  } else if (request.method === 'POST') {
    let jsonRequest: JSONRequest;
    try {
      jsonRequest = await request.json();
    } catch (e: any) {
      return new Response(e, { status: 400 });
    }
    const method = jsonRequest.method;
    switch (method) {
      case 'wallet_getString':
        return handleGetString(jsonRequest, env);
      case 'wallet_putString':
        return handlePutString(jsonRequest, env);
      default:
        return wrapResponse(
          jsonRequest,
          null,
          `"${method}" not supported`,
          'all'
        );
    }
  } else {
    return new Response('please use jsonrpc POST request');
  }
}

type ParsedRequest = {
  namespace: string;
  address: string;
};

type ParsedReadRequest = ParsedRequest;

type ParsedWriteRequest = ParsedRequest & {
  signature: string;
  data: string;
  counter: bigint;
};

function parseReadRequest(
  jsonRequest: JSONRequest,
  numParams?: number
): ParsedReadRequest {
  if (
    numParams &&
    (!jsonRequest.params || jsonRequest.params.length !== numParams)
  ) {
    throw new Error(
      `invalid number of parameters, expected ${numParams}, receiped ${
        jsonRequest.params ? jsonRequest.params.length : 'none'
      }`
    );
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

  return { address, namespace };
}

function parseWriteRequest(jsonRequest: JSONRequest): ParsedWriteRequest {
  if (!jsonRequest.params || jsonRequest.params.length !== 5) {
    throw new Error(
      `invalid number of parameters, expected 5, receiped ${
        jsonRequest.params ? jsonRequest.params.length : 'none'
      }`
    );
  }
  const { namespace, address } = parseReadRequest(jsonRequest);

  const counterMs = jsonRequest.params[2];
  if (typeof counterMs !== 'string') {
    throw new Error(`invalid counter: not a string`);
  }
  const counter = BigInt(counterMs);

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
  return { namespace, address, signature, data, counter };
}

type Usage = 'wallet_putString' | 'wallet_getString' | 'all';

function wrapRequest(
  jsonRequest: JSONRequest,
  data: any,
  error?: any,
  usage?: Usage
) {
  if (usage && error) {
    if (usage === 'wallet_getString' || usage === 'all') {
      error = `${error}\n{"method":"wallet_getString", "params":["<address>","<namespace>"]`;
    }
    if (usage === 'wallet_putString' || usage === 'all') {
      error = `${error}\n{"method":"wallet_putString", "params":["<address>","<namespace>","<counter>","<data>","<signature>"]}`;
    }
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id: jsonRequest.id,
    result: data === undefined ? null : data,
    error,
  });
}

async function handleGetString(jsonRequest: JSONRequest, env: Env) {
  let request: ParsedReadRequest;
  try {
    request = parseReadRequest(jsonRequest, 2);
  } catch (e) {
    console.error(e);
    return wrapResponse(jsonRequest, null, e, 'wallet_getString');
  }

  try {
    const data = await getData(env, request.namespace, request.address.toLowerCase());
    return wrapResponse(jsonRequest, data);
  } catch (e) {
    console.error(e);
    return wrapResponse(jsonRequest, null, e);
  }
}

function wrapResponse(
  jsonRequest: JSONRequest,
  data: any,
  error?: any,
  usage?: Usage
): Response {
  return new Response(wrapRequest(jsonRequest, data, error, usage), {
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      ...corsHeaders,
    },
  });
}

function toHex(ab: ArrayBuffer): string {
  const hashArray = Array.from(new Uint8Array(ab));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(''); // convert bytes to hex string
  return hashHex;
}

async function handlePutString(jsonRequest: JSONRequest, env: Env) {
  let request: ParsedWriteRequest;
  try {
    request = parseWriteRequest(jsonRequest);
  } catch (e) {
    return wrapResponse(jsonRequest, null, e, 'wallet_putString');
  }

  const authorized = await isAuthorized(
    request.address,
    'put:' + request.namespace + ':' + request.counter + ':' + request.data,
    request.signature
  );

  if (!authorized) {
    return wrapResponse(jsonRequest, null, 'invalid signature');
  }

  let currentData;
  try {
    currentData = await getData(env, request.namespace, request.address.toLowerCase());
    if (request.counter <= BigInt(currentData.counter)) {
      return wrapResponse(
        jsonRequest,
        { success: false, currentData },
        `cannot override with older/same counter`
      );
    }
    const now = Math.floor(Date.now());
    if (request.counter > BigInt(now)) {
      return wrapResponse(
        jsonRequest,
        null,
        `cannot use counter (${request.counter}) > timestamp (${now}) in ms`
      );
    }
    currentData = await setData(env,
      request.namespace,
      request.address.toLowerCase(),
      request.data,
      request.counter,
      request.signature
    );
  } catch (e) {
    console.error(e);
    return wrapResponse(jsonRequest, null, e);
  }

  return wrapResponse(jsonRequest, { success: true, currentData });
}


async function isAuthorized(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  let addressFromSignature;
  try {
    addressFromSignature = verifyMessage(message, signature);
  } catch (e) {
    return false;
  }
  return address.toLowerCase() == addressFromSignature.toLowerCase();
}
