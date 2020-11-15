import { expect } from 'chai'
import { handleRPC } from '../src/handler'
import {Wallet} from '@ethersproject/wallet';
const {joinSignature} = require('@ethersproject/bytes')
import * as crypto from 'crypto';

const namespace = 'planet-wars';

describe('handler returns response with request method', () => {
  it("wallet_putString", async () => {
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const dataAsString = JSON.stringify({hello: "world"});

    const timestamp = Math.floor(Date.now()).toString();
    
    const hash = crypto.createHash('sha256');
    hash.update("put:" + namespace + ":" + timestamp + ":" + dataAsString);
    const dataHash = hash.digest();

    const signature = joinSignature(await wallet._signingKey().signDigest(new Uint8Array(dataHash)));
    console.log("DATA", {address, dataHash: dataHash.toString("hex"), signature, dataAsString});

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "wallet_putString",
      params: [wallet.address, namespace, timestamp, dataAsString, signature]
    };

    console.log("REQUEST", JSON.stringify(request));

    const result = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify(request)}));
    const json = await result.json();

    expect(json.result).to.equal(true);


    const readRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "wallet_getString",
      params: [wallet.address, namespace]
    }
    const readResult = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify(readRequest)}));
    const readJson = await readResult.json();

    expect(readJson.result).to.equal(dataAsString);
  })
})
