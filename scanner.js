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
function setDexErrorBackground(cell) {
    if (!cell) return;
    try { cell.classList.add('dex-error'); } catch(_) {}
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
    // Prevent false timeouts when tab is inactive by postponing error triggers until visible
    const schedule = (ms) => setTimeout(() => {
        try {
            if (typeof document !== 'undefined' && document.hidden) {
                // re-arm with modest delay until visible
                const t = schedule(Math.min(1000, Math.max(250, ms)));
                map.set(key, t);
                return;
            }
        } catch(_) {}
        try { fn(); } finally { map.delete(key); }
    }, Math.max(0, ms||0));
    const timerId = schedule(delay);
    map.set(key, timerId);
}
function clearDexWatchdog(key){
    const map = getDexWatchdogMap();
    if (map.has(key)) { clearTimeout(map.get(key)); map.delete(key); }
}
function clearDexWatchdogs(keys){
    (Array.isArray(keys) ? keys : [keys]).forEach(k => clearDexWatchdog(k));
}

// Ticker countdown per-sel DEX (untuk menampilkan sisa waktu "Check")
function clearDexTickerById(id){
    try {
        window._DEX_TICKERS = window._DEX_TICKERS || new Map();
        const key = String(id) + ':ticker';
        if (window._DEX_TICKERS.has(key)) {
            clearInterval(window._DEX_TICKERS.get(key));
            window._DEX_TICKERS.delete(key);
        }
    } catch(_) {}
}

let animationFrameId;
let isScanRunning = false;

// Toggle page title to indicate active scan for the current page/tab (single-chain only)
function setPageTitleForRun(running){
    try {
        const m = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };
        if (String(m.type||'').toLowerCase() !== 'single') return; // only affect per-chain pages
        if (running) {
            if (!window.__ORIG_TITLE) window.__ORIG_TITLE = document.title;
            document.title = 'SCANNING..';
        } else {
            if (window.__ORIG_TITLE) { document.title = window.__ORIG_TITLE; }
            window.__ORIG_TITLE = null;
        }
    } catch(_) {}
}

