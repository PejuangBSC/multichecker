// =================================================================================
// API AND NETWORK FUNCTIONS
// =================================================================================


/**
 * Fetches the order book for a token pair from a CEX.
 * @param {object} coins - The token object containing pair info.
 * @param {string} NameToken - The base token symbol.
 * @param {string} NamePair - The quote token symbol.
 * @param {string} cex - The CEX name.
 * @param {string} tableBodyId - The ID of the table body to update.
 * @param {function} callback - The callback function (error, result).
 */

/**
 * Fetch USDT/IDR rate from Tokocrypto and cache to storage (IndexedDB).
 * Stores 'PRICE_RATE_USDT' for IDR conversions (e.g., INDODAX display).
 */
function getRateUSDT() {
    const url = "https://cloudme-toko.2meta.app/api/v1/depth?symbol=USDTIDR&limit=5";
    return $.getJSON(url)
        .done(data => {
            if (data && data.bids && data.bids.length > 0) {
                const topBid = parseFloat(data.bids[0][0]); // harga beli tertinggi

                if (!isNaN(topBid) && topBid > 0) {
                    saveToLocalStorage('PRICE_RATE_USDT', topBid);
                } else {
                    console.error("Failed to parse USDT/IDR rate from Tokocrypto response:", data);
                    // refactor: use toast helper
                    if (typeof toast !== 'undefined' && toast.error) toast.error('Gagal parse kurs USDT/IDR dari Tokocrypto.');
                }
            } else {
                console.error("Invalid data structure for USDT/IDR rate from Tokocrypto:", data);
                if (typeof toast !== 'undefined' && toast.error) toast.error('Struktur data kurs dari Tokocrypto tidak valid.');
            }
        })
        .fail((jqXHR, textStatus, errorThrown) => {
            console.error("Failed to fetch USDT/IDR rate from Tokocrypto:", textStatus, errorThrown);
            if (typeof toast !== 'undefined' && toast.error) toast.error('Gagal mengambil kurs USDT/IDR dari Tokocrypto.');
        });
}

/**
 * Fetch gas metrics (gwei and USD) for active chains and cache to 'ALL_GAS_FEES'.
 * Resolves chain list based on current app mode and filters.
 */
async function feeGasGwei() {
    // Determine which chains to fetch gas for (mode-aware)
    let chains = [];
    try {
        if (Array.isArray(window.CURRENT_CHAINS) && window.CURRENT_CHAINS.length) {
            chains = window.CURRENT_CHAINS.map(c=>String(c).toLowerCase());
        } else if (typeof getAppMode === 'function') {
            const m = getAppMode();
            if (m.type === 'single' && m.chain) chains = [String(m.chain).toLowerCase()];
            else if (typeof getFilterMulti === 'function') {
                const fm = getFilterMulti();
                if (fm && Array.isArray(fm.chains) && fm.chains.length) chains = fm.chains.map(c=>String(c).toLowerCase());
            }
        }
    } catch(_) {}
    if (!chains.length) return; // no active chains -> skip fetching

    // Update progress label with chain names for better UX
    try {
        const names = chains
            .map(n => {
                try {
                    const cd = getChainData(n);
                    return (cd?.SHORT_NAME || cd?.Nama_Chain || n).toString().toUpperCase();
                } catch(_) { return String(n).toUpperCase(); }
            })
            .filter(Boolean);
        if (names.length) {
            $('#progress').text(`CHECKING GAS / GWEI CHAINS: ${names.join(', ')}`);
        } else {
            $('#progress').text('CHECKING GAS / GWEI CHAINS...');
        }
    } catch(_) {}

    const chainInfos = chains.map(name => {
        const data = getChainData(name);
        return data ? { ...data, rpc: data.RPC, symbol: data.BaseFEEDEX.replace("USDT", ""), gasLimit: data.GASLIMIT || 21000 } : null;
    }).filter(c => c && c.rpc && c.symbol);

    const symbols = [...new Set(chainInfos.map(c => c.BaseFEEDEX.toUpperCase()))];
    if (!symbols.length) return;

    try {
        const prices = await $.getJSON(`https://api-gcp.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`);
        const tokenPrices = Object.fromEntries(prices.map(p => [p.symbol.replace('USDT', ''), parseFloat(p.price)]));

        const gasResults = await Promise.all(chainInfos.map(async (chain) => {
            const price = tokenPrices[chain.symbol.toUpperCase()];
            if (!price) return null;
            try {
                const web3 = new Web3(new Web3.providers.HttpProvider(chain.rpc));
                const block = await web3.eth.getBlock("pending");
                const baseFee = Number(block?.baseFeePerGas ?? await web3.eth.getGasPrice());
                const gwei = (baseFee / 1e9) * 2;
                const gasUSD = (gwei * chain.gasLimit * price) / 1e9;
                return { chain: chain.Nama_Chain, key: chain.key || chain.symbol, symbol: chain.symbol, tokenPrice: price, gwei, gasUSD };
            } catch { return null; }
        }));
        // Keep previous label; readiness is updated by caller
        saveToLocalStorage("ALL_GAS_FEES", gasResults.filter(Boolean));
    } catch (err) { console.error("Gagal ambil harga token gas:", err); }
}

