const {Wallet} = require('@ethersproject/wallet');
const {joinSignature} = require('@ethersproject/bytes')
const crypto = require('crypto');


(async() => {
    const db = 'planet-wars';

    const wallet = Wallet.createRandom();
    const dataAsString = JSON.stringify({hello: "world"});
    
    const hash = crypto.createHash('sha256');
    hash.update("db:" + db + ":" + dataAsString);
    const dataHash = hash.digest();

    console.log({dataHash: dataHash.toString("hex")});

    const signature = joinSignature(await wallet._signingKey().signDigest(new Uint8Array(dataHash)));
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "signedDB_putString",
      params: [db, wallet.address, signature, dataAsString]
    };

    console.log(JSON.stringify(request));
})()