// =================================================================================
// SCANNER LOGIC
// =================================================================================

// refactor: small DOM helpers to eliminate duplicate span creation logic
function ensureDexStatusSpan(cell) {
    if (!cell) return null;
    let statusSpan = cell.querySelector('.dex-status');
    if (statusSpan) return statusSpan;
    const strong = cell.querySelector('strong');
    if (strong) {
        const br = document.createElement('br');
        strong.insertAdjacentElement('afterend', br);
        statusSpan = document.createElement('span');
        statusSpan.className = 'dex-status';
        br.insertAdjacentElement('afterend', statusSpan);
        return statusSpan;
    }
    statusSpan = document.createElement('span');
    statusSpan.className = 'dex-status';
    cell.appendChild(statusSpan);
    return statusSpan;
}

// refactor: normalized setter for error background honoring dark-mode
function setDexErrorBackground(cell, fallbackColor) {
    if (!cell) return;
    // refactor: use shared dark-mode helper
    const isDark = (typeof window !== 'undefined' && window.isDarkMode && window.isDarkMode()) || (typeof document !== 'undefined' && document.body && document.body.classList.contains('dark-mode'));
    cell.style.backgroundColor = fallbackColor || (isDark ? '#651313' : '#ffcccc');
}

// refactor: global watchdog helpers to avoid duplicate inline implementations
function getDexWatchdogMap(){
    if (typeof window === 'undefined') return new Map();
    window._DEX_WATCHDOGS = window._DEX_WATCHDOGS || new Map();
    return window._DEX_WATCHDOGS;
}
function setDexWatchdog(key, fn, delay){
    const map = getDexWatchdogMap();
    if (map.has(key)) clearTimeout(map.get(key));
    map.set(key, setTimeout(fn, delay));
}
function clearDexWatchdog(key){
    const map = getDexWatchdogMap();
    if (map.has(key)) { clearTimeout(map.get(key)); map.delete(key); }
}
function clearDexWatchdogs(keys){
    (Array.isArray(keys) ? keys : [keys]).forEach(k => clearDexWatchdog(k));
}

let animationFrameId;
let isScanRunning = false;

/**
 * Start the scanning process for a flattened list of tokens.
 * - Batches tokens per group (scanPerKoin)
 * - For each token: fetch CEX orderbook → quote DEX routes → compute PNL → update UI
 */