/**
 * Calculate HMAC signature for CEX API requests.
 * @param {string} exchange - Exchange key (e.g., BINANCE, MEXC, OKX)
 * @param {string} apiSecret - Secret key
 * @param {string} dataToSign - Raw query string/body
 * @returns {string|null} signature
 */
function calculateSignature(exchange, apiSecret, dataToSign) {
    if (!apiSecret || !dataToSign) return null;
    const method = exchange.toUpperCase() === "OKX" ? "HmacSHA256" : "HmacSHA256";
    const encoding = exchange.toUpperCase() === "OKX" ? CryptoJS.enc.Base64 : CryptoJS.enc.Hex;
    return CryptoJS[method](dataToSign, apiSecret).toString(encoding);
}

/**
 * Pick a random OKX Web3 DEX API key from pool.
 * @param {Array<{ApiKeyOKX:string}>} keys
 * @returns {any}
 */
function getRandomApiKeyOKX(keys) {
    if (!keys || keys.length === 0) {
        throw new Error("OKX API keys are not available.");
    }
    return keys[Math.floor(Math.random() * keys.length)];
}

/**
 * Send a compact status message to Telegram (startup/online, etc.).
 */
function sendTelegramHTML(message) {
    try {
        if (!CONFIG_TELEGRAM || !CONFIG_TELEGRAM.BOT_TOKEN || !CONFIG_TELEGRAM.CHAT_ID) return;
        const url = `https://api.telegram.org/bot${CONFIG_TELEGRAM.BOT_TOKEN}/sendMessage`;
        const payload = { chat_id: CONFIG_TELEGRAM.CHAT_ID, text: message, parse_mode: "HTML", disable_web_page_preview: true };
        $.post(url, payload);
    } catch(_) { /* noop */ }
}

function sendStatusTELE(user, status) {
    const message = `<b>#MULTICHECKER</b>\n<b>USER:</b> ${user ? user.toUpperCase() : '-'}[<b>${status ? status.toUpperCase() : '-'}]</b>`;
    sendTelegramHTML(message);
}

/**
 * Send a detailed arbitrage signal message to Telegram.
 * Links include CEX trade pages and DEX aggregator swap link.
 */
