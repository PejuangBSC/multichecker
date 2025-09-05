// =================================================================================
// SCANNER LOGIC
// =================================================================================

let animationFrameId;
let isScanRunning = false;

/**
 * Start the scanning process for a flattened list of tokens.
 * - Batches tokens per group (scanPerKoin)
 * - For each token: fetch CEX orderbook → quote DEX routes → compute PNL → update UI
 */
async function startScanner(tokensToScan, settings, tableBodyId) {
    // Cancel any pending autorun countdown when a new scan starts
    try { clearInterval(window.__autoRunInterval); } catch(_) {}
    window.__autoRunInterval = null;
    try { $('#autoRunCountdown').text(''); } catch(_) {}
    const lastAction = getFromLocalStorage('HISTORY', {});
    if (lastAction && lastAction.action && lastAction.time) {
        $('#infoAPP').text(`${lastAction.action} at ${lastAction.time}`);
    } else {
        $('#infoAPP').empty();
    }

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
        toastr.warning('Tidak ada Chain yang dipilih. Silakan pilih minimal 1 Chain.');
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
        toastr.info('Tidak ada token pada chain terpilih untuk dipindai.');
        return;
    }

    setAppState({ run: 'YES' });
    $('#startSCAN').prop('disabled', true).text('Running...').addClass('uk-button-disabled');
    // Keep user's search query intact; do not reset searchInput here.
    // Clear previous signals (container uses <div id="sinyal...">)
    $('#sinyal-container [id^="sinyal"]').empty();
    // Reset all DEX cells default status to lock (without rewriting full cell)
    try {
        const selector = `td[id^="${tableBodyId}_"]`;
        document.querySelectorAll(selector).forEach(cell => {
            const strong = cell.querySelector('strong');
            if (!strong) return;
            let statusSpan = cell.querySelector('.dex-status');
            if (!statusSpan) {
                const br = document.createElement('br');
                strong.insertAdjacentElement('afterend', br);
                statusSpan = document.createElement('span');
                statusSpan.className = 'dex-status uk-text-muted';
               
                br.insertAdjacentElement('afterend', statusSpan);
            }
            statusSpan.classList.remove('uk-text-danger', 'uk-text-warning');
            statusSpan.classList.add('uk-text-muted');
            statusSpan.textContent = '🔒';
            statusSpan.removeAttribute('title');
            cell.style.backgroundColor = '';
        });
    } catch (_) {}
    // Apply gating first, then disable globally to ensure edit remains locked during scan
    try { if (typeof setScanUIGating === 'function') setScanUIGating(true); } catch(_) {}
    form_off();
    $("#autoScrollCheckbox").show().prop('disabled', false);
    $("#stopSCAN").show().prop('disabled', false);
    $('#LoadDataBtn, #SettingModal, #MasterData,#UpdateWalletCEX, #chain-links-container,.sort-toggle').css({ 'pointer-events': 'none', 'opacity': '0.4' });
    // Lock edit buttons and management link during scanning
    try { $('.edit-token-button, #ManajemenKoin').css({ 'pointer-events': 'none', 'opacity': '0.4' }); } catch(_) {}
    // Disable all toolbar actions during scanning, except Reload and Dark Mode toggle
    try {
        const $allToolbar = $('.header-card a, .header-card .icon');
        $allToolbar.css({ pointerEvents: 'none', opacity: 0.4 });
        $('#reload, #darkModeToggle').css({ pointerEvents: 'auto', opacity: 1 });
    } catch(_) {}
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
                    cell.style.backgroundColor = color || '#f39999';
                    let statusSpan = cell.querySelector('.dex-status');
                    if (!statusSpan) {
                        const strong = cell.querySelector('strong');
                        if (strong) {
                            const br = document.createElement('br');
                            strong.insertAdjacentElement('afterend', br);
                            statusSpan = document.createElement('span');
                            statusSpan.className = 'dex-status uk-text-danger';
                           
                            br.insertAdjacentElement('afterend', statusSpan);
                        } else {
                            statusSpan = document.createElement('span');
                            statusSpan.className = 'dex-status uk-text-danger';
                           
                            cell.appendChild(statusSpan);
                        }
                    }
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
                toastr.error(`CEK MANUAL ${token.symbol_in} di ${token.cex}`);
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
                                    let statusSpan = cell.querySelector('.dex-status');
                                    if (!statusSpan) {
                                        const strong = cell.querySelector('strong');
                                        if (strong) {
                                            const br = document.createElement('br');
                                            strong.insertAdjacentElement('afterend', br);
                                            statusSpan = document.createElement('span');
                                            statusSpan.className = 'dex-status';
                           
                                            br.insertAdjacentElement('afterend', statusSpan);
                                        } else {
                                            statusSpan = document.createElement('span');
                                            statusSpan.className = 'dex-status';
                           
                                            cell.appendChild(statusSpan);
                                        }
                                    }
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
                                        cell.style.backgroundColor = '#ffcccc';
                                        statusSpan.classList.add('uk-text-danger');
                                        statusSpan.textContent = '[ERROR]';
                                        if (message) statusSpan.title = message;
                                    }
                                };

                                window._DEX_WATCHDOGS = window._DEX_WATCHDOGS || new Map();
                                const wdKeyCheck = idCELL + ':check';
                                const wdKeyFallback = idCELL + ':fallback';
                                const setWatchdog = (key, fn, delay) => {
                                    if (window._DEX_WATCHDOGS.has(key)) clearTimeout(window._DEX_WATCHDOGS.get(key));
                                    window._DEX_WATCHDOGS.set(key, setTimeout(fn, delay));
                                };
                                const clearAllWatchdogs = () => {
                                    if (window._DEX_WATCHDOGS.has(wdKeyCheck)) clearTimeout(window._DEX_WATCHDOGS.get(wdKeyCheck));
                                    if (window._DEX_WATCHDOGS.has(wdKeyFallback)) clearTimeout(window._DEX_WATCHDOGS.get(wdKeyFallback));
                                };

                                const handleSuccess = (dexResponse, isFallback = false) => {
                                    clearAllWatchdogs();
                                    const finalDexRes = isFallback ? { ...dexResponse, dexTitle: `${dexResponse.dexTitle || dex} via SWOOP` } : dexResponse;
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

                                        // Directional buy/sell mapping (all in USD rate)
                                        const buyPrice  = isKiri ? (Number(DataCEX.priceBuyToken)||0) : (Number(dexUsd)||0); // TokentoPair: buy CEX, PairtoToken: buy DEX
                                        const sellPrice = isKiri ? (Number(dexUsd)||0)             : (Number(DataCEX.priceSellToken)||0); // TokentoPair: sell DEX, PairtoToken: sell CEX
                                        const buyLine = `buy : ${Number(buyPrice||0)}$`;
                                        const sellLine = `sell : ${Number(sellPrice||0)}$`;
                                        const pnlLine = `PNL : ${Number(update.profitLoss||0).toFixed(2)}$`;
                                        
                                    } catch(_) {}
                                    uiUpdateQueue.push(update);
                                };

                                const handleError = (initialError) => {
                                    clearAllWatchdogs();
                                    const dexConfig = CONFIG_DEXS[dex.toLowerCase()];
                                    if (dexConfig && dexConfig.allowFallback) {
                                        updateDexCellStatus('fallback', dex, initialError?.pesanDEX);
                                        setWatchdog(wdKeyFallback, () => {
                                            const msg = (initialError?.pesanDEX ? `Initial: ${initialError.pesanDEX} | ` : '') + 'SWOOP: Request Timeout';
                                            updateDexCellStatus('fallback_error', dex, msg);
                                        }, speedScan + 200);
                                        getPriceSWOOP(
                                            isKiri ? token.sc_in : token.sc_out, isKiri ? token.des_in : token.des_out,
                                            isKiri ? token.sc_out : token.sc_in, isKiri ? token.des_out : token.des_in,
                                            isKiri ? amount_in_token : amount_in_pair, DataCEX.priceBuyPair, dex,
                                            isKiri ? token.symbol_in : token.symbol_out, isKiri ? token.symbol_out : token.symbol_in,
                                            token.cex, token.chain, CONFIG_CHAINS[token.chain.toLowerCase()].Kode_Chain, direction
                                        )
                                        .then((fallbackRes) => {
                                            if (window._DEX_WATCHDOGS.has(wdKeyFallback)) clearTimeout(window._DEX_WATCHDOGS.get(wdKeyFallback));
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
                                                const buyPrice = isKiri ? (Number(DataCEX.priceBuyToken)||0) : (Number(dexUsd)||0);
                                                const sellPrice = isKiri ? (Number(dexUsd)||0)             : (Number(DataCEX.priceSellToken)||0);
                                                const buyLine = `buy : ${Number(buyPrice||0)}$`;
                                                const sellLine = `sell : ${Number(sellPrice||0)}$`;
                                                const pnlLine = `PNL : N/A (DEX error)`;
                                                
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
                                            const buyPrice = isKiri ? DataCEX.priceBuyToken : DataCEX.priceSellToken;
                                            const sellPrice = isKiri ? DataCEX.priceBuyPair : DataCEX.priceSellToken;
                                            const buyLine = `buy : ${Number(buyPrice||0)}$`;
                                            const sellLine = `sell : ${Number(sellPrice||0)}$`;
                                            const pnlLine = `PNL : N/A (DEX error)`;
                                            
                                        } catch(_) {}
                                    }
                                };

                                updateDexCellStatus('checking', dex);
                                const dexTimeoutWindow = getJedaDex(dex) + Math.max(speedScan, 4500) + 300;
                                setWatchdog(wdKeyCheck, () => updateDexCellStatus('error', dex, `${dex.toUpperCase()}: Request Timeout`), dexTimeoutWindow);

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
                requestAnimationFrame(() => {
                    let target = document.getElementById(fullId) || document.querySelector(`[id$="${suffix}"]`);
                    if (!target) return;
                    target.classList.add('auto-focus');
                    setTimeout(() => target.classList.remove('auto-focus'), 900);
                    const container = target.closest('.uk-overflow-auto');
                    if (container && container.scrollHeight > container.clientHeight) {
                        const tRect = target.getBoundingClientRect();
                        const cRect = container.getBoundingClientRect();
                        const desiredTop = (tRect.top - cRect.top) + container.scrollTop - (container.clientHeight / 2) + (tRect.height / 2);
                        container.scrollTo({ top: Math.max(desiredTop, 0), behavior: 'smooth' });
                    } else {
                        const top = target.getBoundingClientRect().top + window.pageYOffset - (window.innerHeight / 2) + (target.clientHeight / 2);
                        window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
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
                try {
                    processed += 1;
                    updateProgress(processed, tokensToProcess.length, startTime, `${token.symbol_in}_${token.symbol_out}`);
                } catch(_) {}
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
        $("#LoadDataBtn, #SettingModal, #MasterData,#UpdateWalletCEX,#chain-links-container,.sort-toggle, .edit-token-button").css("pointer-events", "auto").css("opacity", "1");
        try { if (typeof setScanUIGating === 'function') setScanUIGating(false); } catch(_) {}
        try { $('.header-card a, .header-card .icon').css({ pointerEvents: 'auto', opacity: 1 }); } catch(_) {}
        setAppState({ run: 'NO' });

        // Schedule autorun if enabled
        try {
            if (window.AUTORUN_ENABLED === true) {
                const total = 10; // seconds
                let remain = total;
                const $cd = $('#autoRunCountdown');
                // Disable UI while waiting, similar to running state
                try {
                    $('#startSCAN').prop('disabled', true).addClass('uk-button-disabled');
                    $('#stopSCAN').show().prop('disabled', false);
                    $('#LoadDataBtn, #SettingModal, #MasterData,#UpdateWalletCEX,#chain-links-container,.sort-toggle, .edit-token-button').css({ pointerEvents: 'none', opacity: 0.4 });
                    if (typeof setScanUIGating === 'function') setScanUIGating(true);
                    const $allToolbar = $('.header-card a, .header-card .icon');
                    $allToolbar.css({ pointerEvents: 'none', opacity: 0.4 });
                    $('#reload, #darkModeToggle').css({ pointerEvents: 'auto', opacity: 1 });
                } catch(_) {}
                const tick = () => {
                    if (!window.AUTORUN_ENABLED) { clearInterval(window.__autoRunInterval); window.__autoRunInterval=null; return; }
                    try { $cd.text(`AutoRun ${remain}s`).css({ color: '#e53935', fontWeight: 'bold' }); } catch(_) {}
                    remain -= 1;
                    if (remain < 0) {
                        clearInterval(window.__autoRunInterval);
                        window.__autoRunInterval = null;
                        try { $cd.text('').css({ color: '', fontWeight: '' }); } catch(_) {}
                        // Trigger new scan using current filters/selection
                        $('#startSCAN').trigger('click');
                    }
                };
                try { clearInterval(window.__autoRunInterval); } catch(_) {}
                window.__autoRunInterval = setInterval(tick, 1000);
                tick();
            }
        } catch(_) {}
    }

    processTokens(flatTokens, tableBodyId);
}

/**
 * Stops the currently running scanner.
 */
async function stopScanner() {
    try { isScanRunning = false; } catch(_) {}
    try { cancelAnimationFrame(animationFrameId); } catch(_) {}
    try { clearInterval(window.__autoRunInterval); } catch(_) {}
    window.__autoRunInterval = null;
    try { form_on(); } catch(_) {}
    try { sessionStorage.setItem('APP_FORCE_RUN_NO', '1'); } catch(_) {}
    try {
        if (typeof saveToLocalStorageAsync === 'function') {
            await saveToLocalStorageAsync('APP_STATE', Object.assign({}, getAppState(), { run: 'NO' }));
        } else {
            setAppState({ run: 'NO' });
        }
    } catch(_) { setAppState({ run: 'NO' }); }
    try { location.reload(); } catch(_) {}
}

/**
 * Soft-stop scanner without reloading the page.
 * Useful before running long operations (e.g., Update Wallet CEX).
 */
function stopScannerSoft() {
    try { isScanRunning = false; } catch(_) {}
    try { cancelAnimationFrame(animationFrameId); } catch(_) {}
    try { setAppState({ run: 'NO' }); } catch(_) {}
    try { clearInterval(window.__autoRunInterval); } catch(_) {}
    window.__autoRunInterval = null;
    try { form_on(); } catch(_) {}
}