async function startScanner(tokensToScan, settings, tableBodyId) {
    // Cancel any pending autorun countdown when a new scan starts // REFACTORED
    clearInterval(window.__autoRunInterval);
    window.__autoRunInterval = null;
    $('#autoRunCountdown').text(''); // REFACTORED
    try {
        if (typeof getHistoryLog === 'function') {
            const list = await getHistoryLog();
            const last = Array.isArray(list) && list.length ? list[list.length - 1] : null;
            if (last && last.action && (last.time || last.timeISO)) {
                const t = last.time || new Date(last.timeISO).toLocaleString('id-ID', { hour12: false });
                $('#infoAPP').text(`${last.action} at ${t}`);
            } else {
                $('#infoAPP').empty();
            }
        }
    } catch(_) { $('#infoAPP').empty(); }

    const ConfigScan = settings;
    const mMode = getAppMode();
    let allowedChains = [];
    if (mMode.type === 'single') {
        allowedChains = [String(mMode.chain).toLowerCase()];
    } else {
        const fm = getFilterMulti();
        allowedChains = (fm.chains && fm.chains.length)
            ? fm.chains.map(c => String(c).toLowerCase())
            : Object.keys(CONFIG_CHAINS || {});
    }

    if (!allowedChains || !allowedChains.length) {
        if (typeof toast !== 'undefined' && toast.warning) toast.warning('Tidak ada Chain yang dipilih. Silakan pilih minimal 1 Chain.');
        return;
    }

    // This global is still used by other functions, so we set it here for now.
    window.SavedSettingData = ConfigScan;
    window.CURRENT_CHAINS = allowedChains;

    // Use the passed parameter directly, and filter by the currently allowed chains
    const flatTokens = tokensToScan.filter(t =>
        allowedChains.includes(String(t.chain).toLowerCase())
    );

    if (!flatTokens || flatTokens.length === 0) {
        if (typeof toast !== 'undefined' && toast.info) toast.info('Tidak ada token pada chain terpilih untuk dipindai.');
        return;
    }

    setAppState({ run: 'YES' });
    try {
        if (typeof window.updateRunStateCache === 'function') {
            try { window.updateRunStateCache(getActiveFilterKey(), { run: 'YES' }); } catch(_) {}
        }
        if (typeof window.updateRunningChainsBanner === 'function') {
            const m = getAppMode();
            const preListed = (m.type === 'single') ? [String(m.chain).toLowerCase()] : (allowedChains || []);
            window.updateRunningChainsBanner(preListed);
        }
        if (typeof window.updateToolbarRunIndicators === 'function') window.updateToolbarRunIndicators();
    } catch(_){}
    $('#startSCAN').prop('disabled', true).text('Running...').addClass('uk-button-disabled');
    $('#infoAPP').html('RUN SCANNING...').show();
    // Keep user's search query intact; do not reset searchInput here.
    // Clear previous signals (container uses <div id="sinyal...">)
    $('#sinyal-container [id^="sinyal"]').empty();
    // Hide empty signal cards so none appear at start // REFACTORED
    if (typeof window.hideEmptySignalCards === 'function') window.hideEmptySignalCards();
    // Reset all DEX cells back to default
    resetDexCells(tableBodyId);
    // Apply gating first, then disable globally to ensure edit remains locked during scan
    if (typeof setScanUIGating === 'function') setScanUIGating(true); // REFACTORED
    form_off();
    $("#autoScrollCheckbox").show().prop('disabled', false);
    $("#stopSCAN").show().prop('disabled', false);
    // Use centralized gating to toggle all UI states during scan // REFACTORED
    if (typeof setScanUIGating === 'function') setScanUIGating(true);
    $('.statusCheckbox').css({ 'pointer-events': 'auto', 'opacity': '1' }).prop('disabled', false);

    sendStatusTELE(ConfigScan.nickname, 'ONLINE');

    let scanPerKoin = parseInt(ConfigScan.scanPerKoin || 1);
    let jedaKoin = parseInt(ConfigScan.jedaKoin || 500);
    let jedaTimeGroup = parseInt(ConfigScan.jedaTimeGroup || 1000);
    let speedScan = Math.round(parseFloat(ConfigScan.speedScan || 2) * 1000);

    const jedaDexMap = (ConfigScan || {}).JedaDexs || {};
    const getJedaDex = (dx) => parseInt(jedaDexMap[dx]) || 0;

    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    const isPosChecked = (val) => $('input[type="checkbox"][value="' + val + '"]').is(':checked');

    function updateProgress(current, total, startTime, TokenPair) {
        let duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        let progressPercentage = Math.floor((current / total) * 100);
        let progressText = `CHECKING - ${TokenPair} [${current}/${total}] :: Mulai: ${new Date(startTime).toLocaleTimeString()} ~ DURASI [${duration} Menit]`;
        $('#progress-bar').css('width', progressPercentage + '%');
        $('#progress-text').text(progressPercentage + '%');
        $('#progress').text(progressText);
    }

    let uiUpdateQueue = [];

    function processUiUpdates() {
        if (!isScanRunning && uiUpdateQueue.length === 0) return;

        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const budgetMs = 8; // aim to keep under one frame @120Hz
        let processed = 0;

        while (uiUpdateQueue.length) {
            const updateData = uiUpdateQueue.shift();
            if (updateData && updateData.type === 'error') {
                const { id, color, message, swapMessage } = updateData;
                const cell = document.getElementById(id);
                if (cell) {
                    setDexErrorBackground(cell, color);
                    let statusSpan = ensureDexStatusSpan(cell);
                    if (statusSpan) statusSpan.className = 'dex-status uk-text-danger';
                    statusSpan.classList.remove('uk-text-muted', 'uk-text-warning');
                    statusSpan.classList.add('uk-text-danger');
                    statusSpan.textContent = swapMessage || '[ERROR]';
                    statusSpan.title = message || '';
                }
            } else if (updateData) {
                DisplayPNL(updateData);
            }
            processed++;
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if ((now - start) >= budgetMs) break; // yield to next frame
        }

        // If page is hidden, slow down update loop to save CPU
        if (document.hidden) {
            setTimeout(() => { animationFrameId = requestAnimationFrame(processUiUpdates); }, 100);
        } else {
            animationFrameId = requestAnimationFrame(processUiUpdates);
        }
    }

    async function processRequest(token, tableBodyId) {
        if (!allowedChains.includes(String(token.chain).toLowerCase())) return;
        // Skip processing if token has been deleted during scanning
        try {
            const modeNow = getAppMode();
            let stillExists = false;
            if (modeNow.type === 'single') {
                const list = getTokensChain(modeNow.chain);
                stillExists = Array.isArray(list) && list.some(t => String(t.id) === String(token.id));
            } else {
                const list = getTokensMulti();
                stillExists = Array.isArray(list) && list.some(t => String(t.id) === String(token.id));
            }
            if (!stillExists) return; // token removed; do not fetch
        } catch(_) {}
        try {
            const DataCEX = await getPriceCEX(token, token.symbol_in, token.symbol_out, token.cex, tableBodyId);

            const prices = [DataCEX.priceBuyToken, DataCEX.priceSellToken, DataCEX.priceBuyPair, DataCEX.priceSellPair];
            if (prices.some(p => !isFinite(p) || p <= 0)) {
                if (typeof toast !== 'undefined' && toast.error) toast.error(`CEK MANUAL ${token.symbol_in} di ${token.cex}`);
                return;
            }

            if (token.dexs && Array.isArray(token.dexs)) {
                token.dexs.forEach((dexData) => {
                            const dex = dexData.dex.toLowerCase();
                            const modalKiri = dexData.left;
                            const modalKanan = dexData.right;
                            const amount_in_token = parseFloat(modalKiri) / DataCEX.priceBuyToken;
                            const amount_in_pair = parseFloat(modalKanan) / DataCEX.priceBuyPair;

                            const callDex = (direction) => {
                                const isKiri = direction === 'TokentoPair';
                                if (isKiri && !isPosChecked('Actionkiri')) return;
                                if (!isKiri && !isPosChecked('ActionKanan')) return;

                                const baseId = `${token.cex.toUpperCase()}_${dex.toUpperCase()}_${isKiri ? token.symbol_in : token.symbol_out}_${isKiri ? token.symbol_out : token.symbol_in}_${token.chain.toUpperCase()}`;
                                const idCELL = tableBodyId + '_' + baseId;

                                // Resolve safe token addresses/decimals especially for NON pair
                                const chainCfgSafe = (window.CONFIG_CHAINS || {})[String(token.chain).toLowerCase()] || {};
                                const pairDefsSafe = chainCfgSafe.PAIRDEXS || {};
                                const nonDef = pairDefsSafe['NON'] || {};
                                const isAddrInvalid = (addr) => !addr || String(addr).toLowerCase() === '0x' || String(addr).length < 6;
                                let scInSafe  = isKiri ? token.sc_in  : token.sc_out;
                                let scOutSafe = isKiri ? token.sc_out : token.sc_in;
                                let desInSafe  = isKiri ? Number(token.des_in)  : Number(token.des_out);
                                let desOutSafe = isKiri ? Number(token.des_out) : Number(token.des_in);
                                const symOut = isKiri ? String(token.symbol_out||'') : String(token.symbol_in||'');
                                if (String(symOut).toUpperCase() === 'NON' || isAddrInvalid(scOutSafe)) {
                                    if (nonDef && nonDef.scAddressPair) {
                                        scOutSafe = nonDef.scAddressPair;
                                        desOutSafe = Number(nonDef.desPair || desOutSafe || 18);
                                    }
                                }

                                const updateDexCellStatus = (status, dexName, message = '') => {
                                    const cell = document.getElementById(idCELL);
                                    if (!cell) return;
                                    cell.style.backgroundColor = '';
                                    let statusSpan = ensureDexStatusSpan(cell);
                                    statusSpan.removeAttribute('title');
                                    statusSpan.classList.remove('uk-text-muted', 'uk-text-warning', 'uk-text-danger');
                                    if (status === 'checking') {
                                        statusSpan.classList.add('uk-text-warning');
                                        statusSpan.textContent = `Check ${dexName.toUpperCase()}`;
                                    } else if (status === 'fallback') {
                                        statusSpan.classList.add('uk-text-warning');
                                        statusSpan.textContent = 'Check SWOOP';
                                        if (message) statusSpan.title = `Initial Error: ${message}`;
                                    } else if (status === 'error' || status === 'fallback_error') {
                                        setDexErrorBackground(cell);
                                        statusSpan.classList.add('uk-text-danger');
                                        statusSpan.textContent = '[ERROR]';
                                        if (message) statusSpan.title = message;
                                    }
                                };

                                const wdKeyCheck = idCELL + ':check';
                                const wdKeyFallback = idCELL + ':fallback';
                                const clearAllWatchdogs = () => { clearDexWatchdogs([wdKeyCheck, wdKeyFallback]); };

                                const handleSuccess = (dexResponse, isFallback = false) => {
                                    clearAllWatchdogs();
                                    // Avoid appending any "via SWOOP" suffix; keep only the base dex title
                                    const finalDexRes = isFallback ? { ...dexResponse, dexTitle: (dexResponse.dexTitle || dex) } : dexResponse;
                                    const update = calculateResult(
                                        baseId, tableBodyId, finalDexRes.amount_out, finalDexRes.FeeSwap,
                                        isKiri ? token.sc_in : token.sc_out, isKiri ? token.sc_out : token.sc_in,
                                        token.cex, isKiri ? modalKiri : modalKanan,
                                        isKiri ? amount_in_token : amount_in_pair,
                                        DataCEX.priceBuyToken, DataCEX.priceSellToken, DataCEX.priceBuyPair, DataCEX.priceSellPair,
                                        isKiri ? token.symbol_in : token.symbol_out, isKiri ? token.symbol_out : token.symbol_in,
                                        isKiri ? DataCEX.feeWDToken : DataCEX.feeWDPair,
                                        finalDexRes.dexTitle || dex, token.chain, CONFIG_CHAINS[token.chain.toLowerCase()].Kode_Chain,
                                        direction, 0, finalDexRes
                                    );
                                    // Console log summary for this successful check
                                    try {
                                        //menampilkan log simulasi harga
                                        const pairLine = `${String(isKiri ? token.symbol_in : token.symbol_out).toUpperCase()}->${String(isKiri ? token.symbol_out : token.symbol_in).toUpperCase()} on ${String(token.chain).toUpperCase()}`;
                                        const via = finalDexRes?.dexTitle || dex;
                                        const routeLine = `${String(token.cex).toUpperCase()}->${String(via).toUpperCase()} [OK]`;
                                        const modalVal = isKiri ? modalKiri : modalKanan;
                                        const modalLine = `modal ${Number(modalVal||0)}$`;
                                        // Compute DEX USD rate based on direction
                                        const amtIn = isKiri ? amount_in_token : amount_in_pair;
                                        const rate = (Number(finalDexRes.amount_out)||0) / (Number(amtIn)||1);
                                        let dexUsd = null;
                                        try {
                                            const stable = (typeof getStableSymbols === 'function') ? getStableSymbols() : ['USDT','USDC','DAI'];
                                            const baseSym = (typeof getBaseTokenSymbol === 'function') ? getBaseTokenSymbol(token.chain) : '';
                                            const baseUsd = (typeof getBaseTokenUSD === 'function') ? getBaseTokenUSD(token.chain) : 0;
                                            const inSym  = String(isKiri ? token.symbol_in  : token.symbol_out).toUpperCase();
                                            const outSym = String(isKiri ? token.symbol_out : token.symbol_in ).toUpperCase();
                                            if (isKiri) {
                                                // token -> pair: USD per 1 token
                                                if (stable.includes(outSym)) dexUsd = rate;
                                                else if (baseSym && outSym === baseSym && baseUsd > 0) dexUsd = rate * baseUsd;
                                                else dexUsd = rate * (Number(DataCEX.priceBuyPair)||0); // fallback via CEX
                                            } else {
                                                // pair -> token: USD per 1 token
                                                if (stable.includes(inSym) && rate > 0) dexUsd = 1 / rate;
                                                else if (baseSym && inSym === baseSym && baseUsd > 0 && rate > 0) dexUsd = baseUsd / rate;
                                                else dexUsd = Number(DataCEX.priceSellToken)||0; // fallback via CEX
                                            }
                                        } catch(_) { dexUsd = null; }

                                        // refactor: removed unused local debug variables (buy/sell/pnl lines)
                                        
                                    } catch(_) {}
                                    uiUpdateQueue.push(update);
                                };

                                const handleError = (initialError) => {
                                    clearAllWatchdogs();
                                    const dexConfig = CONFIG_DEXS[dex.toLowerCase()];
                                    if (dexConfig && dexConfig.allowFallback) {
                                        updateDexCellStatus('fallback', dex, initialError?.pesanDEX);
                                        setDexWatchdog(wdKeyFallback, () => {
                                            const msg = (initialError?.pesanDEX ? `Initial: ${initialError.pesanDEX} | ` : '') + 'SWOOP: Request Timeout';
                                            updateDexCellStatus('fallback_error', dex, msg);
                                        }, 5000);
                                        getPriceSWOOP(
                                            isKiri ? token.sc_in : token.sc_out, isKiri ? token.des_in : token.des_out,
                                            isKiri ? token.sc_out : token.sc_in, isKiri ? token.des_out : token.des_in,
                                            isKiri ? amount_in_token : amount_in_pair, DataCEX.priceBuyPair, dex,
                                            isKiri ? token.symbol_in : token.symbol_out, isKiri ? token.symbol_out : token.symbol_in,
                                            token.cex, token.chain, CONFIG_CHAINS[token.chain.toLowerCase()].Kode_Chain, direction
                                        )
                                        .then((fallbackRes) => {
                                            clearDexWatchdog(wdKeyFallback);
                                            handleSuccess(fallbackRes, true);
                                        })
                                        .catch((fallbackErr) => {
                                            if (window._DEX_WATCHDOGS.has(wdKeyFallback)) clearTimeout(window._DEX_WATCHDOGS.get(wdKeyFallback));
                                            const finalMessage = `Initial: ${initialError?.pesanDEX || 'N/A'} | Fallback: ${fallbackErr?.pesanDEX || 'Unknown'}`;
                                            updateDexCellStatus('fallback_error', dex, finalMessage);
                                            try {
                                                const pairLine = `${String(isKiri ? token.symbol_in : token.symbol_out).toUpperCase()}->${String(isKiri ? token.symbol_out : token.symbol_in).toUpperCase()} on ${String(token.chain).toUpperCase()}`;
                                                const routeLine = `${String(token.cex).toUpperCase()}->${String(dex).toUpperCase()} [ERROR]`;
                                                const modalVal = isKiri ? modalKiri : modalKanan;
                                                const modalLine = `modal ${Number(modalVal||0)}$`;
                                                // Align console info with requested orderbook logic
                                                const amtIn = isKiri ? amount_in_token : amount_in_pair;
                                                const rate = Number(amtIn) ? (Number(fallbackRes?.amount_out||0) / Number(amtIn)) : 0;
                                                let dexUsd = null;
                                                try {
                                                    const stable = (typeof getStableSymbols === 'function') ? getStableSymbols() : ['USDT','USDC','DAI'];
                                                    const baseSym = (typeof getBaseTokenSymbol === 'function') ? getBaseTokenSymbol(token.chain) : '';
                                                    const baseUsd = (typeof getBaseTokenUSD === 'function') ? getBaseTokenUSD(token.chain) : 0;
                                                    const inSym  = String(isKiri ? token.symbol_in  : token.symbol_out).toUpperCase();
                                                    const outSym = String(isKiri ? token.symbol_out : token.symbol_in ).toUpperCase();
                                                    if (isKiri) {
                                                        if (stable.includes(outSym)) dexUsd = rate; else if (baseSym && outSym === baseSym && baseUsd > 0) dexUsd = rate * baseUsd; else dexUsd = rate * (Number(DataCEX.priceBuyPair)||0);
                                                    } else {
                                                        if (stable.includes(inSym) && rate>0) dexUsd = 1 / rate; else if (baseSym && inSym === baseSym && baseUsd>0 && rate>0) dexUsd = baseUsd / rate; else dexUsd = Number(DataCEX.priceSellToken)||0;
                                                    }
                                                } catch(_) { dexUsd = null; }
                                                // refactor: removed unused local debug variables (buy/sell/pnl lines)
                                                
                                            } catch(_) {}
                                        });
                                    } else {
                                        updateDexCellStatus('error', dex, initialError?.pesanDEX || 'Unknown Error');
                                        try {
                                            const pairLine = `${String(isKiri ? token.symbol_in : token.symbol_out).toUpperCase()}->${String(isKiri ? token.symbol_out : token.symbol_in).toUpperCase()} on ${String(token.chain).toUpperCase()}`;
                                            const routeLine = `${String(token.cex).toUpperCase()}->${String(dex).toUpperCase()} [ERROR]`;
                                            const modalVal = isKiri ? modalKiri : modalKanan;
                                            const modalLine = `modal ${Number(modalVal||0)}$`;
                                            // Align console info with requested orderbook logic
                                            // refactor: removed unused local debug variables (buy/sell/pnl lines)
                                            
                                        } catch(_) {}
                                    }
                                };

                                updateDexCellStatus('checking', dex);
                                const dexTimeoutWindow = getJedaDex(dex) + Math.max(speedScan, 4500) + 300;
                                setDexWatchdog(wdKeyCheck, () => updateDexCellStatus('error', dex, `${dex.toUpperCase()}: Request Timeout`), dexTimeoutWindow);

                                setTimeout(() => {
                                    getPriceDEX(
                                        scInSafe, desInSafe,
                                        scOutSafe, desOutSafe,
                                        isKiri ? amount_in_token : amount_in_pair, DataCEX.priceBuyPair, dex,
                                        isKiri ? token.symbol_in : token.symbol_out, isKiri ? token.symbol_out : token.symbol_in,
                                        token.cex, token.chain, CONFIG_CHAINS[token.chain.toLowerCase()].Kode_Chain, direction, tableBodyId
                                    )
                                    .then((dexRes) => { clearAllWatchdogs(); handleSuccess(dexRes); })
                                    .catch((err) => { handleError(err); });
                                }, getJedaDex(dex));
                            };
                            callDex('TokentoPair');
                            callDex('PairtoToken');
                        });
                    }
            await delay(jedaKoin);
        } catch (error) {
            console.error(`Kesalahan saat memproses ${token.symbol_in}_${token.symbol_out}:`, error);
        }
    }

    async function processTokens(tokensToProcess, tableBodyId) {
        isScanRunning = true;
        animationFrameId = requestAnimationFrame(processUiUpdates);

        const startTime = Date.now();
        const tokenGroups = [];
        for (let i = 0; i < tokensToProcess.length; i += scanPerKoin) {
            tokenGroups.push(tokensToProcess.slice(i, i + scanPerKoin));
        }
        let processed = 0; // track tokens completed across groups

        // Inform user that app is checking GAS/GWEI per active chains
        try {
           
            $('#progress-bar').css('width', '5%');
            $('#progress-text').text('5%');
        } catch(_) {}
        await feeGasGwei();
        try {
            $('#progress').text('GAS / GWEI CHAINS READY');
            $('#progress-bar').css('width', '8%');
            $('#progress-text').text('8%');
        } catch(_) {}
        await getRateUSDT();

        for (let groupIndex = 0; groupIndex < tokenGroups.length; groupIndex++) {
            if (!isScanRunning) { break; }
            const groupTokens = tokenGroups[groupIndex];

            if ($('#autoScrollCheckbox').is(':checked') && groupTokens.length > 0) {
                const first = groupTokens[0];
                const suffix = `DETAIL_${first.cex.toUpperCase()}_${first.symbol_in.toUpperCase()}_${first.symbol_out.toUpperCase()}_${first.chain.toUpperCase()}`.replace(/[^A-Z0-9_]/g, '');
                const fullId = `${tableBodyId}_${suffix}`;
                requestAnimationFrame(() => { // REFACTORED
                    const $target = $('#' + fullId).length ? $('#' + fullId) : $(`[id$="${suffix}"]`).first();
                    if (!$target.length) return;
                    $target.addClass('auto-focus');
                    setTimeout(() => $target.removeClass('auto-focus'), 900);
                    const $container = $target.closest('.uk-overflow-auto');
                    if ($container.length && $container[0].scrollHeight > $container[0].clientHeight) {
                        const tRect = $target[0].getBoundingClientRect();
                        const cRect = $container[0].getBoundingClientRect();
                        const desiredTop = (tRect.top - cRect.top) + $container.scrollTop() - ($container[0].clientHeight / 2) + (tRect.height / 2);
                        $container.animate({ scrollTop: Math.max(desiredTop, 0) }, 200);
                    } else {
                        const tRect = $target[0].getBoundingClientRect();
                        const top = tRect.top + window.pageYOffset - (window.innerHeight / 2) + ($target[0].clientHeight / 2);
                        $('html, body').animate({ scrollTop: Math.max(top, 0) }, 200);
                    }
                });
            }

            // Run this group's tokens in parallel, staggered by jedaKoin per index
            const jobs = groupTokens.map((token, tokenIndex) => (async () => {
                if (!isScanRunning) return;
                // Stagger start per token within the group
                try { await delay(tokenIndex * Math.max(jedaKoin, 0)); } catch(_) {}
                if (!isScanRunning) return;
                try { await processRequest(token, tableBodyId); } catch(e) { console.error(`Err token ${token.symbol_in}_${token.symbol_out}`, e); }
                // Update progress as each token finishes
        // REFACTORED
        processed += 1;
        updateProgress(processed, tokensToProcess.length, startTime, `${token.symbol_in}_${token.symbol_out}`);
            })());

            await Promise.allSettled(jobs);
            if (!isScanRunning) break;
            if (groupIndex < tokenGroups.length - 1) { await delay(jedaTimeGroup); }
        }

        updateProgress(tokensToProcess.length, tokensToProcess.length, startTime, 'SELESAI');
        isScanRunning = false;
        cancelAnimationFrame(animationFrameId);
        form_on();
        $("#stopSCAN").hide().prop("disabled", true);
        $('#startSCAN').prop('disabled', false).text('Start').removeClass('uk-button-disabled');
        // Release gating via centralized helper
        if (typeof setScanUIGating === 'function') setScanUIGating(false); // REFACTORED
        setAppState({ run: 'NO' });

        // Schedule autorun if enabled
        try {
            if (window.AUTORUN_ENABLED === true) {
                const total = 10; // seconds
                let remain = total;
                const $cd = $('#autoRunCountdown');
                // Disable UI while waiting, similar to running state
                $('#startSCAN').prop('disabled', true).addClass('uk-button-disabled'); // REFACTORED
                $('#stopSCAN').show().prop('disabled', false);
                if (typeof setScanUIGating === 'function') setScanUIGating(true);
                const tick = () => {
                    if (!window.AUTORUN_ENABLED) { clearInterval(window.__autoRunInterval); window.__autoRunInterval=null; return; }
                    $cd.text(`AutoRun ${remain}s`).css({ color: '#e53935', fontWeight: 'bold' }); // REFACTORED
                    remain -= 1;
                    if (remain < 0) {
                        clearInterval(window.__autoRunInterval);
                        window.__autoRunInterval = null;
                        $cd.text('').css({ color: '', fontWeight: '' }); // REFACTORED
                        // Trigger new scan using current filters/selection
                        $('#startSCAN').trigger('click');
                    }
                };
                clearInterval(window.__autoRunInterval); // REFACTORED
                window.__autoRunInterval = setInterval(tick, 1000);
                tick();
            }
        } catch(_) {}
    }

    processTokens(flatTokens, tableBodyId);
}

