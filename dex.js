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

  // Map HTTP status codes to concise Indonesian descriptions for UI titles
  function describeHttpStatus(code) {
    const map = {
      // 3xx
      300: 'Multiple Choices — Banyak pilihan resource',
      301: 'Moved Permanently — URL pindah permanen',
      302: 'Found — Redirect sementara',
      303: 'See Other — Redirect dengan GET',
      304: 'Not Modified — Pakai cache',
      307: 'Temporary Redirect — Redirect sementara (method sama)',
      308: 'Permanent Redirect — Redirect permanen (method sama)',
      // 4xx
      400: 'Bad Request — Format request salah',
      401: 'Unauthorized — Token/Auth diperlukan',
      402: 'Payment Required — Terkait pembayaran (jarang)',
      403: 'Forbidden — Akses dilarang',
      404: 'Not Found — Resource tidak ada',
      405: 'Method Not Allowed — Method HTTP salah',
      406: 'Not Acceptable — Format tidak didukung',
      407: 'Proxy Auth Required — Autentikasi proxy',
      408: 'Request Timeout — Permintaan terlalu lama',
      409: 'Conflict — Konflik data',
      410: 'Gone — Resource sudah dihapus',
      411: 'Length Required — Header Content-Length wajib',
      412: 'Precondition Failed — If-* gagal',
      413: 'Payload Too Large — Data terlalu besar',
      414: 'URI Too Long — URL terlalu panjang',
      415: 'Unsupported Media Type — Format tidak didukung',
      416: 'Range Not Satisfiable — Range request salah',
      417: 'Expectation Failed — Header Expect gagal',
      421: 'Misdirected Request — Server tujuan salah',
      422: 'Unprocessable Entity — Validasi gagal',
      423: 'Locked — Resource terkunci',
      424: 'Failed Dependency — Ketergantungan gagal',
      425: 'Too Early — Terlalu cepat',
      426: 'Upgrade Required — Wajib upgrade protokol',
      428: 'Precondition Required — Butuh precondition',
      429: 'Too Many Requests — Rate limiting',
      431: 'Header Fields Too Large — Header terlalu besar',
      451: 'Unavailable For Legal Reasons — Diblokir secara legal',
      // 5xx
      500: 'Internal Server Error — Error di sisi server',
      501: 'Not Implemented — Endpoint belum tersedia',
      502: 'Bad Gateway — Kesalahan di gateway/proxy',
      503: 'Service Unavailable — Server sibuk/maintenance',
      504: 'Gateway Timeout — Timeout di server/gateway',
      505: 'HTTP Version Not Supported — Versi tidak didukung',
      507: 'Insufficient Storage — Server kehabisan ruang',
      508: 'Loop Detected — Loop di server',
      510: 'Not Extended — Butuh extension tambahan',
      511: 'Network Auth Required — Login ke jaringan',
    };
    return map[Number(code)] || `HTTP ${code} — Error dari server`;
  }

  const dexStrategies = {
    kyber: {
      buildRequest: ({ chainName, sc_input, sc_output, amount_in_big }) => {
        const kyberUrl = `https://aggregator-api.kyberswap.com/${chainName.toLowerCase()}/api/v1/routes?tokenIn=${sc_input}&tokenOut=${sc_output}&amountIn=${amount_in_big}&gasInclude=true`;
        return { url: kyberUrl, method: 'GET' };
      },
      parseResponse: (response, { des_output, chainName }) => {
        if (!response?.data?.routeSummary) throw new Error("Invalid KyberSwap response structure");
        return {
          amount_out: response.data.routeSummary.amountOut / Math.pow(10, des_output),
          FeeSwap: parseFloat(response.data.routeSummary.gasUsd) || getFeeSwap(chainName),
          dexTitle: 'KYBER'
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
  // Back-compat alias: support legacy 'kyberswap' key
  dexStrategies.kyberswap = dexStrategies.kyber;
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
      const timeoutMilliseconds = Math.max(Math.round((SavedSettingData.speedScan || 4) * 1000));
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
            let status = 0;
            try { status = Number(xhr && xhr.status) || 0; } catch(_) {}
            const isParser = String(textStatus||'').toLowerCase() === 'parsererror';
            let coreMsg;
            if (textStatus === 'timeout') coreMsg = 'Request Timeout';
            else if (status === 200) coreMsg = isParser ? 'Parser Error (200)' : 'XHR Error (200)';
            else if (status > 0) coreMsg = describeHttpStatus(status);
            else coreMsg = `Error: ${textStatus||'unknown'}`;

            const label = status > 0 ? (status === 200 ? '[XHR ERROR 200]' : `[HTTP ${status}]`) : '';
            const linkDEX = generateDexLink(dexType, chainName, codeChain, NameToken, sc_input_in, NamePair, sc_output_in);
            reject({ statusCode: status, pesanDEX: `${dexType.toUpperCase()}: ${label} ${coreMsg}` , DEX: dexType.toUpperCase(), dexURL: linkDEX, textStatus });
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
          let status = 0;
          try { status = Number(xhr && xhr.status) || 0; } catch(_) {}
          const isParser = String(textStatus||'').toLowerCase() === 'parsererror';
          let coreMsg;
          if (textStatus === 'timeout') coreMsg = 'Request Timeout';
          else if (status === 200) coreMsg = isParser ? 'Parser Error (200)' : 'XHR Error (200)';
          else if (status > 0) coreMsg = describeHttpStatus(status);
          else coreMsg = `Error: ${textStatus||'unknown'}`;
          const prefix = status > 0 ? (status === 200 ? '[XHR ERROR 200]' : `[HTTP ${status}]`) : '';
          // refactor: use shared dark-mode helper for error color
          const isDark = (typeof window !== 'undefined' && window.isDarkMode && window.isDarkMode()) || (typeof document !== 'undefined' && document.body && document.body.classList.contains('dark-mode'));
          const errColor = isDark ? '#7e3636' : '#ffcccc';
          reject({ statusCode: status, pesanDEX: `SWOOP: ${prefix} ${coreMsg}`, color: errColor, DEX: dexType.toUpperCase(), textStatus });
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
