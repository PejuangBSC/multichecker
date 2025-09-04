// DEX builder config extracted from config.js to keep JSON purely data
// Exposes window.CONFIG_DEXS for use across the app
(function initDexBuilders(global){
  const root = global || (typeof window !== 'undefined' ? window : {});
  const CONFIG_DEXS = {
    kyberswap: {
      builder: ({ chainName, tokenAddress, pairAddress }) => `https://kyberswap.com/swap/${chainName}/${tokenAddress}-to-${pairAddress}`,
      allowFallback: true,
    },
    '0x': {
      builder: ({ chainName, tokenAddress, pairAddress, chainCode }) => `https://matcha.xyz/tokens/${chainName}/${String(tokenAddress||'').toLowerCase()}?buyChain=${chainCode}&buyAddress=${String(pairAddress||'').toLowerCase()}`,
      allowFallback: true,
    },
    odos: {
      builder: () => `https://app.odos.xyz`,
      allowFallback: true,
    },
    okx: {
      builder: ({ chainCode, tokenAddress, pairAddress }) => `https://www.okx.com/web3/dex-swap?inputChain=${chainCode}&inputCurrency=${tokenAddress}&outputChain=501&outputCurrency=${pairAddress}`,
      allowFallback: true,
    },
    '1inch': {
      builder: ({ chainCode, tokenAddress, pairAddress }) => `https://app.1inch.io/advanced/swap?network=${chainCode}&src=${tokenAddress}&dst=${pairAddress}`,
      // allowFallback intentionally disabled for 1inch
    },
    lifi: {
      builder: ({ chainCode, tokenAddress, pairAddress }) => `https://jumper.exchange/?fromChain=${chainCode}&fromToken=${tokenAddress}&toChain=${chainCode}&toToken=${pairAddress}`,
      // allowFallback intentionally disabled for lifi direct
    },
  };

  root.CONFIG_DEXS = CONFIG_DEXS;
})(this);

