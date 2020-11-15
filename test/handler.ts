import { expect } from 'chai'
import { handleRPC } from '../src/handler'
import {Wallet} from '@ethersproject/wallet';
const {joinSignature} = require('@ethersproject/bytes')
import * as crypto from 'crypto';

const NAMESPACE = 'planet-wars';

type Params = {
  counter?: string;
  namespace?: string;
  data: string;
  invalidSignature?: boolean
}

type WriteResponse = {
  result: {
    success: boolean;
    currentData: {
      data: string;
      counter: string;
    }
  }
}

type ReadResponse = {
  result: {
    data: string;
    counter: string;
  }
}

async function putString(wallet: Wallet, params: Params): Promise<WriteResponse> {
  const dataAsString = params.data;

  const counter = params.counter || Math.floor(Date.now()).toString();
  const namespace = params.namespace || NAMESPACE;
  
  const hash = crypto.createHash('sha256');
  hash.update("put:" + namespace + ":" + counter + ":" + dataAsString);
  const dataHash = hash.digest();

  let signature = joinSignature(await wallet._signingKey().signDigest(new Uint8Array(dataHash)));
  // console.log("DATA", {address, dataHash: dataHash.toString("hex"), signature, dataAsString});

  if (params.invalidSignature) {
    signature = joinSignature(await wallet._signingKey().signDigest(Wallet.createRandom().privateKey));
  }

  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "wallet_putString",
    params: [wallet.address, namespace, counter, dataAsString, signature]
  };

  // console.log("REQUEST", JSON.stringify(request));

  const result = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify(request)}));
  const json = await result.json();
  return json;
}

async function getString(address: string, params?: {namespace?: string}): Promise<ReadResponse> {
  const readRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "wallet_getString",
    params: [address, params? params.namespace || NAMESPACE : NAMESPACE]
  }
  const readResult = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify(readRequest)}));
  const readJson = await readResult.json();
  return readJson;
}

describe('handler returns response with request method', () => {
  it("wallet_putString", async () => {
    const wallet = Wallet.createRandom();
    const data = JSON.stringify({hello: "world"})
    const json = await putString(wallet, {data});
    expect(json.result.success).to.equal(true);

    const readJson = await getString(wallet.address);
    expect(readJson.result.data).to.equal(data);
  });

  it("wallet_putString fails", async () => {
    const wallet = Wallet.createRandom();
    const data = JSON.stringify({hello: "world"})
    const json = await putString(wallet, {data, invalidSignature: true});
    expect(json.result).to.equal(null);
  });
})