function MultisendMessage(cex, dex, tokenData, modal, PNL, priceBUY, priceSELL, FeeSwap, FeeWD, totalFee, nickname, direction) {
    const chainConfig = CONFIG_CHAINS[String(tokenData.chain || '').toLowerCase()];
    if (!chainConfig) return;

    // Symbols and contracts oriented by route direction
    const fromSymbol = direction === 'cex_to_dex' ? tokenData.symbol : tokenData.pairSymbol; // input
    const toSymbol   = direction === 'cex_to_dex' ? tokenData.pairSymbol : tokenData.symbol; // output
    const scIn  = direction === 'cex_to_dex' ? tokenData.contractAddress      : tokenData.pairContractAddress;
    const scOut = direction === 'cex_to_dex' ? tokenData.pairContractAddress  : tokenData.contractAddress;

    // Useful links
    const urls = GeturlExchanger(String(cex).toUpperCase(), fromSymbol, toSymbol) || {};
    const linkCexTradeToken = urls.tradeToken || '#';
    const linkCexTradePair  = urls.tradePair  || '#';
    // WD/DP URLs
    const wdTokenUrl = urls.withdrawTokenUrl || urls.withdrawUrl || '#';
    const dpTokenUrl = urls.depositTokenUrl  || urls.depositUrl  || '#';
    const wdPairUrl  = urls.withdrawPairUrl  || urls.withdrawUrl || '#';
    const dpPairUrl  = urls.depositPairUrl   || urls.depositUrl  || '#';
    const linkCexTrade = direction === 'cex_to_dex' ? linkCexTradeToken : linkCexTradePair;
    const linkDefillama = `https://swap.defillama.com/?chain=${chainConfig.Nama_Chain}&from=${scIn}&to=${scOut}`;
    const linkScToken = `${chainConfig.URL_Chain}/token/${tokenData.contractAddress}`;
    const linkScPair  = `${chainConfig.URL_Chain}/token/${tokenData.pairContractAddress}`;

    // Resolve deposit/withdraw statuses for both token and pair
    const chainKey = String(tokenData.chain||'').toLowerCase();
    let depTok, wdTok, depPair, wdPair;
    let stockLink = '#';
    try {
        const listChain = (typeof getTokensChain === 'function') ? getTokensChain(chainKey) : [];
        const listMulti = (typeof getTokensMulti === 'function') ? getTokensMulti() : [];
        const flat = ([])
            .concat(Array.isArray(listChain)? listChain : [])
            .concat(Array.isArray(listMulti)? listMulti : []);
        const flatAll = (typeof flattenDataKoin === 'function') ? flattenDataKoin(flat) : [];
        const match = (flatAll || []).find(e =>
            String(e.cex||'').toUpperCase() === String(cex||'').toUpperCase() &&
            String(e.chain||'').toLowerCase() === chainKey &&
            String(e.symbol_in||'').toUpperCase() === String(tokenData.symbol||'').toUpperCase() &&
            String(e.symbol_out||'').toUpperCase() === String(tokenData.pairSymbol||'').toUpperCase()
        );
        if (match) {
            depTok = match.depositToken; wdTok = match.withdrawToken; depPair = match.depositPair; wdPair = match.withdrawPair;
        }

        // Build STOK link like detail column (#1 link stok)
        const chainData = getChainData(chainKey);
        const walletObj = chainData?.CEXCHAIN?.[String(cex).toUpperCase()] || {};
        const firstAddr = Object.entries(walletObj)
            .filter(([k,v]) => /address/i.test(String(k)) && v && v !== '#')
            .map(([,v]) => String(v))[0];
        if (firstAddr) {
            // use input token contract for stock inspection, aligned with direction
            const scForStock = (direction === 'cex_to_dex') ? tokenData.contractAddress : tokenData.pairContractAddress;
            stockLink = `${chainConfig.URL_Chain}/token/${scForStock}?a=${firstAddr}`;
        }
    } catch(_) {}
    const emo = (v) => (v===true ? '✅' : (v===false ? '❌' : '❓'));

    // Header and process line (respect direction)
    const procLeft  = (direction === 'cex_to_dex') ? String(cex).toUpperCase() : String(dex).toUpperCase();
    const procRight = (direction === 'cex_to_dex') ? String(dex).toUpperCase() : String(cex).toUpperCase();

    // Compose message in requested plain format
    const lines = [];
    lines.push('=============================');
    lines.push(`#MULTICECKER #${String(chainConfig.Nama_Chain||'').toUpperCase()}`);
    lines.push(`#INFO_USER : #${String(nickname||'').trim()||'-'}`);
    lines.push('=============================');
    lines.push(`<b>PROSES :</b> ${procLeft} => ${procRight}`);
    // TRANSAKSI: symbol text is clickable (links to SC explorer)
    lines.push(`<b>TRANSAKSI :</b> <a href="${linkScToken}">${String(fromSymbol).toUpperCase()}</a> => <a href="${linkScPair}">${String(toSymbol).toUpperCase()}</a>`);
    // STOK: clickable text
    lines.push(`<b>MODAL & STOK :</b> ${Number(modal||0).toFixed(2)}$ | <a href="${stockLink}">STOK</a>`);
    // BUY/SELL link depends on direction
    const buyLinkText  = (direction === 'cex_to_dex') ? linkCexTradeToken : linkDefillama;
    const sellLinkText = (direction === 'cex_to_dex') ? linkDefillama : linkCexTradePair;
    // Token text itself is the clickable link to the proper BUY/SELL destination
    lines.push(`<b>BUY</b> <a href="${buyLinkText}">${String(tokenData.symbol||'').toUpperCase()}</a> : ${Number(priceBUY||0).toFixed(10)}$`);
    lines.push(`<b>SELL</b> <a href="${sellLinkText}">${String(tokenData.symbol||'').toUpperCase()}</a> : ${Number(priceSELL||0).toFixed(10)}$`);
    lines.push(`<b>PNL & TOTAL FEE :</b> ${Number(PNL||0).toFixed(2)}$ & ${Number(totalFee||0).toFixed(2)}$`);
    lines.push(`<b>FEE WD & FEE SWAP :</b> ${Number(FeeWD||0).toFixed(2)}$ & ${Number(FeeSwap||0).toFixed(2)}$`);
    // Status + links WD/DP (emoji ON/OFF)
    const tokenSym = String(tokenData.symbol||'').toUpperCase();
    const pairSym  = String(tokenData.pairSymbol||'').toUpperCase();
    lines.push(`<b>${tokenSym}:</b> <a href="${wdTokenUrl}">WD</a>${emo(wdTok)} | <a href="${dpTokenUrl}">DP</a>${emo(depTok)}`);
    lines.push(`<b>${pairSym}:</b> <a href="${wdPairUrl}">WD</a>${emo(wdPair)} | <a href="${dpPairUrl}">DP</a>${emo(depPair)}`);

    sendTelegramHTML(lines.join('\n'));
}
// [moved later] CEX Shims will be appended at end of file to override earlier defs
// =================================================================================
// Helpers
// =================================================================================
const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function infoSet(msg){
  try {
    // Respect RUN banner: if any run state is active, do not override
    const st = (typeof getAppState === 'function') ? getAppState() : { run: 'NO' };
    const anyRun = (String(st.run||'NO').toUpperCase() === 'YES') || (window.RUN_STATES && Object.values(window.RUN_STATES).some(Boolean));
    if (anyRun) { if (typeof window.updateRunningChainsBanner === 'function') window.updateRunningChainsBanner(); return; }
  } catch(_) {}
  try{$('#infoAPP').html(msg);}catch(_){}
  // debug logs removed
}
function infoAdd(msg){
  try {
    const st = (typeof getAppState === 'function') ? getAppState() : { run: 'NO' };
    const anyRun = (String(st.run||'NO').toUpperCase() === 'YES') || (window.RUN_STATES && Object.values(window.RUN_STATES).some(Boolean));
    if (anyRun) { if (typeof window.updateRunningChainsBanner === 'function') window.updateRunningChainsBanner(); return; }
  } catch(_) {}
  try{$('#infoAPP').html(`${$('#infoAPP').html()}<br>${msg}`);}catch(_){}
  // debug logs removed
}

