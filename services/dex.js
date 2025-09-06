// =================================================================================
// DEX Service Module (moved intact) — Pindahkan utuh + shim
// =================================================================================
/**
 * DEX Service Module
 * - Strategy-based price quoting per aggregator (Kyber, 1inch, 0x/Matcha, Odos, OKX, LiFi)
 * - getPriceDEX builds request and parses response per DEX
 */
(function initDEXService(global){
  const root = global || (typeof window !== 'undefined' ? window : {});
  const App = root.App || (root.App = {});

  const dexStrategies = {
    kyberswap: {
      buildRequest: ({ chainName, sc_input, sc_output, amount_in_big }) => {
        const kyberUrl = `https://aggregator-api.kyberswap.com/${chainName.toLowerCase()}/api/v1/routes?tokenIn=${sc_input}&tokenOut=${sc_output}&amountIn=${amount_in_big}&gasInclude=true`;
        return { url: kyberUrl, method: 'GET' };
      },
      parseResponse: (response, { des_output, chainName }) => {
        if (!response?.data?.routeSummary) throw new Error("Invalid KyberSwap response structure");
        return {
          amount_out: response.data.routeSummary.amountOut / Math.pow(10, des_output),
          FeeSwap: parseFloat(response.data.routeSummary.gasUsd) || getFeeSwap(chainName),
          dexTitle: 'KYBERSWAP'
        };
      }
    },
    '1inch': {
      buildRequest: ({ action, SavedSettingData, codeChain, amount_in_big, sc_input, des_input, sc_output, des_output }) => {
        if (action === "TokentoPair") {
          return {
            url: "https://api.dzap.io/v1/quotes",
            method: 'POST',
            data: JSON.stringify({
              account: SavedSettingData.walletMeta || '0x0000000000000000000000000000000000000000',
              fromChain: codeChain,
              integratorId: 'dzap',
              allowedSources: ["oneInchViaLifi"],
              data: [{ amount: amount_in_big.toString(), srcToken: sc_input, srcDecimals: des_input, destToken: sc_output, destDecimals: des_output, slippage: 0.3, toChain: codeChain }]
            })
          };
        }
        return {
          url: "https://api-v1.marbleland.io/api/v1/jumper/api/p/lifi/advanced/routes",
          method: 'POST',
          data: JSON.stringify({
            fromAmount: amount_in_big.toString(), fromChainId: codeChain, fromTokenAddress: sc_input, toChainId: codeChain, toTokenAddress: sc_output,
            options: { integrator: "swap.marbleland.io", order: "CHEAPEST", exchanges: { allow: ["1inch"] } }
          })
        };
      },
      parseResponse: (response, { action, des_output, chainName }) => {
        let amount_out, FeeSwap;
        if (action === "TokentoPair") {
          const key = Object.keys(response)[0];
          const quoteData = response?.[key]?.quoteRates?.oneInchViaLifi;
          if (!quoteData) throw new Error("1inch quote not found in DZAP response");
          amount_out = parseFloat(quoteData.toAmount ?? quoteData.destAmount ?? 0) / Math.pow(10, des_output);
          FeeSwap = parseFloat(quoteData.fee?.gasFee?.[0]?.amountUSD) || getFeeSwap(chainName);
        } else {
          const route = response?.routes?.[0];
          if (!route) throw new Error("1inch route not found in LiFi response");
          amount_out = parseFloat(route.toAmount ?? 0) / Math.pow(10, des_output);
          FeeSwap = parseFloat(route.gasCostUSD) || getFeeSwap(chainName);
        }
        return { amount_out, FeeSwap, dexTitle: '1INCH' };
      }
    },
    odos: {
      buildRequest: ({ action, codeChain, SavedSettingData, amount_in_big, sc_input, sc_output }) => {
        const url = "https://api.odos.xyz/sor/quote/v3";
        return {
          url,
          method: 'POST',
          data: JSON.stringify({
            chainId: codeChain, compact: true, disableRFQs: true, userAddr: SavedSettingData.walletMeta,
            inputTokens: [{ amount: amount_in_big.toString(), tokenAddress: sc_input }],
            outputTokens: [{ proportion: 1, tokenAddress: sc_output }],
            slippageLimitPercent: 0.3
          })
        };
      },
      parseResponse: (response, { des_output, chainName }) => {
        if (!response?.outAmounts) throw new Error("Invalid Odos response structure");
        return {
          amount_out: parseFloat(response.outAmounts) / Math.pow(10, des_output),
          FeeSwap: response.gasEstimateValue || getFeeSwap(chainName),
          dexTitle: 'ODOS'
        };
      }
    },
    '0x': {
      buildRequest: ({ chainName, sc_input_in, sc_output_in, amount_in_big, codeChain, sc_output, sc_input }) => {
        const url = chainName.toLowerCase() === 'solana'
          ? `https://matcha.xyz/api/swap/quote/solana?sellTokenAddress=${sc_input_in}&buyTokenAddress=${sc_output_in}&sellAmount=${amount_in_big}&dynamicSlippage=true&slippageBps=50&userPublicKey=Eo6CpSc1ViboPva7NZ1YuxUnDCgqnFDXzcDMDAF6YJ1L`
          : `https://matcha.xyz/api/swap/price?chainId=${codeChain}&buyToken=${sc_output}&sellToken=${sc_input}&sellAmount=${amount_in_big}`;
        return { url, method: 'GET' };
      },
      parseResponse: (response, { des_output, chainName }) => {
        if (!response?.buyAmount) throw new Error("Invalid 0x response structure");
        return {
          amount_out: response.buyAmount / Math.pow(10, des_output),
          FeeSwap: getFeeSwap(chainName),
          dexTitle: '0X'
        };
      }
    },
    okx: {
      buildRequest: ({ amount_in_big, codeChain, sc_input_in, sc_output_in }) => {
        const selectedApiKey = getRandomApiKeyOKX(apiKeysOKXDEX);
        const timestamp = new Date().toISOString();
        const path = "/api/v5/dex/aggregator/quote";
        const queryParams = `amount=${amount_in_big}&chainIndex=${codeChain}&fromTokenAddress=${sc_input_in}&toTokenAddress=${sc_output_in}`;
        const dataToSign = timestamp + "GET" + path + "?" + queryParams;
        const signature = calculateSignature("OKX", selectedApiKey.secretKeyOKX, dataToSign);
        return {
          url: `https://web3.okx.com${path}?${queryParams}`,
          method: 'GET',
          headers: { "OK-ACCESS-KEY": selectedApiKey.ApiKeyOKX, "OK-ACCESS-SIGN": signature, "OK-ACCESS-PASSPHRASE": selectedApiKey.PassphraseOKX, "OK-ACCESS-TIMESTAMP": timestamp, "Content-Type": "application/json" }
        };
      },
      parseResponse: (response, { des_output, chainName }) => {
        if (!response?.data?.[0]?.toTokenAmount) throw new Error("Invalid OKX response structure");
        return {
          amount_out: response.data[0].toTokenAmount / Math.pow(10, des_output),
          FeeSwap: getFeeSwap(chainName),
          dexTitle: 'OKX'
        };
      }
    }
  };
  // alias
  dexStrategies.lifi = dexStrategies['1inch'];

  /**
   * Quote swap output from a DEX aggregator.
   * Builds request by strategy, applies timeout, and returns parsed amounts.
   */
  function getPriceDEX(sc_input_in, des_input, sc_output_in, des_output, amount_in, PriceRate, dexType, NameToken, NamePair, cex, chainName, codeChain, action, tableBodyId) {
    return new Promise((resolve, reject) => {
      const sc_input = sc_input_in.toLowerCase();
      const sc_output = sc_output_in.toLowerCase();
      const SavedSettingData = getFromLocalStorage('SETTING_SCANNER', {});
      const timeoutMilliseconds = Math.max(4500, Math.round((SavedSettingData.speedScan || 2) * 1000));
      const amount_in_big = BigInt(Math.round(Math.pow(10, des_input) * amount_in));

      // Resolve strategy from registry configuration when provided
      let strategyKey = String(dexType||'').toLowerCase();
      try {
        if (root.DEX && typeof root.DEX.get === 'function') {
          const entry = root.DEX.get(dexType);
          if (entry && entry.strategy) strategyKey = String(entry.strategy).toLowerCase();
        }
      } catch(_) {}
      const strategy = dexStrategies[strategyKey];
      if (!strategy) return reject(new Error(`Unsupported DEX type: ${dexType}`));

      try {
        const requestParams = { chainName, sc_input, sc_output, amount_in_big, des_output, SavedSettingData, codeChain, action, des_input, sc_input_in, sc_output_in };
        const { url, method, data, headers } = strategy.buildRequest(requestParams);

        // Apply proxy if configured for this DEX
        const cfg = (typeof DEX !== 'undefined' && DEX.get) ? (DEX.get(dexType) || {}) : {};
        const useProxy = !!cfg.proxy;
        const proxyPrefix = (root.CONFIG_PROXY && root.CONFIG_PROXY.PREFIX) ? String(root.CONFIG_PROXY.PREFIX) : '';
        const finalUrl = (useProxy && proxyPrefix && typeof url === 'string' && !url.startsWith(proxyPrefix)) ? (proxyPrefix + url) : url;

        $.ajax({
          url: finalUrl, method, dataType: 'json', timeout: timeoutMilliseconds, headers, data,
          contentType: data ? 'application/json' : undefined,
          success: function (response) {
            try {
              const { amount_out, FeeSwap, dexTitle } = strategy.parseResponse(response, requestParams);
              resolve({ dexTitle, sc_input, des_input, sc_output, des_output, FeeSwap, amount_out, apiUrl: url, tableBodyId });
            } catch (error) {
              reject({ statusCode: 500, pesanDEX: `Parse Error: ${error.message}`, DEX: dexType.toUpperCase() });
            }
          },
          error: function (xhr, textStatus, errorThrown) {
            let alertMessage = `Error: ${textStatus}`;
            if (textStatus === 'timeout') alertMessage = 'Request Timeout';
            const linkDEX = generateDexLink(dexType, chainName, codeChain, NameToken, sc_input_in, NamePair, sc_output_in);
            reject({ statusCode: xhr.status, pesanDEX: `${dexType.toUpperCase()}: ${alertMessage}`, DEX: dexType.toUpperCase(), dexURL: linkDEX });
          },
        });
      } catch (error) {
        reject({ statusCode: 500, pesanDEX: `Request Build Error: ${error.message}`, DEX: dexType.toUpperCase() });
      }
    });
  }

  /**
   * Optional fallback quoting via external SWOOP service.
   */
  function getPriceSWOOP(sc_input, des_input, sc_output, des_output, amount_in, PriceRate, dexType, NameToken, NamePair, cex, nameChain, codeChain, action) {
    return new Promise((resolve, reject) => {
      const SavedSettingData = getFromLocalStorage('SETTING_SCANNER', {});
      const payload = {
        chainId: codeChain, aggregatorSlug: dexType.toLowerCase(), sender: SavedSettingData.walletMeta,
        inToken: { chainId: codeChain, type: 'TOKEN', address: sc_input.toLowerCase(), decimals: parseFloat(des_input) },
        outToken: { chainId: codeChain, type: 'TOKEN', address: sc_output.toLowerCase(), decimals: parseFloat(des_output) },
        amountInWei: String(BigInt(Math.round(Number(amount_in) * Math.pow(10, des_input)))),
        slippageBps: '100', gasPriceGwei: Number(getFromLocalStorage('gasGWEI', 0)),
      };
      const timeoutMilliseconds = (SavedSettingData.speedScan || 4) * 1000;

      $.ajax({
        url: 'https://bzvwrjfhuefn.up.railway.app/swap',
        type: 'POST', contentType: 'application/json', data: JSON.stringify(payload), timeout: timeoutMilliseconds,
        success: function (response) {
          if (!response || !response.amountOutWei) return reject({ pesanDEX: 'SWOOP response invalid' });
          const amount_out = parseFloat(response.amountOutWei) / Math.pow(10, des_output);
          const FeeSwap = getFeeSwap(nameChain);
          // Keep dexTitle as the main DEX/aggregator name only (no "via ..." suffix)
          resolve({ dexTitle: dexType, sc_input, des_input, sc_output, des_output, FeeSwap, dex: dexType, amount_out });
        },
        error: function (xhr, textStatus) {
          let alertMessage = `Error: ${textStatus}`;
          if (textStatus === 'timeout') alertMessage = 'Request Timeout';
          // refactor: use shared dark-mode helper for error color
          const isDark = (typeof window !== 'undefined' && window.isDarkMode && window.isDarkMode()) || (typeof document !== 'undefined' && document.body && document.body.classList.contains('dark-mode'));
          const errColor = isDark ? '#7e3636' : '#ffcccc';
          reject({ statusCode: xhr.status, pesanDEX: `SWOOP: ${alertMessage}`, color: errColor, DEX: dexType.toUpperCase() });
        }
      });
    });
  }

  if (typeof App.register === 'function') {
    App.register('Services', { DEX: { dexStrategies, getPriceDEX, getPriceSWOOP } });
  }

  // Lightweight DEX registry for link builders and policy
  (function initDexRegistry(){
    const REG = new Map();
    function norm(n){ return String(n||'').toLowerCase(); }
    const DexAPI = {
      register(name, def){
        const key = norm(name);
        if (!key) return;
        const entry = {
          builder: def?.builder,
          allowFallback: !!def?.allowFallback,
          strategy: def?.strategy || null,
          proxy: !!def?.proxy,
        };
        REG.set(key, entry);
        // keep CONFIG_DEXS in sync for existing callers
        root.CONFIG_DEXS = root.CONFIG_DEXS || {};
        root.CONFIG_DEXS[key] = root.CONFIG_DEXS[key] || {};
        if (typeof entry.builder === 'function') root.CONFIG_DEXS[key].builder = entry.builder;
        if ('allowFallback' in entry) root.CONFIG_DEXS[key].allowFallback = entry.allowFallback;
        if ('proxy' in entry) root.CONFIG_DEXS[key].proxy = entry.proxy;
      },
      get(name){ return REG.get(norm(name)) || null; },
      list(){ return Array.from(REG.keys()); }
    };

    // Seed from existing CONFIG_DEXS if present (builder, allowFallback, strategy)
    try {
      Object.keys(root.CONFIG_DEXS || {}).forEach(k => {
        const d = root.CONFIG_DEXS[k] || {};
        DexAPI.register(k, { builder: d.builder, allowFallback: !!d.allowFallback, strategy: d.STRATEGY || null, proxy: !!d.proxy });
      });
    } catch(_){}

    root.DEX = DexAPI;
  })();
})(typeof window !== 'undefined' ? window : this);
