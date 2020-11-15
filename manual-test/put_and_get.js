const axios = require('axios');
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
      params: [db, wallet.address, signature + "1", dataAsString]
    };

    const readRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "signedDB_getString",
        params: [db, wallet.address]
      };

    console.log(JSON.stringify(request));

    let response
    try {
        response = await axios.post('https://cf-worker-2.rim.workers.dev', request)
    } catch(e) {
        console.error(e.response.data);
    }
    if (response) {
        console.log(response.data);
        response = undefined;
    }
    
    try {
        response = await axios.post('https://cf-worker-2.rim.workers.dev', readRequest)
    } catch(e) {
        console.error(e.response.data);
    }
    if (response) {
        console.log(response.data);
    }

})()