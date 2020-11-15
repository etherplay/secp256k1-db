const {Wallet} = require('@ethersproject/wallet');
const {joinSignature} = require('@ethersproject/bytes')
const crypto = require('crypto');


const namespace = 'planet-wars';
async function putString(wallet, counter) {

    if (!counter) {
        counter = Math.floor(Date.now()).toString();
    }
    
    const dataAsString = JSON.stringify({hello: "world"});
    
    const hash = crypto.createHash('sha256');
    hash.update("put:" + namespace + ":" + counter + ":" + dataAsString);
    const dataHash = hash.digest();

    console.log({dataHash: dataHash.toString("hex")});

    const signature = joinSignature(await wallet._signingKey().signDigest(new Uint8Array(dataHash)));
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "wallet_putString",
      params: [wallet.address, namespace, counter, dataAsString, signature]
    };

    console.log(JSON.stringify(request));
}

(async() => {
    const wallet = Wallet.createRandom();
    await putString(wallet);
    await putString(wallet, "100000000000000000000000000000")
    await putString(wallet, Math.floor(Date.now()).toString())
})()