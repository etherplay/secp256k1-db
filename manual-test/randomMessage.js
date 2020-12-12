const { Wallet } = require('@ethersproject/wallet');
const {putString} = require('./lib');

(async () => {
  const wallet = Wallet.createRandom();
  await putString(wallet, {data: "hello"});
  await putString(wallet, {counter:'100000000000000000000000000000', data: "hello"});
  await putString(wallet, {counter:Math.floor(Date.now()).toString(), data: "hello"});
})();
