const { joinSignature } = require('@ethersproject/bytes');
const crypto = require('crypto');

const NAMESPACE = 'planet-wars';
async function putString(wallet, params) {
  const dataAsString = params.data;

  const counter = params.counter || Math.floor(Date.now()).toString();
  const namespace = params.namespace || NAMESPACE;

  const hash = crypto.createHash('sha256');
  hash.update('put:' + namespace + ':' + counter + ':' + dataAsString);
  const dataHash = hash.digest();

  console.log({ dataHash: dataHash.toString('hex') });

  const signature = joinSignature(
    await wallet._signingKey().signDigest(new Uint8Array(dataHash))
  );
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'wallet_putString',
    params: [wallet.address, namespace, counter, dataAsString, signature],
  };

  console.log(JSON.stringify(request));

  return request;
}

async function getString(address, params) {
    const readRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'wallet_getString',
        params: [address, params ? params.namespace || NAMESPACE : NAMESPACE],
      };
    return readRequest;
  }
  

module.exports = {
    putString,
    getString
}