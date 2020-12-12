const axios = require('axios');
const { Wallet } = require('@ethersproject/wallet');
const {putString, getString} = require('./lib');

(async () => {
  const wallet = Wallet.createRandom();
  const request = await putString(wallet, {
    data: JSON.stringify({hello: "world"}),
    counter: Math.floor(Date.now() - 1000).toString()
  });

  let response;
  try {
    response = await axios.post('https://cf-worker-2.rim.workers.dev', request);
  } catch (e) {
    console.error("WRITE ERROR", e.response.data);
  }
  if (response) {
    console.log("RESULT", response.data);
    response = undefined;
  }

  const readRequest = await getString(wallet.address);

  try {
    response = await axios.post(
      'https://cf-worker-2.rim.workers.dev',
      readRequest
    );
  } catch (e) {
    console.error("READ ERROR", e.response.data);
  }
  if (response) {
    console.log("READ", response.data);
  }
})();