// refactor: helper to reset dex cells back to default locked state
function resetDexCells(tableBodyId){
    try {
        const selector = `td[id^="${tableBodyId}_"]`;
        document.querySelectorAll(selector).forEach(cell => {
            const strong = cell.querySelector('strong');
            if (!strong) return;
            const dexHeaderHtml = strong.outerHTML;
            cell.innerHTML = `${dexHeaderHtml}<br><span class=\"dex-status uk-text-muted\">🔒</span>`;
            cell.style.backgroundColor = '';
        });
    } catch(_) {}
}

/**
 * Stops the currently running scanner.
 */
async function stopScanner() {
    isScanRunning = false; // REFACTORED
    try { cancelAnimationFrame(animationFrameId); } catch(_) {}
    clearInterval(window.__autoRunInterval); // REFACTORED
    window.__autoRunInterval = null;
    if (typeof form_on === 'function') form_on(); // REFACTORED
    try { sessionStorage.setItem('APP_FORCE_RUN_NO', '1'); } catch(_) {}
    try { setAppState({ run: 'NO' }); } catch(_) { /* ignore */ }
    try {
        if (typeof window.updateRunStateCache === 'function') { try { window.updateRunStateCache(getActiveFilterKey(), { run: 'NO' }); } catch(_) {} }
        if (typeof window.updateRunningChainsBanner === 'function') window.updateRunningChainsBanner();
        if (typeof window.updateToolbarRunIndicators === 'function') window.updateToolbarRunIndicators();
    } catch(_){}
    location.reload(); // REFACTORED
}