// Title helpers for DEX cells: maintain a joined title log per cell
function setCellTitleByEl(cell, text){
    try {
        cell.dataset.titleLog = String(text || '');
        cell.setAttribute('title', cell.dataset.titleLog);
        const span = cell.querySelector('.dex-status');
        if (span) span.setAttribute('title', cell.dataset.titleLog);
    } catch(_) {}
}
function appendCellTitleByEl(cell, line){
    try {
        const prev = cell.dataset && cell.dataset.titleLog ? String(cell.dataset.titleLog) : '';
        const next = prev ? (prev + '\n' + String(line||'')) : String(line||'');
        setCellTitleByEl(cell, next);
    } catch(_) {}
}
function appendCellTitleById(id, line){
    const cell = document.getElementById(id);
    if (!cell) return;
    appendCellTitleByEl(cell, line);
}
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
    // Do not use infoAPP for history while scanning; the banner is reserved for RUN status

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

    // Resolve active DEX selection and lock it for the duration of this scan
    let allowedDexs = [];
    try { allowedDexs = (typeof window.resolveActiveDexList === 'function') ? window.resolveActiveDexList() : []; } catch(_) { allowedDexs = []; }
    try { if (typeof window !== 'undefined') window.__LOCKED_DEX_LIST = (allowedDexs || []).slice(); } catch(_) {}

    // Use the passed parameter directly, and filter by the currently allowed chains and DEX selection (token must have at least one selected DEX)
    const flatTokens = tokensToScan
        .filter(t => allowedChains.includes(String(t.chain).toLowerCase()))
        .filter(t => {
            try { return (Array.isArray(t.dexs) && t.dexs.some(d => allowedDexs.includes(String(d.dex||'').toLowerCase()))); } catch(_) { return true; }
        });

    if (!flatTokens || flatTokens.length === 0) {
        if (typeof toast !== 'undefined' && toast.info) toast.info('Tidak ada token pada chain terpilih untuk dipindai.');
        return;
    }

    // Ensure UI skeleton (header + rows + all DEX cells) is present before any calculation/updates
    try {
        const bodyId = tableBodyId || 'dataTableBody';
        if (typeof window.prepareMonitoringSkeleton === 'function') {
            window.prepareMonitoringSkeleton(flatTokens, bodyId);
        } else if (typeof window.renderMonitoringHeader === 'function' && typeof window.computeActiveDexList === 'function') {
            window.renderMonitoringHeader(window.computeActiveDexList());
        }
    } catch(_) {}

    setAppState({ run: 'YES' });
    // Update page title to indicate active scanning (single-chain view only)
    setPageTitleForRun(true);
    try {
        if (typeof window.updateRunStateCache === 'function') {
            try { window.updateRunStateCache(getActiveFilterKey(), { run: 'YES' }); } catch(_) {}
            // Mark each allowed chain as running to isolate per-chain state
            try { (allowedChains || []).forEach(c => window.updateRunStateCache(`FILTER_${String(c).toUpperCase()}`, { run: 'YES' })); } catch(_) {}
        }
        if (typeof window.updateRunningChainsBanner === 'function') {
            const m = getAppMode();
            const preListed = (m.type === 'single') ? [String(m.chain).toLowerCase()] : (allowedChains || []);
            window.updateRunningChainsBanner(preListed);
        }
        if (typeof window.updateToolbarRunIndicators === 'function') window.updateToolbarRunIndicators();
    } catch(_){}
    $('#startSCAN').prop('disabled', true).text('Running...').addClass('uk-button-disabled');
    // Standardized banner will be updated by updateRunningChainsBanner
    // Keep user's search query intact; do not reset searchInput here.
    // Clear previous signals (container uses <div id="sinyal...">)
    $('#sinyal-container [id^="sinyal"]').empty();
    // Hide empty signal cards so none appear at start // REFACTORED
    if (typeof window.hideEmptySignalCards === 'function') window.hideEmptySignalCards();
    // Apply gating first, then disable globally to ensure edit remains locked during scan
    if (typeof setScanUIGating === 'function') setScanUIGating(true); // REFACTORED
    form_off();
    $("#autoScrollCheckbox").show().prop('disabled', false);
    $("#stopSCAN").show().prop('disabled', false);
    // Gating already applied above
    $('.statusCheckbox').css({ 'pointer-events': 'auto', 'opacity': '1' }).prop('disabled', false);

    sendStatusTELE(ConfigScan.nickname, 'ONLINE');

    let scanPerKoin = parseInt(ConfigScan.scanPerKoin || 1);
    let jedaKoin = parseInt(ConfigScan.jedaKoin || 500);
    let jedaTimeGroup = parseInt(ConfigScan.jedaTimeGroup || 1000);
    // Jeda tambahan agar urutan fetch mengikuti pola lama (tanpa mengubah logika hasil)
    // Catatan: gunakan nilai dari SETTING_SCANNER
    // - Jeda CEX: per-CEX dari ConfigScan.JedaCexs[cex]
    // - Jeda DEX: per-DEX dari ConfigScan.JedaDexs[dex]
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
    // Ensure UI updates flush promptly when tab becomes visible again
    try {
        if (typeof window !== 'undefined' && !window.__UI_VIS_LISTENER_SET__) {
            document.addEventListener('visibilitychange', () => {
                try { if (!document.hidden) processUiUpdates(); } catch(_) {}
            });
            window.__UI_VIS_LISTENER_SET__ = true;
        }
    } catch(_) {}

    // Suspend auto-scroll when the user interacts (wheel/touch/mouse/keys)
    try {
        if (typeof window !== 'undefined' && !window.__AUTO_SCROLL_SUSPENDER_SET__) {
            const suspend = () => { try { window.__AUTO_SCROLL_SUSPEND_UNTIL = Date.now() + 4000; } catch(_) {} };
            ['wheel','touchstart','mousedown','keydown'].forEach(ev => {
                try { window.addEventListener(ev, suspend, { passive: true }); } catch(_) {}
            });
            window.__AUTO_SCROLL_SUSPENDER_SET__ = true;
        }
    } catch(_) {}

    function processUiUpdates() {
        if (!isScanRunning && uiUpdateQueue.length === 0) return;

        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const budgetMs = 8; // aim to keep under one frame @120Hz
        let processed = 0;

        // Safety sweep: finalize any DEX cell that exceeded its deadline but never flipped from "Check"
        try {
            const nowTs = Date.now();
            const cells = document.querySelectorAll('td[data-deadline]');
            cells.forEach(cell => {
                try {
                    const d = Number(cell.dataset.deadline || 0);
                    const done = String(cell.dataset.final || '') === '1';
                    if (!done && d > 0 && nowTs - d > 250) {
                        const dexName = (cell.dataset.dex || '').toUpperCase() || 'DEX';
                        // stop any lingering ticker for this cell
                        try { clearDexTickerById(cell.id); } catch(_) {}
                        // Force finalize to TIMEOUT directly (no closure dependency)
                        try { cell.classList.add('dex-error'); } catch(_) {}
                        const span = ensureDexStatusSpan(cell);
                        try {
                            span.classList.remove('uk-text-muted', 'uk-text-warning');
                            span.classList.add('uk-text-danger');
                            span.innerHTML = `<span class=\"uk-label uk-label-warning\">TIMEOUT</span>`;
                            span.title = `${dexName}: Request Timeout`;
                        } catch(_) {}
                        try { cell.dataset.final = '1'; delete cell.dataset.checking; delete cell.dataset.deadline; } catch(_) {}
                    }
                } catch(_) {}
            });
        } catch(_) {}

        while (uiUpdateQueue.length) {
            const updateData = uiUpdateQueue.shift();
            if (updateData && updateData.type === 'error') {
                const { id, message, swapMessage } = updateData;
                const cell = document.getElementById(id);
                if (cell) {
                    // finalize error: stop ticker, mark final, clear checking/deadline
                    try { clearDexTickerById(id); } catch(_) {}
                    try { cell.dataset.final = '1'; delete cell.dataset.checking; delete cell.dataset.deadline; } catch(_) {}
                    setDexErrorBackground(cell);
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

        // If page is hidden, do not rely on RAF (throttled/paused). Use setTimeout loop to keep UI in sync.
        if (typeof document !== 'undefined' && document.hidden) {
            setTimeout(processUiUpdates, 150);
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
                // Inform all DEX cells for this token that CEX prices are invalid
                try {
                    if (Array.isArray(token.dexs)) {
                        token.dexs.forEach((dd) => {
                            try { if (!allowedDexs.includes(String(dd.dex||'').toLowerCase())) return; } catch(_) {}
                            const dex = String(dd.dex||'').toLowerCase();
                            ['TokentoPair','PairtoToken'].forEach(dir => {
                                const isKiri = dir === 'TokentoPair';
                                const baseIdRaw = `${String(token.cex).toUpperCase()}_${String(dex).toUpperCase()}_`
                                  + `${String(isKiri ? token.symbol_in : token.symbol_out).toUpperCase()}_`
                                  + `${String(isKiri ? token.symbol_out : token.symbol_in).toUpperCase()}_`
                                  + `${String(token.chain).toUpperCase()}_`
                                  + `${String(token.id||'').toUpperCase()}`;
                                const idCELL = tableBodyId + '_' + baseIdRaw.replace(/[^A-Z0-9_]/g,'');
                                const cell = document.getElementById(idCELL);
                                if (!cell) return;
                                setDexErrorBackground(cell);
                                const span = ensureDexStatusSpan(cell);
                                span.className = 'dex-status uk-text-danger';
                                span.innerHTML = `<span class=\"uk-label uk-label-danger\">ERROR</span>`;
                                appendCellTitleByEl(cell, '[CEX] INVALID PRICES');
                                try { if (cell.dataset) cell.dataset.final = '1'; } catch(_) {}
                            });
                        });
                    }
                } catch(_) {}
                return;
            }

            // Beri jeda setelah CEX siap sebelum DEX dieksekusi berdasarkan setting per-CEX
            try {
                const cexDelayMap = (ConfigScan || {}).JedaCexs || {};
                const afterCEX = parseInt(cexDelayMap[token.cex]) || 0;
                if (afterCEX > 0) await new Promise(r => setTimeout(r, afterCEX));
            } catch(_) {}

            if (token.dexs && Array.isArray(token.dexs)) {
                token.dexs.forEach((dexData) => {
                            // Skip DEX not included in active selection
                            try { if (!allowedDexs.includes(String(dexData.dex||'').toLowerCase())) return; } catch(_) {}
                            const dex = dexData.dex.toLowerCase();
                            const modalKiri = dexData.left;
                            const modalKanan = dexData.right;
                            const amount_in_token = parseFloat(modalKiri) / DataCEX.priceBuyToken;
                            const amount_in_pair = parseFloat(modalKanan) / DataCEX.priceBuyPair;

                            const callDex = (direction) => {
                                const isKiri = direction === 'TokentoPair';
                                if (isKiri && !isPosChecked('Actionkiri')) { return; }
                                if (!isKiri && !isPosChecked('ActionKanan')) { return; }

                                const baseIdRaw = `${String(token.cex).toUpperCase()}_${String(dex).toUpperCase()}_`
                                  + `${String(isKiri ? token.symbol_in : token.symbol_out).toUpperCase()}_`
                                  + `${String(isKiri ? token.symbol_out : token.symbol_in).toUpperCase()}_`
                                  + `${String(token.chain).toUpperCase()}_`
                                  + `${String(token.id||'').toUpperCase()}`;
                                const baseId = baseIdRaw.replace(/[^A-Z0-9_]/g,'');
                                const idCELL = tableBodyId + '_' + baseId;
                                let lastPrimaryError = null;

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
                                    // Do not overwrite if cell already finalized by a prior UPDATE/ERROR
                                    try { if (cell.dataset && cell.dataset.final === '1') return; } catch(_) {}
                                    // Presentation only: spinner for checking, badge for error
                                    try { cell.classList.remove('dex-error'); } catch(_) {}
                                    let statusSpan = ensureDexStatusSpan(cell);
                                    statusSpan.removeAttribute('title');
                                    statusSpan.classList.remove('uk-text-muted', 'uk-text-warning', 'uk-text-danger');
                                    if (status === 'checking') {
                                        statusSpan.classList.add('uk-text-warning');
                                        statusSpan.innerHTML = `<span class=\"uk-margin-small-right\" uk-spinner=\"ratio: 0.5\"></span>${String(dexName||'').toUpperCase()}`;
                                        try { if (window.UIkit && UIkit.update) UIkit.update(cell); } catch(_) {}
                                        // Build rich header log like example
                                        try {
                                            const chainCfg = (window.CONFIG_CHAINS||{})[String(token.chain).toLowerCase()] || {};
                                            const chainName = (chainCfg.Nama_Chain || token.chain || '').toString().toUpperCase();
                                            const nameIn  = String(isKiri ? token.symbol_in  : token.symbol_out).toUpperCase();
                                            const nameOut = String(isKiri ? token.symbol_out : token.symbol_in ).toUpperCase();
                                            const ce  = String(token.cex||'').toUpperCase();
                                            const dx  = String(dexName||dex||'').toUpperCase();
                                            const proc = isKiri ? `${ce} → ${dx}` : `${dx} → ${ce}`;
                                            const modal = Number(isKiri ? modalKiri : modalKanan) || 0;
                                            const header = [
                                                `✅ [LOG ${isKiri? 'CEX → DEX':'DEX → CEX'}] ${nameIn} → ${nameOut} on ${chainName}`,
                                                `    🔄 [${proc}]`,
                                                '',
                                                `    🪙 Modal: $${modal.toFixed(2)}`,
                                               // message ? `    💹 CEX SUMMARY: ${message}` : ''
                                            ].filter(Boolean).join('\n');
                                            setCellTitleByEl(cell, header);
                                        } catch(_) {}
                                    } else if (status === 'fallback') {
                                        statusSpan.classList.add('uk-text-warning');
                                        statusSpan.innerHTML = `<span class=\"uk-margin-small-right\" uk-spinner=\"ratio: 0.5\"></span>SWOOP`;
                                        // Tooltip: show only raw DEX response if present
                                        if (message) {
                                            statusSpan.title = String(message);
                                            setCellTitleByEl(cell, String(message));
                                        }
                                        try { if (window.UIkit && UIkit.update) UIkit.update(cell); } catch(_) {}
                                    } else if (status === 'fallback_error') {
                                        setDexErrorBackground(cell);
                                        statusSpan.classList.remove('uk-text-warning');
                                        statusSpan.classList.add('uk-text-danger');
                                        statusSpan.innerHTML = `<span class=\"uk-label uk-label-warning\">TIMEOUT</span>`;
                                        // Tooltip: raw DEX error/timeout only
                                        if (message) {
                                            statusSpan.title = String(message);
                                            setCellTitleByEl(cell, String(message));
                                            try { const lab = statusSpan.querySelector('.uk-label'); if (lab) lab.setAttribute('title', String(message)); } catch(_) {}
                                        } else {
                                            statusSpan.removeAttribute('title');
                                        }
                                        // Finalize regardless of tab visibility
                                        try { clearDexTickerById(idCELL); } catch(_) {}
                                        try { if (cell.dataset) { cell.dataset.final = '1'; delete cell.dataset.checking; delete cell.dataset.deadline; } } catch(_) {}
                                    } else if (status === 'failed') {
                                        // Validation failed before DEX call (e.g., modal/contract/chain code)
                                        setDexErrorBackground(cell);
                                        statusSpan.classList.remove('uk-text-warning');
                                        statusSpan.classList.add('uk-text-danger');
                                        statusSpan.innerHTML = `<span class=\"uk-label uk-label-failed\">FAILED</span>`;
                                        if (message) {
                                            statusSpan.title = String(message);
                                            setCellTitleByEl(cell, String(message));
                                            try { const lab = statusSpan.querySelector('.uk-label'); if (lab) lab.setAttribute('title', String(message)); } catch(_) {}
                                        } else {
                                            statusSpan.removeAttribute('title');
                                        }
                                        // Finalize regardless of tab visibility
                                        try { clearDexTickerById(idCELL); } catch(_) {}
                                        try { if (cell.dataset) { cell.dataset.final = '1'; delete cell.dataset.checking; delete cell.dataset.deadline; } } catch(_) {}
                                    } else if (status === 'error') {
                                        setDexErrorBackground(cell);
                                        statusSpan.classList.remove('uk-text-warning');
                                        statusSpan.classList.add('uk-text-danger');
                                        statusSpan.innerHTML = `<span class=\"uk-label uk-label-danger\">ERROR</span>`;
                                        if (message) {
                                            statusSpan.title = String(message);
                                            setCellTitleByEl(cell, String(message));
                                            // Ensure the visible ERROR/TIMEOUT badge also shows the tooltip itself
                                            try { const lab = statusSpan.querySelector('.uk-label'); if (lab) lab.setAttribute('title', String(message)); } catch(_) {}
                                        } else {
                                            statusSpan.removeAttribute('title');
                                        }
                                        // Finalize regardless of tab visibility
                                        try { clearDexTickerById(idCELL); } catch(_) {}
                                        try { if (cell.dataset) { cell.dataset.final = '1'; delete cell.dataset.checking; delete cell.dataset.deadline; } } catch(_) {}
                                    }
                                };

                                // Lightweight readiness checks to avoid unnecessary DEX requests
                                const validateDexReadiness = () => {
                                    const modal = isKiri ? modalKiri : modalKanan;
                                    const amtIn = isKiri ? amount_in_token : amount_in_pair;
                                    const chainCfg = CONFIG_CHAINS[String(token.chain).toLowerCase()] || {};
                                    // Modal must be > 0
                                    if (!(Number(modal) > 0)) return { ok:false, reason:'Modal tidak valid (<= 0)' };
                                    // Amount-in must be > 0
                                    if (!(Number(amtIn) > 0)) return { ok:false, reason:'Amount input tidak valid (<= 0)' };
                                    // Chain code must exist (used by DEX link and queries)
                                    if (!chainCfg || !chainCfg.Kode_Chain) return { ok:false, reason:'Kode chain tidak tersedia' };
                                    // Basic SC presence (after NON fallback sanitation)
                                    if (!scInSafe || !scOutSafe || String(scInSafe).length < 6 || String(scOutSafe).length < 6) return { ok:false, reason:'Alamat kontrak tidak lengkap' };
                                    return { ok:true };
                                };

                                const ready = validateDexReadiness();
                                if (!ready.ok) { updateDexCellStatus('failed', dex, ready.reason); return; }

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
                                        dex, token.chain, CONFIG_CHAINS[token.chain.toLowerCase()].Kode_Chain,
                                        direction, 0, finalDexRes
                                    );
                                    // debug logs removed
                                    // Console log summary for this successful check (cleaned)
                                    try {
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
                                    // Append success details (rich format)
                                    try {
                                        const chainCfg = (window.CONFIG_CHAINS||{})[String(token.chain).toLowerCase()] || {};
                                        const chainName = (chainCfg.Nama_Chain || token.chain || '').toString().toUpperCase();
                                        const ce  = String(token.cex||'').toUpperCase();
                                        const dx  = String((finalDexRes?.dexTitle)||dex||'').toUpperCase();
                                        // Sumber nilai: jika alternatif dipakai tampilkan 'via LIFI' atau 'via SWOOP'
                                        const viaText = (function(){
                                            try {
                                                if (isFallback === true) {
                                                    // Jika fallback LIFI (memiliki routeTool/routeOverrideDex dari services), tampilkan via LIFI
                                                    if (finalDexRes && (typeof finalDexRes.routeTool !== 'undefined' || typeof finalDexRes.routeOverrideDex !== 'undefined')) return ' via LIFI';
                                                    // Selain itu fallback dianggap SWOOP
                                                    return ' via SWOOP';
                                                }
                                            } catch(_) {}
                                            return '';
                                        })();
                                        const nameIn  = String(isKiri ? token.symbol_in  : token.symbol_out).toUpperCase();
                                        const nameOut = String(isKiri ? token.symbol_out : token.symbol_in ).toUpperCase();
                                        const modal = Number(isKiri ? modalKiri : modalKanan) || 0;
                                        const amtIn  = Number(isKiri ? amount_in_token : amount_in_pair) || 0;
                                        const outAmt = Number(finalDexRes.amount_out)||0;
                                        const feeSwap = Number(finalDexRes.FeeSwap||0);
                                        const feeWD   = Number(isKiri ? DataCEX.feeWDToken : DataCEX.feeWDPair) || 0;
                                        const feeTrade = 0.0014 * modal;
                                        // Harga efektif DEX (USDT/token)
                                        let effDexPerToken = 0;
                                        if (isKiri) {
                                            if (nameOut === 'USDT') effDexPerToken = (amtIn>0)? (outAmt/amtIn) : 0;
                                            else effDexPerToken = (amtIn>0)? (outAmt/amtIn) * Number(DataCEX.priceSellPair||0) : 0;
                                        } else {
                                            if (nameIn === 'USDT') effDexPerToken = (outAmt>0)? (amtIn/outAmt) : 0;
                                            else effDexPerToken = (outAmt>0)? (amtIn/outAmt) * Number(DataCEX.priceBuyPair||0) : 0;
                                        }
                                        // Total value hasil (USDT)
                                        const totalValue = isKiri
                                          ? outAmt * Number(DataCEX.priceSellPair||0)
                                          : outAmt * Number(DataCEX.priceSellToken||0);
                                        const bruto = totalValue - modal;
                                        const totalFee = feeSwap + feeWD + feeTrade;
                                        const profitLoss = totalValue - (modal + totalFee);
                                        const pnlPct = modal>0 ? (bruto/modal)*100 : 0;
                                        const toIDR = (v)=>{ try{ return (typeof formatIDRfromUSDT==='function')? formatIDRfromUSDT(Number(v)||0):'';}catch(_){return '';} };
                                        const buyPriceCEX = Number(DataCEX.priceBuyToken||0);
                                        const buyLine = isKiri
                                          ? `    🛒 Beli di ${ce} @ $${buyPriceCEX.toFixed(6)} → ${amtIn.toFixed(6)} ${nameIn}`
                                          : `    🛒 Beli di ${dx} @ ~$${effDexPerToken.toFixed(6)} / ${nameOut}`;
                                        const buyIdrLine = isKiri
                                          ? `    💱 Harga Beli (${ce}) dalam IDR: ${toIDR(buyPriceCEX)}`
                                          : `    💱 Harga Beli (${dx}) dalam IDR: ${toIDR(effDexPerToken)}`;
                                        const sellIdrLine = isKiri
                                          ? `    💱 Harga Jual (${dx}) dalam IDR: ${toIDR(effDexPerToken)}`
                                          : `    💱 Harga Jual (${ce}) dalam IDR: ${toIDR(Number(DataCEX.priceSellToken||0))}`;
                                        // Header block (selalu tampil di awal tooltip)
                                        const nowStr = (new Date()).toLocaleTimeString();
                                        const viaName = (function(){
                                            try {
                                                if (isFallback === true) {
                                                    if (finalDexRes && (typeof finalDexRes.routeTool !== 'undefined' || typeof finalDexRes.routeOverrideDex !== 'undefined')) return 'LIFI';
                                                    return 'SWOOP';
                                                }
                                            } catch(_) {}
                                            return dx;
                                        })();
                                        const prosesLine = isKiri
                                          ? `PROSES : ${ce} => ${dx} (VIA ${viaName})`
                                          : `PROSES : ${dx} => ${ce} (VIA ${viaName})`;
                                        let statusLine = 'STATUS DEX : OK';
                                        if (isFallback === true && lastPrimaryError) {
                                            let s = 'FAILED';
                                            try {
                                                const ts = String(lastPrimaryError.textStatus||'').toLowerCase();
                                                if (ts === 'timeout' || /timeout/i.test(String(lastPrimaryError.pesanDEX||''))) s = 'TIMEOUT';
                                            } catch(_) { s = 'FAILED'; }
                                            const codeNum = Number(lastPrimaryError.statusCode);
                                            statusLine = `STATUS DEX : ${s} (KODE ERROR : ${Number.isFinite(codeNum)?codeNum:'NA'})`;
                                        }
                                        const headerBlock = [
                                            '======================================',
                                            `Time: ${nowStr}`,
                                           // `ID CELL: ${idCELL}`,
                                            prosesLine,
                                            statusLine
                                        ].join('\n');
                                        const lines = [
                                            headerBlock,
                                            `    🪙 Modal: $${modal.toFixed(2)}`,
                                            buyLine,
                                            buyIdrLine,
                                            '',
                                            `    💰 Swap di ${dx}:`,
                                            `    - Harga Swap Efektif: ~$${effDexPerToken.toFixed(6)} / ${nameIn}`,
                                            `    - Hasil: $${Number(totalValue||0).toFixed(6)}`,
                                            sellIdrLine,
                                            '',
                                            `    💸 Fee WD: $${feeWD.toFixed(2)}`,
                                            `    🛒 Fee Swap: $${feeSwap.toFixed(2)}`,
                                            `    🧾 Total Fee: ~$${totalFee.toFixed(2)}`,
                                            '',
                                            `    📈 PNL: ${bruto>=0?'+':''}${bruto.toFixed(2)} USDT (${pnlPct.toFixed(2)}%)`,
                                            `    🚀 PROFIT : ${profitLoss>=0?'+':''}${profitLoss.toFixed(2)} USDT`
                                        ].join('\n');
                                        appendCellTitleById(idCELL, lines);
                                        try { if (window.SCAN_LOG_ENABLED) console.log(lines); } catch(_) {}
                                    } catch(_) {}
                                    uiUpdateQueue.push(update);
                                };

                                const handleError = (initialError) => {
                                    try { lastPrimaryError = initialError; } catch(_) {}
                                    clearAllWatchdogs();
                                    // debug logs removed
                                    const dexConfig = CONFIG_DEXS[dex.toLowerCase()];
                                    // Build richer error title with HTTP status code only if not already present
                                    let msg = (initialError && initialError.pesanDEX) ? String(initialError.pesanDEX) : 'Unknown Error';
                                    const hasPrefix = /\[(HTTP \d{3}|XHR ERROR 200)\]/.test(msg);
                                    try {
                                        const code = Number(initialError && initialError.statusCode);
                                        if (!hasPrefix && Number.isFinite(code) && code > 0) {
                                            if (code === 200) msg = `[XHR ERROR 200] ${msg}`;
                                            else msg = `[HTTP ${code}] ${msg}`;
                                        }
                                    } catch(_) {}
                                    if (dexConfig && dexConfig.allowFallback) {
                                        updateDexCellStatus('fallback', dex, msg);
                                        // Mulai countdown untuk SWOOP fallback (5 detik)
                                        try {
                                            clearDexTickerById(idCELL);
                                            const endAtFB = Date.now() + 5000;
                                            // Use shared ticker helper
                                            const renderFB = (secs, cell) => {
                                                const span = ensureDexStatusSpan(cell);
                                                span.innerHTML = `<span class=\\"uk-margin-small-right\\" uk-spinner=\\"ratio: 0.5\\"></span>SWOOP (${secs}s)`;
                                                try { if (window.UIkit && UIkit.update) UIkit.update(cell); } catch(_) {}
                                            };
                                            const onEndFB = () => {
                                                const rawMsg = msg || 'Request Timeout';
                                                if (!(typeof document !== 'undefined' && document.hidden)) {
                                                    try { updateDexCellStatus('fallback_error', dex, rawMsg); } catch(_) {}
                                                }
                                            };
                                            // Define lightweight helper locally (no global pollution)
                                            const startTicker = (endAt, render, onEnd) => {
                                                try {
                                                    window._DEX_TICKERS = window._DEX_TICKERS || new Map();
                                                    const key = idCELL + ':ticker';
                                                    if (window._DEX_TICKERS.has(key)) { clearInterval(window._DEX_TICKERS.get(key)); window._DEX_TICKERS.delete(key); }
                                                    const tick = () => {
                                                        const rem = endAt - Date.now();
                                                        const secs = Math.max(0, Math.ceil(rem/1000));
                                                        const cell = document.getElementById(idCELL);
                                                        if (!cell) { clearDexTickerById(idCELL); return; }
                                                        if (cell.dataset && cell.dataset.final === '1') { clearDexTickerById(idCELL); return; }
                                                        render(secs, cell);
                                                        if (rem <= 0) { clearDexTickerById(idCELL); if (typeof onEnd === 'function') onEnd(); }
                                                    };
                                                    const intId = setInterval(tick, 1000);
                                                    window._DEX_TICKERS.set(key, intId);
                                                    tick();
                                                } catch(_) {}
                                            };
                                            startTicker(endAtFB, renderFB, onEndFB);
                                        } catch(_) {}
                                        setDexWatchdog(wdKeyFallback, () => {
                                            const m2 = msg || 'Request Timeout';
                                            try { clearDexTickerById(idCELL); } catch(_) {}
                                            updateDexCellStatus('fallback_error', dex, m2);
                                        }, 5000);
                                        getPriceAltDEX(
                                            isKiri ? token.sc_in : token.sc_out, isKiri ? token.des_in : token.des_out,
                                            isKiri ? token.sc_out : token.sc_in, isKiri ? token.des_out : token.des_in,
                                            isKiri ? amount_in_token : amount_in_pair, DataCEX.priceBuyPair, dex,
                                            isKiri ? token.symbol_in : token.symbol_out, isKiri ? token.symbol_out : token.symbol_in,
                                            token.cex, token.chain, CONFIG_CHAINS[token.chain.toLowerCase()].Kode_Chain, direction
                                        )
                                        .then((fallbackRes) => {
                                            clearDexWatchdog(wdKeyFallback);
                                            try { clearDexTickerById(idCELL); } catch(_) {}
                                            handleSuccess(fallbackRes, true);
                                        })
                                        .catch((fallbackErr) => {
                                            if (window._DEX_WATCHDOGS.has(wdKeyFallback)) clearTimeout(window._DEX_WATCHDOGS.get(wdKeyFallback));
                                            let finalMessage = (fallbackErr && fallbackErr.pesanDEX) ? fallbackErr.pesanDEX : (msg || 'Unknown');
                                            try {
                                                const sc = Number(fallbackErr && fallbackErr.statusCode);
                                                if (Number.isFinite(sc) && sc > 0) {
                                                    const prefix = (sc === 200) ? '[XHR ERROR 200] ' : `[HTTP ${sc}] `;
                                                    // Only add prefix if not already present
                                                    if (finalMessage.indexOf(prefix) !== 0) finalMessage = prefix + finalMessage;
                                                }
                                            } catch(_) {}
                                            try { clearDexTickerById(idCELL); } catch(_) {}
                                            updateDexCellStatus('fallback_error', dex, finalMessage);
                                            try {
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
                                        // Use formatted message with HTTP code when available (avoid duplicate prefix)
                                        updateDexCellStatus('error', dex, (function(){
                                            let m = (initialError && initialError.pesanDEX) ? String(initialError.pesanDEX) : 'Unknown Error';
                                            const hasPrefix2 = /\[(HTTP \d{3}|XHR ERROR 200)\]/.test(m);
                                            try {
                                                const code = Number(initialError && initialError.statusCode);
                                                if (!hasPrefix2 && Number.isFinite(code) && code > 0) {
                                                    if (code === 200) m = `[XHR ERROR 200] ${m}`; else m = `[HTTP ${code}] ${m}`;
                                                }
                                            } catch(_) {}
                                            return m;
                                        })());
                                        // Tambahkan header block ke tooltip + console (jika Log ON)
                                        try {
                                            const nowStr = (new Date()).toLocaleTimeString();
                                            const dxName = String(dex||'').toUpperCase();
                                            const ceName = String(token.cex||'').toUpperCase();
                                            // PROSES mengikuti arah
                                            const prosesLine = (direction === 'TokentoPair')
                                                ? `PROSES : ${ceName} => ${dxName} (VIA ${dxName})`
                                                : `PROSES : ${dxName} => ${ceName} (VIA ${dxName})`;
                                            // STATUS
                                            let s = 'FAILED';
                                            try {
                                                const ts = String(initialError && initialError.textStatus || '').toLowerCase();
                                                if (ts === 'timeout' || /timeout/i.test(String(initialError && initialError.pesanDEX||''))) s = 'TIMEOUT';
                                            } catch(_) { s = 'FAILED'; }
                                            const codeNum = Number(initialError && initialError.statusCode);
                                            const statusLine = `STATUS DEX : ${s} (KODE ERROR : ${Number.isFinite(codeNum)?codeNum:'NA'})`;
                                            const headerBlock = [
                                                '======================================',
                                                `Time: ${nowStr}`,
                                               // `ID CELL: ${idCELL}`,
                                                prosesLine,
                                                statusLine
                                            ].join('\n');
                                            appendCellTitleById(idCELL, headerBlock);
                                            try { if (window.SCAN_LOG_ENABLED) console.log(headerBlock); } catch(_) {}
                                        } catch(_) {}
                                        try {
                                            // Align console info with requested orderbook logic (logs removed)
                                        } catch(_) {}
                                    }
                                };

                                // debug logs removed
                                // Include CEX summary in title while checking
                                const fmt6 = v => (Number.isFinite(+v) ? (+v).toFixed(6) : String(v));
                                const cexSummary = `CEX READY BT=${fmt6(DataCEX.priceBuyToken)} ST=${fmt6(DataCEX.priceSellToken)} BP=${fmt6(DataCEX.priceBuyPair)} SP=${fmt6(DataCEX.priceSellPair)}`;
                                updateDexCellStatus('checking', dex, cexSummary);
                                const dexTimeoutWindow = getJedaDex(dex) + Math.max(speedScan) + 300;
                                setDexWatchdog(wdKeyCheck, () => { updateDexCellStatus('error', dex, `${dex.toUpperCase()}: Request Timeout`); }, dexTimeoutWindow);
                                // Mulai ticker countdown untuk menampilkan sisa detik pada label "Check"
                                try {
                                    const endAt = Date.now() + dexTimeoutWindow;
                                    // Stamp a deadline on the cell for a global safety sweeper
                                    try { const c = document.getElementById(idCELL); if (c) { c.dataset.deadline = String(endAt); c.dataset.dex = String(dex); c.dataset.checking = '1'; } } catch(_) {}
                                    const renderCheck = (secs, cell) => {
                                        const span = ensureDexStatusSpan(cell);
                                        span.innerHTML = `<span class=\"uk-margin-small-right\" uk-spinner=\"ratio: 0.5\"></span>${String(dex||'').toUpperCase()} (${secs}s)`;
                                        try { if (window.UIkit && UIkit.update) UIkit.update(cell); } catch(_) {}
                                    };
                                    const onEndCheck = () => {
                                        // If tab is hidden, don't finalize ERROR here; watchdog defers until visible
                                        if (!(typeof document !== 'undefined' && document.hidden)) {
                                            try { updateDexCellStatus('error', dex, `${String(dex||'').toUpperCase()}: Request Timeout`); } catch(_) {}
                                        }
                                    };
                                    // Define lightweight helper locally (reused)
                                    const startTicker = (endAt, render, onEnd) => {
                                        try {
                                            window._DEX_TICKERS = window._DEX_TICKERS || new Map();
                                            const key = idCELL + ':ticker';
                                            if (window._DEX_TICKERS.has(key)) { clearInterval(window._DEX_TICKERS.get(key)); window._DEX_TICKERS.delete(key); }
                                            const tick = () => {
                                                const rem = endAt - Date.now();
                                                const secs = Math.max(0, Math.ceil(rem/1000));
                                                const cell = document.getElementById(idCELL);
                                                if (!cell) { clearDexTickerById(idCELL); return; }
                                                if (cell.dataset && cell.dataset.final === '1') { clearDexTickerById(idCELL); return; }
                                                render(secs, cell);
                                                if (rem <= 0) { clearDexTickerById(idCELL); if (typeof onEnd === 'function') onEnd(); }
                                            };
                                            const intId = setInterval(tick, 1000);
                                            window._DEX_TICKERS.set(key, intId);
                                            tick();
                                        } catch(_) {}
                                    };
                                    startTicker(endAt, renderCheck, onEndCheck);
                                } catch(_) {}

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
                            // Jalankan arah Token→Pair terlebih dahulu; lalu arah Pair→Token setelah jeda per-DEX dari setting
                            callDex('TokentoPair');
                            (function(){
                                const gap = getJedaDex(dex) || 0;
                                if (gap > 0) setTimeout(() => { try { callDex('PairtoToken'); } catch(_) {} }, gap);
                                else callDex('PairtoToken');
                            })();
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
                    // Respect user interaction: temporarily suspend auto-scroll
                    try { if (window.__AUTO_SCROLL_SUSPEND_UNTIL && Date.now() < window.__AUTO_SCROLL_SUSPEND_UNTIL) return; } catch(_) {}
                    const $target = $('#' + fullId).length ? $('#' + fullId) : $(`[id$="${suffix}"]`).first();
                    if (!$target.length) return;
                    $target.addClass('auto-focus');
                    setTimeout(() => $target.removeClass('auto-focus'), 900);
                    // Prefer explicit monitoring container; fallback to nearest scrollable
                    let $container = $('#monitoring-scroll');
                    if (!$container.length) $container = $target.closest('.uk-overflow-auto');
                    if (!$container.length) return; // do not scroll the main page

                    // If container not scrollable, skip instead of scrolling the body
                    const cEl = $container[0];
                    if (!(cEl.scrollHeight > cEl.clientHeight)) return;

                    const tRect = $target[0].getBoundingClientRect();
                    const cRect = cEl.getBoundingClientRect();
                    // Skip if already fully visible inside container viewport
                    const fullyVisible = (tRect.top >= cRect.top) && (tRect.bottom <= cRect.bottom);
                    if (fullyVisible) return;

                    const desiredTop = (tRect.top - cRect.top) + $container.scrollTop() - (cEl.clientHeight / 2) + ($target[0].clientHeight / 2);
                    $container.animate({ scrollTop: Math.max(desiredTop, 0) }, 200);
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
        // Restore page title after scan completes
        setPageTitleForRun(false);
        form_on();
        $("#stopSCAN").hide().prop("disabled", true);
        $('#startSCAN').prop('disabled', false).text('Start').removeClass('uk-button-disabled');
        // Release gating via centralized helper
        if (typeof setScanUIGating === 'function') setScanUIGating(false); // REFACTORED
        // Persist run=NO reliably before any potential next action
        await persistRunStateNo();

        // Unlock DEX header list after scan completes and refresh header to reflect current selection
        try {
            if (typeof window !== 'undefined') { window.__LOCKED_DEX_LIST = null; }
            if (typeof window.renderMonitoringHeader === 'function' && typeof window.computeActiveDexList === 'function') {
                window.renderMonitoringHeader(window.computeActiveDexList());
            }
        } catch(_) {}

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


/**
 * Stops the currently running scanner.
 */
async function stopScanner() {
    isScanRunning = false; // REFACTORED
    try { cancelAnimationFrame(animationFrameId); } catch(_) {}
    clearInterval(window.__autoRunInterval); // REFACTORED
    window.__autoRunInterval = null;
    // Restore page title if user stops the scan
    setPageTitleForRun(false);
    if (typeof form_on === 'function') form_on(); // REFACTORED
    try { sessionStorage.setItem('APP_FORCE_RUN_NO', '1'); } catch(_) {}
    // Persist run=NO and refresh indicators before reload
    await persistRunStateNo();
    location.reload(); // REFACTORED
}

/**
 * Soft-stop scanner without reloading the page.
 * Useful before running long operations (e.g., Update Wallet CEX).
 */
function stopScannerSoft() {
    isScanRunning = false; // REFACTORED
    try { cancelAnimationFrame(animationFrameId); } catch(_) {}
    // Persist run=NO and refresh indicators without reload
    try { (async()=>{ await persistRunStateNo(); })(); } catch(_) {}
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
        // If multichain mode is running, prepend MULTICHAIN flag
        try { if (cache.multichain) labels.unshift('MULTICHAIN'); } catch(_) {}
        if (labels.length > 0) {
            $('#infoAPP').html(` RUN SCANNING: ${labels.join(' | ')}`).show();
        } else {
            // No running chains → clear banner
            $('#infoAPP').text('').hide();
        }
    } catch(_) {}
}

try { window.updateRunningChainsBanner = window.updateRunningChainsBanner || updateRunningChainsBanner; } catch(_){}

// Consolidated helper: persist run state NO and refresh indicators
async function persistRunStateNo() {
    try {
        const key = (typeof getActiveFilterKey === 'function') ? getActiveFilterKey() : 'FILTER_MULTICHAIN';
        const cur = (typeof getFromLocalStorage === 'function') ? (getFromLocalStorage(key, {}) || {}) : {};
        if (typeof saveToLocalStorageAsync === 'function') {
            await saveToLocalStorageAsync(key, Object.assign({}, cur, { run: 'NO' }));
        } else {
            setAppState({ run: 'NO' });
        }
        if (typeof window.updateRunStateCache === 'function') { try { window.updateRunStateCache(key, { run: 'NO' }); } catch(_) {} }
    } catch(_) { try { setAppState({ run: 'NO' }); } catch(__) {} }
    try {
        if (typeof window.updateRunStateCache === 'function') {
            try { window.updateRunStateCache(getActiveFilterKey(), { run: 'NO' }); } catch(_) {}
        }
        try { (window.CURRENT_CHAINS || []).forEach(c => window.updateRunStateCache(`FILTER_${String(c).toUpperCase()}`, { run: 'NO' })); } catch(_) {}
    } catch(_){}
    try {
        if (typeof window.updateRunningChainsBanner === 'function') window.updateRunningChainsBanner();
        if (typeof window.updateToolbarRunIndicators === 'function') window.updateToolbarRunIndicators();
    } catch(_){}
}
