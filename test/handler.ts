import { expect } from 'chai'
import { handleRPC } from '../src/handler'
import {Wallet} from '@ethersproject/wallet';
import * as crypto from 'crypto';

describe('handler returns response with request method', () => {
  it("signedDB_putString", async () => {
    const wallet = Wallet.createRandom();
    const publicKey = wallet.publicKey;
    const dataAsString = JSON.stringify({hello: "world"});
    
    const hash = crypto.createHash('sha256');
    hash.update(dataAsString);
    const dataHash = hash.digest();

    const signature = await wallet._signingKey().signDigest(new Uint8Array(dataHash));
    const result = await handleRPC(new Request('/', { method: "POST",  body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "signedDB_putString",
      params: ["planet-wars", publicKey, signature, dataAsString]
    }) }))
    const text = await result.text()

    expect(text).to.include("S")
  })
})