// =================================================================================
// CEX Shims (final override to delegate to services)
// =================================================================================
function getPriceCEX(coins, NameToken, NamePair, cex, tableBodyId) {
  if (window.App && window.App.Services && window.App.Services.CEX && typeof window.App.Services.CEX.getPriceCEX === 'function') {
    return window.App.Services.CEX.getPriceCEX(coins, NameToken, NamePair, cex, tableBodyId);
  }
  return Promise.reject(new Error('CEX service not available'));
}

async function fetchWalletStatus(cex) {
  if (window.App && window.App.Services && window.App.Services.CEX && typeof window.App.Services.CEX.fetchWalletStatus === 'function') {
    return window.App.Services.CEX.fetchWalletStatus(cex);
  }
  return [];
}

function applyWalletStatusToTokenList(tokenListName) {
  if (window.App && window.App.Services && window.App.Services.CEX && typeof window.App.Services.CEX.applyWalletStatusToTokenList === 'function') {
    return window.App.Services.CEX.applyWalletStatusToTokenList(tokenListName);
  }
}

async function checkAllCEXWallets() {
  if (window.App && window.App.Services && window.App.Services.CEX && typeof window.App.Services.CEX.checkAllCEXWallets === 'function') {
    return window.App.Services.CEX.checkAllCEXWallets();
  }
}

// =================================================================================
// DEX Shims (final override to delegate to services)
// =================================================================================
function getPriceDEX(sc_input_in, des_input, sc_output_in, des_output, amount_in, PriceRate, dexType, NameToken, NamePair, cex, chainName, codeChain, action, tableBodyId) {
  if (window.App && window.App.Services && window.App.Services.DEX && typeof window.App.Services.DEX.getPriceDEX === 'function') {
    return window.App.Services.DEX.getPriceDEX(sc_input_in, des_input, sc_output_in, des_output, amount_in, PriceRate, dexType, NameToken, NamePair, cex, chainName, codeChain, action, tableBodyId);
  }
  return Promise.reject(new Error('DEX service not available'));
}

function getPriceSWOOP(sc_input, des_input, sc_output, des_output, amount_in, PriceRate,  dexType, NameToken, NamePair, cex,nameChain,codeChain,action) {
  if (window.App && window.App.Services && window.App.Services.DEX && typeof window.App.Services.DEX.getPriceSWOOP === 'function') {
    return window.App.Services.DEX.getPriceSWOOP(sc_input, des_input, sc_output, des_output, amount_in, PriceRate,  dexType, NameToken, NamePair, cex,nameChain,codeChain,action);
  }
  return Promise.reject(new Error('DEX service not available'));
}