/**
 * Soft-stop scanner without reloading the page.
 * Useful before running long operations (e.g., Update Wallet CEX).
 */
function stopScannerSoft() {
    isScanRunning = false; // REFACTORED
    try { cancelAnimationFrame(animationFrameId); } catch(_) {}
    setAppState({ run: 'NO' }); // REFACTORED
    try {
        if (typeof window.updateRunStateCache === 'function') { try { window.updateRunStateCache(getActiveFilterKey(), { run: 'NO' }); } catch(_) {} }
        if (typeof window.updateRunningChainsBanner === 'function') window.updateRunningChainsBanner();
        if (typeof window.updateToolbarRunIndicators === 'function') window.updateToolbarRunIndicators();
    } catch(_){}
    clearInterval(window.__autoRunInterval); // REFACTORED
    window.__autoRunInterval = null;
    if (typeof form_on === 'function') form_on(); // REFACTORED
}

// Update info banner with all chains currently running. Optionally seed with a list.
function updateRunningChainsBanner(seedChains) {
    try {
        const setKeys = new Set();
        if (Array.isArray(seedChains)) seedChains.forEach(c => { if (c) setKeys.add(String(c).toLowerCase()); });
        const cache = (typeof window.RUN_STATES === 'object' && window.RUN_STATES) ? window.RUN_STATES : {};
        Object.keys(window.CONFIG_CHAINS || {}).forEach(k => { if (cache[String(k).toLowerCase()]) setKeys.add(String(k).toLowerCase()); });
        const labels = Array.from(setKeys).map(k => {
            const cfg = (window.CONFIG_CHAINS || {})[k] || {};
            return (cfg.Nama_Pendek || cfg.Nama_Chain || k).toString().toUpperCase();
        });
        if (labels.length > 0) {
            $('#infoAPP').html(`RUN SCANNING: ${labels.join(', ')}`).show();
        } else {
            // Fallback to default running label if any; otherwise let history updater handle it
            const st = (typeof getAppState === 'function') ? getAppState() : { run: 'NO' };
            if (String(st.run || 'NO').toUpperCase() === 'YES') {
                $('#infoAPP').html('RUN SCANNING...').show();
            }
        }
    } catch(_) {}
}

try { window.updateRunningChainsBanner = window.updateRunningChainsBanner || updateRunningChainsBanner; } catch(_){}
