const axios = require('axios');
const {Wallet} = require('@ethersproject/wallet');
const {joinSignature} = require('@ethersproject/bytes')
const crypto = require('crypto');


(async() => {
    const res = await axios.get('https://cf-worker-2.rim.workers.dev');
    console.log(res.data);

    const testWallet = new Wallet("0x6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e");
    const testHash = "0x9c1185a5c5e9fc54612808977ee8f548b2258d31";
    const testPublicKey = testWallet.publicKey;
    const testSignature = joinSignature(await testWallet._signingKey().signDigest(testHash));

    console.log({
        testHash, testPublicKey, testSignature
    })


    const wallet = Wallet.createRandom();
    const publicKey = wallet.publicKey;
    const dataAsString = JSON.stringify({hello: "world"});
    
    const hash = crypto.createHash('sha256');
    hash.update(dataAsString);
    const dataHash = hash.digest();

    console.log({dataHash: dataHash.toString("hex")});

    const signature = joinSignature(await wallet._signingKey().signDigest(new Uint8Array(dataHash)));
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "signedDB_putString",
      params: ["planet-wars", publicKey, signature, dataAsString]
    };

    console.log(JSON.stringify(request));

    // try {
    //     await axios.post('https://cf-worker-2.rim.workers.dev', request)
    // } catch(e) {
    //     console.error(e.response.data);
    // }
    
})()