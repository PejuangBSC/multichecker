// =================================================================================
// CEX Service Module (moved intact) — Pindahkan utuh + shim
// =================================================================================
/**
 * CEX Service Module
 * - Normalizes order books from CEX endpoints
 * - Fetches wallet (DP/WD) statuses
 * - Bridges UI rendering (updateTableVolCEX)
 */
(function initCEXService(global){
  const root = global || (typeof window !== 'undefined' ? window : {});
  const App = root.App || (root.App = {});

  // Keep internal constant local to this module
  const stablecoins = ["USDT", "DAI", "USDC", "FDUSD"];

  // ====== Fungsi Universal untuk Orderbook CEX ======
  /** Normalize standard CEX orderbook payload into top N levels. */
  function processOrderBook(data, limit = 4) {
    if (!data?.bids || !data?.asks) {
        console.error("Invalid orderbook data:", data);
        return { priceBuy: [], priceSell: [] };
    }

    // bids: sort desc (harga tertinggi dulu)
    const bids = [...data.bids].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    // asks: sort asc (harga terendah dulu)
    const asks = [...data.asks].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

    // harga beli = ambil harga tertinggi (dari bids)
    const priceBuy = bids.slice(0, limit).map(([price, volume]) => ({
        price: parseFloat(price),                // harga beli
        volume: parseFloat(volume) * parseFloat(price) // nilai dalam USDT
    }));

    // harga jual = ambil harga terendah (dari asks)
    const priceSell = asks.slice(0, limit).map(([price, volume]) => ({
        price: parseFloat(price),                // harga jual
        volume: parseFloat(volume) * parseFloat(price) // nilai dalam USDT
    }));

    return { priceBuy, priceSell };
}

  // Removed legacy processOrderBookLAMA (unused)

  // ====== Fungsi Khusus untuk INDODAX ======
  /** Normalize INDODAX orderbook (IDR) to USDT using cached rate. */
  function processIndodaxOrderBook(data, limit = 4) {
      if (!data?.buy || !data?.sell) {
          console.error("Invalid INDODAX response structure:", data);
          return { priceBuy: [], priceSell: [] };
      }

      // Ensure same semantics: buy = bids desc (best bid first), sell = asks asc (best ask first)
      const buySorted = [...data.buy].sort((a,b) => parseFloat(b[0]) - parseFloat(a[0]));
      const sellSorted = [...data.sell].sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]));

      const priceBuy = buySorted.slice(0, limit).map(([price, volume]) => {
          const priceFloat = parseFloat(price);
          const volumeFloat = parseFloat(volume);
          return {
              price: convertIDRtoUSDT(priceFloat),
              volume: convertIDRtoUSDT(priceFloat * volumeFloat)
          };
      });

      const priceSell = sellSorted.slice(0, limit).map(([price, volume]) => {
          const priceFloat = parseFloat(price);
          const volumeFloat = parseFloat(volume);
          return {
              price: convertIDRtoUSDT(priceFloat),
              volume: convertIDRtoUSDT(priceFloat * volumeFloat)
          };
      });

      return { priceBuy, priceSell };
  }

  // ====== Konfigurasi Exchange via registry/CONFIG_CEX ======
  // Orderbook endpoints and parsers are sourced from CONFIG_CEX.<CEX>.ORDERBOOK
  // through services/cex/registry.js. This object is kept empty by default
  // and will be hydrated by the merge block below.
  let exchangeConfig = {};

  // If CEX registry is present and defines orderbook config, prefer it
  try {
    if (root.CEX && typeof root.CEX._all === 'function') {
      const merged = {};
      root.CEX._all().forEach(e => {
        const ob = e?.orderbook || null;
        if (!ob || typeof ob.urlTpl !== 'function') return;
        // Accept direct parser function or a token resolved here
        let parserFn = null;
        if (typeof ob.parser === 'function') parserFn = ob.parser;
        else if (typeof ob.parserToken === 'string') {
          const tok = ob.parserToken.toLowerCase();
          if (tok === 'standard') parserFn = (data) => processOrderBook(data, 4);
          else if (tok === 'indodax') parserFn = (data) => processIndodaxOrderBook(data, 4);
          else if (tok === 'kucoin') parserFn = (data) => processOrderBook(data?.data || {}, 4);
          else if (tok === 'bitget') parserFn = (data) => processOrderBook(data?.data || {}, 4);
          else if (tok === 'bybit') parserFn = (data) => {
            try {
              const a = (data?.result?.a || []).map(([p,v]) => [p, v]);
              const b = (data?.result?.b || []).map(([p,v]) => [p, v]);
              return processOrderBook({ asks: a, bids: b }, 4);
            } catch(_) { return { priceBuy: [], priceSell: [] }; }
          };
        }
        if (parserFn) {
          merged[e.name] = { url: ob.urlTpl, processData: parserFn };
        }
      });
      // Keep existing as fallback for entries not provided via registry
      exchangeConfig = Object.assign({}, exchangeConfig, merged);
    }
  } catch(_) {}

  // Secondary hydration directly from CONFIG_CEX as a safety net
  try {
    const cfgAll = root.CONFIG_CEX || {};
    Object.keys(cfgAll).forEach(name => {
      const up = String(name).toUpperCase();
      if (exchangeConfig[up]) return;
      const ob = cfgAll[up]?.ORDERBOOK || {};
      if (typeof ob.urlTpl !== 'function') return;
      let parserFn = null;
      const tok = String(ob.parser || '').toLowerCase();
      if (tok === 'standard') parserFn = (data) => processOrderBook(data, 4);
      else if (tok === 'indodax') parserFn = (data) => processIndodaxOrderBook(data, 4);
      else if (tok === 'kucoin') parserFn = (data) => processOrderBook(data?.data || {}, 4);
      else if (tok === 'bitget') parserFn = (data) => processOrderBook(data?.data || {}, 4);
      else if (tok === 'bybit') parserFn = (data) => {
        try {
          const a = (data?.result?.a || []).map(([p,v]) => [p, v]);
          const b = (data?.result?.b || []).map(([p,v]) => [p, v]);
          return processOrderBook({ asks: a, bids: b }, 4);
        } catch(_) { return { priceBuy: [], priceSell: [] }; }
      };
      if (parserFn) exchangeConfig[up] = { url: ob.urlTpl, processData: parserFn };
    });
  } catch(_) {}

  // Debug: log populated exchanges once at init
  try {
    const keysInit = Object.keys(exchangeConfig || {});
    if (keysInit.length === 0) {
      /* debug logs removed */
    } else {
      /* debug logs removed */
    }
  } catch(_) {}

  /** Fetches the order book for a token pair from a CEX. */
  /**
   * Fetch and parse CEX orderbook for token and pair.
   * Also updates the UI via updateTableVolCEX.
   */
  function getPriceCEX(coins, NameToken, NamePair, cex, tableBodyId) {
      return new Promise((resolve, reject) => {
          const key = String(cex || '').toUpperCase();
          let config = exchangeConfig[key] || exchangeConfig[cex];
          // On-demand build as last resort if missing
          if (!config) {
              try {
                      const ob = (root.CONFIG_CEX || {})[key]?.ORDERBOOK || {};
                      if (typeof ob.urlTpl === 'function') {
                          const tok = String(ob.parser || '').toLowerCase();
                          let parserFn = null;
                      if (tok === 'standard') parserFn = (data) => processOrderBook(data, 4);
                      else if (tok === 'indodax') parserFn = (data) => processIndodaxOrderBook(data, 4);
                      else if (tok === 'kucoin') parserFn = (data) => processOrderBook(data?.data || {}, 4);
                      else if (tok === 'bitget') parserFn = (data) => processOrderBook(data?.data || {}, 4);
                      else if (tok === 'bybit') parserFn = (data) => {
                        try {
                          const a = (data?.result?.a || []).map(([p,v]) => [p, v]);
                          const b = (data?.result?.b || []).map(([p,v]) => [p, v]);
                          return processOrderBook({ asks: a, bids: b }, 4);
                        } catch(_) { return { priceBuy: [], priceSell: [] }; }
                      };
                      if (parserFn) {
                          exchangeConfig[key] = { url: ob.urlTpl, processData: parserFn };
                          config = exchangeConfig[key];
                          /* debug logs removed */
                      }
                  }
              } catch(_) {}
          }
          if (!config) {
              return reject(`Exchange ${key || cex} tidak ditemukan dalam konfigurasi.`);
          }

          const settings = getFromLocalStorage("SETTING_SCANNER", {});
          const jedaCex = settings?.JedaCexs?.[key] || settings?.JedaCexs?.[cex] || 0;
          const isStablecoin = (token) => stablecoins.includes(token);

          const urls = [
              isStablecoin(NameToken) ? null : config.url({ symbol: NameToken }),
              isStablecoin(NamePair) ? null : config.url({ symbol: NamePair })
          ];

          let promises = urls.map((url, index) => {
              const tokenName = index === 0 ? NameToken : NamePair;
              if (isStablecoin(tokenName)) {
                  return Promise.resolve({
                      tokenName: tokenName,
                      price_sell: 1,
                      price_buy: 1,
                      volumes_sell: Array(4).fill({ price: 1, volume: 10000 }),
                      volumes_buy: Array(4).fill({ price: 1, volume: 10000 })
                  });
              }
              if (url) {
                  return new Promise((resolveAjax, rejectAjax) => {
                      setTimeout(() => {
                          $.ajax({
                              url: url,
                              method: 'GET',
                              success: function (data) {
                                  try {
                                      const processedData = config.processData(data);
                                      // Select best prices: BUY uses best ask (lowest), SELL uses best bid (highest)
                                      const priceBuy = processedData?.priceSell?.[0]?.price || 0;
                                      const priceSell = processedData?.priceBuy?.[0]?.price || 0;
                                      if (priceBuy <= 0 || priceSell <= 0) {
                                          return rejectAjax(`Harga tidak valid untuk ${tokenName} di ${cex}.`);
                                      }
                                      resolveAjax({
                                          tokenName: tokenName,
                                          price_sell: priceSell,
                                          price_buy: priceBuy,
                                          volumes_sell: processedData.priceSell || [],
                                          volumes_buy: processedData.priceBuy || []
                                      });
                                  } catch (error) {
                                      rejectAjax(`Error processing data untuk ${tokenName} di ${cex}: ${error.message}`);
                                  }
                              },
                              error: function (xhr) {
                                  const errorMessage = xhr.responseJSON?.msg || "Unknown ERROR";
                                  rejectAjax(`Error koneksi API untuk ${tokenName} di ${cex}: ${errorMessage}`);
                              }
                          });
                      }, jedaCex);
                  });
              }
              return Promise.resolve(null);
          });

          Promise.all(promises).then(resultsArray => {
              const results = resultsArray.reduce((acc, res) => {
                  if (res) acc[res.tokenName] = res;
                  return acc;
              }, {});

              const priceBuyToken = results[NameToken]?.price_buy || 0;
              const priceBuyPair = results[NamePair]?.price_buy || 0;

              const feeTokensRaw = parseFloat(coins.feeWDToken || 0);
              const feePairsRaw  = parseFloat(coins.feeWDPair  || 0);
              const feeWDToken = (isFinite(feeTokensRaw) ? feeTokensRaw : 0) * priceBuyToken;
              const feeWDPair  = (isFinite(feePairsRaw)  ? feePairsRaw  : 0) * priceBuyPair;

              if (isNaN(feeWDToken) || feeWDToken < 0) return reject(`FeeWD untuk ${NameToken} di ${cex} tidak valid.`);
              if (isNaN(feeWDPair) || feeWDPair < 0) return reject(`FeeWD untuk ${NamePair} di ${cex} tidak valid.`);

              const finalResult = {
                  token: NameToken.toUpperCase(),
                  sc_input: coins.sc_in,
                  sc_output: coins.sc_out,
                  pair: NamePair.toUpperCase(),
                  cex: cex.toUpperCase(),
                  priceSellToken: results[NameToken]?.price_sell || 0,
                  priceBuyToken: priceBuyToken,
                  priceSellPair: results[NamePair]?.price_sell || 0,
                  priceBuyPair: priceBuyPair,
                  volumes_sellToken: results[NameToken]?.volumes_sell || [],
                  volumes_buyToken: results[NameToken]?.volumes_buy || [],
                  volumes_sellPair: results[NamePair]?.volumes_sell || [],
                  volumes_buyPair: results[NamePair]?.volumes_buy || [],
                  feeWDToken: feeWDToken,
                  feeWDPair: feeWDPair,
                  chainName: coins.chain
              };

              updateTableVolCEX(finalResult, cex, tableBodyId);
            
              resolve(finalResult);
          }).catch(error => { reject(error); });
      });
  }

  // =================================================================================
  // Universal CEX Wallet Fetcher (moved)
  // =================================================================================
  /** Fetch DP/WD statuses and fees for a given CEX (per token/chain). */
  async function fetchWalletStatus(cex) {
      const cfg = CONFIG_CEX?.[cex] || {};
      const secretSrc = (typeof CEX_SECRETS !== 'undefined' && CEX_SECRETS?.[cex]) ? CEX_SECRETS[cex]
                        : ((typeof window !== 'undefined' && window.CEX_SECRETS && window.CEX_SECRETS[cex]) ? window.CEX_SECRETS[cex] : {});
      const ApiKey = cfg.ApiKey || secretSrc?.ApiKey;
      const ApiSecret = cfg.ApiSecret || secretSrc?.ApiSecret;
      const hasKeys = !!(ApiKey && ApiSecret);
      const timestamp = Date.now();

      switch (cex) {
          case 'BINANCE': {
              if (!hasKeys) throw new Error(`${cex} API Key/Secret not configured in CONFIG_CEX.`);
              const query = `timestamp=${timestamp}`;
              const sig = calculateSignature("BINANCE", ApiSecret, query, "HmacSHA256");
              const url = `https://proxykanan.awokawok.workers.dev/?https://api-gcp.binance.com/sapi/v1/capital/config/getall?${query}&signature=${sig}`;
              const response = await $.ajax({ url, headers: { "X-MBX-ApiKey": ApiKey } });
              return response.flatMap(item =>
                  (item.networkList || []).map(net => ({
                      cex,
                      tokenName: item.coin,
                      chain: net.network,
                      feeWDs: parseFloat(net.withdrawFee || 0),
                      depositEnable: !!net.depositEnable,
                      withdrawEnable: !!net.withdrawEnable
                  }))
              );
          }

          case 'MEXC': {
              if (!hasKeys) throw new Error(`${cex} API Key/Secret not configured in CONFIG_CEX.`);
              const query = `recvWindow=5000&timestamp=${timestamp}`;
              const sig = calculateSignature("MEXC", ApiSecret, query);
              const url = `https://proxykiri.awokawok.workers.dev/?https://api.mexc.com/api/v3/capital/config/getall?${query}&signature=${sig}`;
              const response = await $.ajax({ url, headers: { "X-MEXC-APIKEY": ApiKey } });
              return response.flatMap(item =>
                  (item.networkList || []).map(net => ({
                      cex,
                      tokenName: item.coin,
                      chain: net.network || net.netWork || net.chain || net.name || '',
                      feeWDs: parseFloat(net.withdrawFee || 0),
                      depositEnable: !!net.depositEnable,
                      withdrawEnable: !!net.withdrawEnable
                  }))
              );
          }

          case 'GATE': {
              if (!hasKeys) throw new Error(`${cex} API Key/Secret not configured in CONFIG_CEX.`);
              const host = "https://cors-anywhere.herokuapp.com/https://api.gateio.ws";
              const prefix = "/api/v4";
              const ts = Math.floor(Date.now() / 1000);

              function gateSign(method, path, query = "", body = "") {
                  const hashedBody = CryptoJS.SHA512(body).toString(CryptoJS.enc.Hex);
                  const payload = `${method}\n${path}\n${query}\n${hashedBody}\n${ts}`;
                  return CryptoJS.HmacSHA512(payload, ApiSecret).toString(CryptoJS.enc.Hex);
              }

              const wdPath = "/wallet/withdraw_status";
              const wdHeaders = { KEY: ApiKey, SIGN: gateSign("GET", prefix + wdPath, "", ""), Timestamp: ts };
              const wdData = await $.ajax({ url: `${host}${prefix}${wdPath}`, headers: wdHeaders });
              const statusData = await $.ajax({ url: `${host}${prefix}/spot/currencies` });

              return statusData.flatMap(item =>
                  (item.chains || []).map(chain => {
                      const match = (wdData || []).find(w => (w.currency || '').toUpperCase() === (item.currency || '').toUpperCase()) || {};
                      const chainCode = String(chain.name || chain.chain || chain.network || chain.chain_name || '').toUpperCase();
                      const feeMap = match.withdraw_fix_on_chains || {};
                      const feeOnChain = feeMap[chainCode] ?? feeMap[chain.name] ?? feeMap[chain.chain] ?? 0;
                      return {
                          cex,
                          tokenName: item.currency,
                          chain: chainCode,
                          feeWDs: parseFloat(chain.withdraw_fee || feeOnChain || 0),
                          depositEnable: !Boolean(chain.deposit_disabled),
                          withdrawEnable: !Boolean(chain.withdraw_disabled),
                      };
                  })
              );
          }

          case 'INDODAX': {
              const url = `https://indodax.com/api/summaries`;
              const response = await $.ajax({ url });
              const list = response?.tickers || {};
              const arr = Object.keys(list).map(k => ({ cex, tokenName: k.toUpperCase().replace('IDR',''), chain: 'INDODAX', feeWDs: 0, depositEnable: true, withdrawEnable: true }));
              return arr;
          }

          case 'KUCOIN': {
              // Public endpoint: currencies and chains
              const url = `https://proxykiri.awokawok.workers.dev/?https://api.kucoin.com/api/v3/currencies`;
              const res = await $.ajax({ url, method: 'GET' });
              const data = (res && res.data) || [];
              const arr = [];
              data.forEach(item => {
                  const coin = item?.currency || item?.coin || '';
                  const chains = item?.chains || item?.networkList || [];
                  (chains || []).forEach(net => {
                      const chainName = net?.chainName || net?.network || net?.name || '';
                      const fee = parseFloat(net?.withdrawalMinFee || net?.withdrawFee || 0);
                      const dep = (net?.isDepositEnabled === true) || (net?.canDeposit === true) || (String(net?.depositEnable).toLowerCase() === 'true');
                      const wd  = (net?.isWithdrawEnabled === true) || (net?.canWithdraw === true) || (String(net?.withdrawEnable).toLowerCase() === 'true');
                      if (!coin || !chainName) return;
                      arr.push({ cex: 'KUCOIN', tokenName: String(coin).toUpperCase(), chain: String(chainName), feeWDs: isFinite(fee)?fee:0, depositEnable: !!dep, withdrawEnable: !!wd });
                  });
              });
              return arr;
          }

          case 'BITGET': {
              // Public endpoint: coins and chains
              const url = `https://api.bitget.com/api/v2/spot/public/coins`;
              const res = await $.ajax({ url, method: 'GET' });
              const data = (res && res.data) || [];
              const arr = [];
              data.forEach(item => {
                  const coin = item?.coin || item?.currency || '';
                  const chains = item?.chains || [];
                  (chains || []).forEach(net => {
                      const chain = net?.chain || net?.network || net?.name || '';
                      const fee = parseFloat(net?.withdrawFee || net?.withdrawMinFee || 0);
                      const dep = (String(net?.rechargeable).toLowerCase() === 'true') || (net?.rechargeable === true);
                      const wd  = (String(net?.withdrawable).toLowerCase() === 'true') || (net?.withdrawable === true);
                      if (!coin || !chain) return;
                      arr.push({ cex: 'BITGET', tokenName: String(coin).toUpperCase(), chain: String(chain), feeWDs: isFinite(fee)?fee:0, depositEnable: !!dep, withdrawEnable: !!wd });
                  });
              });
              return arr;
          }

          case 'BYBIT': {
              if (!hasKeys) throw new Error(`${cex} API Key/Secret not configured in CONFIG_CEX.`);
              const key = ApiKey;
              const secret = ApiSecret;
              const recvWindow = 5000;
              const ts = Date.now().toString();
              const queryString = ""; // empty query → fetch all coins

              function calcSign(secret, timestamp, apiKey, recvWindow, query) {
                  const dataToSign = `${timestamp}${apiKey}${recvWindow}${query}`;
                  return CryptoJS.HmacSHA256(dataToSign, secret).toString(CryptoJS.enc.Hex);
              }
              const sign = calcSign(secret, ts, key, recvWindow, queryString);

              const url = `https://proxykiri.awokawok.workers.dev/?https://api.bybit.com/v5/asset/coin/query-info` + (queryString ? `?${queryString}` : '');
              const headers = {
                  'X-BAPI-API-KEY': key,
                  'X-BAPI-TIMESTAMP': ts,
                  'X-BAPI-RECV-WINDOW': String(recvWindow),
                  'X-BAPI-SIGN': sign,
                  'Accept': 'application/json',
                  'Content-Type': 'application/json'
              };

              const res = await $.ajax({ url, method: 'GET', headers });
              const rows = (res && res.result && (res.result.rows || res.result.list || res.result?.rows)) || [];
              const data = Array.isArray(rows) ? rows : [];
              const arr = [];
              const truthy = (v) => (v === true) || (v === 1) || (v === '1') || (String(v).toLowerCase() === 'true');
              data.forEach(item => {
                  const coin = item?.coin || '';
                  const chains = item?.chains || item?.chainsCommon || item?.networkList || [];
                  (chains || []).forEach(net => {
                      const chain = net?.chain || net?.chainType || net?.network || net?.name || '';
                      const fee = parseFloat(net?.withdrawFee || net?.withdrawMinFee || 0);
                      const dep = (net?.canDeposit === true) || (net?.depositable === true) || truthy(net?.rechargeable) || truthy(net?.chainDeposit);
                      const wd  = (net?.canWithdraw === true) || (net?.withdrawable === true) || truthy(net?.chainWithdraw);
                      if (!coin || !chain) return;
                      arr.push({ cex: 'BYBIT', tokenName: String(coin).toUpperCase(), chain: String(chain), feeWDs: isFinite(fee)?fee:0, depositEnable: !!dep, withdrawEnable: !!wd });
                  });
              });
              return arr;
          }

          default:
              throw new Error(`Unsupported CEX: ${cex}`);
      }
  }

  /** Merge centralized CEX wallet statuses into per-token dataCexs. */
  function applyWalletStatusToTokenList(tokenListName) {
      const allWalletStatus = getFromLocalStorage('CEX_WALLET_STATUS', {});
      if (Object.keys(allWalletStatus).length === 0) {
          /* debug logs removed */
          return;
      }

      let tokens = getFromLocalStorage(tokenListName, []);
      if (!tokens || tokens.length === 0) {
          infoAdd(`ℹ️ No tokens found in '${tokenListName}' to update.`);
          return;
      }

      const updatedTokens = tokens.map(token => {
          const updatedDataCexs = { ...(token.dataCexs || {}) };
          (token.selectedCexs || Object.keys(CONFIG_CEX)).forEach(cexKey => {
              const walletForCex = allWalletStatus[cexKey.toUpperCase()];
              if (!walletForCex) return;

              const chainLabelForCEX = getChainData(token.chain)?.CEXCHAIN?.[cexKey]?.chainCEX?.toUpperCase() || '';

              function resolveWalletChain(walletInfo, desired) {
                  if (!walletInfo) return null;
                  const want = String(desired || '').toUpperCase();
                  // Prefer synonym-based resolution so we don't depend on config.js labels
                  try {
                      const chainKey = String(token.chain||'').toLowerCase();
                      if (typeof resolveWalletChainBySynonym === 'function') {
                          const hit = resolveWalletChainBySynonym(walletInfo, chainKey, want);
                          if (hit) return hit;
                      }
                  } catch(_) {}
                  // Fallback to exact desired label if provided
                  if (want && walletInfo[want]) return walletInfo[want];
                  return null;
              }

              const updateForSymbol = (symbol, isTokenIn) => {
                  if (!symbol) return;
                  const symbolUpper = symbol.toUpperCase();
                  const walletInfo = walletForCex[symbolUpper];
                  const match = resolveWalletChain(walletInfo, chainLabelForCEX);

                  if (match) {
                      updatedDataCexs[cexKey] = updatedDataCexs[cexKey] || {};
                      const feeField = isTokenIn ? 'feeWDToken' : 'feeWDPair';
                      const depositField = isTokenIn ? 'depositToken' : 'depositPair';
                      const withdrawField = isTokenIn ? 'withdrawToken' : 'withdrawPair';

                      updatedDataCexs[cexKey][feeField] = String(match.feeWDs || '0');
                      updatedDataCexs[cexKey][depositField] = !!match.depositEnable;
                      updatedDataCexs[cexKey][withdrawField] = !!match.withdrawEnable;
                  }
              };
              updateForSymbol(token.symbol_in, true);
              updateForSymbol(token.symbol_out, false);
          });
          return { ...token, dataCexs: updatedDataCexs };
      });

      saveToLocalStorage(tokenListName, updatedTokens);
      infoAdd(`💾 ${updatedTokens.length} tokens in '${tokenListName}' were updated.`);
  }

  /** Orchestrate fetching all CEX wallet statuses and apply to tokens. */
  async function checkAllCEXWallets() {
      $('#loadingOverlay').fadeIn(150);
      infoSet('🚀 Memulai pengecekan DATA CEX...');
      // Prepare overlay progress UI (create once)
      try {
          const $ov = $('#loadingOverlay .uk-position-center');
          if ($ov.length) {
              // Title text element (reuse existing <p>)
              let $title = $ov.find('p.wallet-title');
              if ($title.length === 0) {
                  // Turn existing <p> into wallet-title if found, else create
                  const $p = $ov.find('p').first();
                  if ($p.length) { $p.addClass('wallet-title'); $title = $p; }
                  else { $title = $('<p class="wallet-title uk-margin-small-top"></p>').appendTo($ov); }
              }
              // Progress bar + counter
              if ($ov.find('#walletProgress').length === 0) {
                  $ov.append('<progress id="walletProgress" class="uk-progress uk-margin-small-top" value="0" max="1"></progress>');
                  $ov.append('<div id="walletCounter" class="uk-text-meta uk-margin-small-top">0 / 0 (0%)</div>');
              }
          }
      } catch(_) {}

      // Hanya CEX yang dicentang pada filter (tanpa fallback ke semua)
      let selectedCexes = [];
      try {
          const m = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };
          if (m.type === 'multi' && typeof getFilterMulti === 'function') {
              const fm = getFilterMulti();
              selectedCexes = (fm?.cex || []).map(x => String(x).toUpperCase());
          } else if (m.type === 'single' && typeof getFilterChain === 'function') {
              const fc = getFilterChain(m.chain || '');
              selectedCexes = (fc?.cex || []).map(x => String(x).toUpperCase());
          }
      } catch(_) {}
      // Filter hanya yang valid di CONFIG_CEX
      selectedCexes = selectedCexes.filter(cx => !!CONFIG_CEX?.[cx]);
      if (!selectedCexes.length) {
          infoSet('⚠ Pilih minimal 1 CEX pada filter.');
          try { UIkit.notification({ message: 'Pilih minimal 1 CEX pada filter (chip CEX).', status: 'warning' }); } catch(_) {}
          $('#loadingOverlay').fadeOut(150);
          return;
      }

      const aggregated = [];
      const failed = [];
      // Init overlay progress max
      try { $('#walletProgress').attr('max', selectedCexes.length).val(0); $('#walletCounter').text(`0 / ${selectedCexes.length} (0%)`); } catch(_) {}
      for (let i = 0; i < selectedCexes.length; i++) {
          const cex = String(selectedCexes[i]);
          try {
              const cur = i + 1;
              const total = selectedCexes.length;
              infoSet(`🔄 Mengambil data wallet: ${cex} (${cur}/${total})...`);
              try {
                  // Update overlay title and progress
                  const pct = Math.floor((cur - 1) / total * 100);
                  $('#loadingOverlay .wallet-title').text(`Updating Wallets: ${cex} (${cur}/${total})`);
                  $('#walletProgress').val(cur - 1);
                  $('#walletCounter').text(`${cur - 1} / ${total} (${pct}%)`);
              } catch(_) {}
              const res = await fetchWalletStatus(cex);
              aggregated.push(res);
              infoAdd(`✅ ${cex} selesai.`);
          } catch(err) {
              console.error(`❌ ${cex} gagal:`, err);
              failed.push({ error: true, cex, message: err.message });
              infoAdd(`❌ ${cex} GAGAL (${err.message})`);
          }
          // Step progress after each CEX completes
          try {
              const done = i + 1;
              const total = selectedCexes.length;
              const pct = Math.floor((done / total) * 100);
              $('#loadingOverlay .wallet-title').text(`Updating Wallets: ${cex} (${done}/${total})`);
              $('#walletProgress').val(done);
              $('#walletCounter').text(`${done} / ${total} (${pct}%)`);
          } catch(_) {}
      }

      // Build aggregated status map from successful CEX calls
      const walletStatusByCex = {};
      aggregated.flat().forEach(item => {
          if (!item) return;
          const { cex, tokenName, chain, ...rest } = item;
          // Guard against malformed payloads
          if (!cex || !tokenName || !chain) {
              /* debug logs removed */
              return;
          }
          const ucCex = String(cex).toUpperCase();
          const ucToken = String(tokenName).toUpperCase();
          const ucChain = String(chain).toUpperCase();

          if (!walletStatusByCex[ucCex]) walletStatusByCex[ucCex] = {};
          if (!walletStatusByCex[ucCex][ucToken]) walletStatusByCex[ucCex][ucToken] = {};
          walletStatusByCex[ucCex][ucToken][ucChain] = rest;
      });

      // Commit results even if some CEX failed (partial success behavior)
      try {
          const okCount = aggregated.length;
          const failCount = failed.length;
          // Always persist attempt meta
          if (typeof saveToLocalStorageAsync === 'function') {
              await saveToLocalStorageAsync('CEX_WALLET_STATUS_META', { time: new Date().toISOString(), ok: okCount, fail: failCount });
          } else {
              saveToLocalStorage('CEX_WALLET_STATUS_META', { time: new Date().toISOString(), ok: okCount, fail: failCount });
          }
          // Persist the status map (can be empty on total failure)
          if (typeof saveToLocalStorageAsync === 'function') {
              await saveToLocalStorageAsync('CEX_WALLET_STATUS', walletStatusByCex);
          } else {
              saveToLocalStorage('CEX_WALLET_STATUS', walletStatusByCex);
          }
          if (okCount + failCount > 0) infoAdd(`✅ Data wallet tersimpan. OK: ${okCount}, Gagal: ${failCount}.`);
      } catch(e) { /* debug logs removed */ }
      // Notify failures (non-blocking)
      if (failed.length > 0) {
          try {
              UIkit.notification({
                  message: `⚠️ GAGAL UPDATE EXCHANGER: ${failed.map(f => `${f.cex}`).join(', ')}`,
                  status: 'warning', timeout: 6000
              });
          } catch(_) {
              alert(`⚠️ GAGAL UPDATE EXCHANGER \n${failed.map(f => `- ${f.cex}: ${f.message}`).join('\n')}`);
          }
      }
      // If absolutely nothing succeeded, continue after logging so meta/save still persisted above
      if (aggregated.length === 0) {
          try { setLastAction("UPDATE WALLET EXCHANGER", 'error', { error: 'All CEX updates failed', fail: failed.length }); } catch(_) {}
          $('#loadingOverlay').fadeOut(150);
          return;
      }

      try {
          const key = (typeof getActiveTokenKey === 'function') ? getActiveTokenKey() : 'TOKEN_MULTICHAIN';
          applyWalletStatusToTokenList(key);
      } catch(_) {}

      setLastAction("UPDATE WALLET EXCHANGER", (failed.length>0 ? 'warning' : 'success'), { ok: aggregated.length, fail: failed.length });
      try {
          UIkit.notification({ message: '✅ BERHASIL UPDATE WALLET EXCHANGER', status: 'success' });
      } catch(_) { alert('✅ SEBAGIAN BERHASIL UPDATE WALLET EXCHANGER,SILAKAN CEK STATUS DEPOSIT & WITHDRAW, EXCHANGER YANG GAGAL UPDATE'); }

      try {
          const m = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };
          if (m.type === 'single') {
              if (typeof loadAndDisplaySingleChainTokens === 'function') loadAndDisplaySingleChainTokens();
          } else {
              if (typeof refreshTokensTable === 'function') refreshTokensTable();
          }
      } catch(_) { if (typeof refreshTokensTable === 'function') refreshTokensTable(); }

      $('#loadingOverlay').fadeOut(150);

      // Reload the page after successful update to ensure all views reflect changes
      // Slightly longer delay to allow async IDB writes (history, wallet status) to settle
      try { if (aggregated.length > 0) setTimeout(() => location.reload(), 800); } catch(_) {}
  }

  // Register to App namespace
  if (typeof App.register === 'function') {
    App.register('Services', { CEX: {
      processOrderBook,
      processIndodaxOrderBook,
      exchangeConfig,
      getPriceCEX,
      fetchWalletStatus,
      applyWalletStatusToTokenList,
      checkAllCEXWallets
    }});
  }
})(typeof window !== 'undefined' ? window : this);
