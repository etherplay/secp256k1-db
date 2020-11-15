import { expect } from 'chai'
import { handleRPC } from '../src/handler'
import {Wallet} from '@ethersproject/wallet';
const {joinSignature} = require('@ethersproject/bytes')
import * as crypto from 'crypto';

const db = 'planet-wars';

describe('handler returns response with request method', () => {
  it("signedDB_putString", async () => {
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const dataAsString = JSON.stringify({hello: "world"});
    
    const hash = crypto.createHash('sha256');
    hash.update("db:" + db + ":" + dataAsString);
    const dataHash = hash.digest();

    const signature = joinSignature(await wallet._signingKey().signDigest(new Uint8Array(dataHash)));
    console.log("DATA", {address, dataHash: dataHash.toString("hex"), signature, dataAsString});

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "signedDB_putString",
      params: [db, wallet.address, signature, dataAsString]
    };

    console.log("REQUEST", JSON.stringify(request));

    const result = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify(request)}));
    const json = await result.json();

    expect(json.result).to.equal(true);


    const readRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "signedDB_getString",
      params: [db, wallet.address]
    }
    const readResult = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify(readRequest)}));
    const readJson = await readResult.json();

    expect(readJson.result).to.equal(dataAsString);
  })
})
