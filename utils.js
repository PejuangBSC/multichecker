// =================================================================================
// UTILITY FUNCTIONS
// =================================================================================

function getManagedChains() {
    const settings = getFromLocalStorage('SETTING_SCANNER', {});
    return settings.AllChains || Object.keys(CONFIG_CHAINS);
}

// =================================================================================
// APP MODE & DATA ACCESS HELPERS (shared by UI/API/Main)
// =================================================================================

/**
 * Resolves application mode from URL query.
 * - multi: index.html?chain=all
 * - single: index.html?chain=<chain>
 */
function getAppMode() {
    try {
        if (window.AppMode && window.AppMode._cached) return window.AppMode;
        const params = new URLSearchParams(window.location.search || '');
        const raw = (params.get('chain') || '').toLowerCase();
        let mode;
        if (!raw || raw === 'all') {
            mode = { type: 'multi' };
        } else if (window.CONFIG_CHAINS && window.CONFIG_CHAINS[raw]) {
            mode = { type: 'single', chain: raw };
        } else {
            mode = { type: 'multi' };
        }
        window.AppMode = Object.assign({ _cached: true }, mode);
        return window.AppMode;
    } catch (_) {
        return { type: 'multi' };
    }
}

/** Returns the active token storage key based on mode. */
function getActiveTokenKey() {
    const m = getAppMode();
    if (m.type === 'single') return `TOKEN_${String(m.chain).toUpperCase()}`;
    return 'TOKEN_MULTICHAIN';
}

/** Returns the active filter storage key based on mode. */
function getActiveFilterKey() {
    const m = getAppMode();
    if (m.type === 'single') return `FILTER_${String(m.chain).toUpperCase()}`;
    return 'FILTER_MULTICHAIN';
}

/** Get tokens for active mode. */
function getActiveTokens(defaultVal = []) {
    return getFromLocalStorage(getActiveTokenKey(), defaultVal) || defaultVal;
}

/** Save tokens for active mode. */
function saveActiveTokens(list) {
    return saveToLocalStorage(getActiveTokenKey(), Array.isArray(list) ? list : []);
}

/** Get filters for active mode. */
function getActiveFilters(defaultVal = null) {
    return getFromLocalStorage(getActiveFilterKey(), defaultVal);
}

/** Save filters for active mode. */
function saveActiveFilters(obj) {
    return saveToLocalStorage(getActiveFilterKey(), obj || {});
}

// PNL filter helpers per mode
function getPNLFilter() {
    try {
        const f = getFromLocalStorage(getActiveFilterKey(), {}) || {};
        const v = parseFloat(f.pnl);
        return isFinite(v) && v >= 0 ? v : 0;
    } catch(_) { return 0; }
}

function setPNLFilter(value) {
    const v = parseFloat(value);
    const key = getActiveFilterKey();
    const f = getFromLocalStorage(key, {}) || {};
    f.pnl = isFinite(v) && v >= 0 ? v : 0;
    saveToLocalStorage(key, f);
}

// =================================================================================
// MODULAR FILTER AND TOKEN HELPERS (shared across app)
// =================================================================================

function getFilterMulti() {
    const f = getFromLocalStorage('FILTER_MULTICHAIN', null);
    if (f && typeof f === 'object') return { chains: f.chains || [], cex: f.cex || [] };
    return { chains: [], cex: [] };
}

function setFilterMulti(val){
    // Merge with existing filter so other keys (e.g., sort, pnl) remain intact
    const prev = getFromLocalStorage('FILTER_MULTICHAIN', {}) || {};
    const next = { ...prev };
    if (val && Object.prototype.hasOwnProperty.call(val, 'chains')) {
        next.chains = (val.chains || []).map(x => String(x).toLowerCase());
    }
    if (val && Object.prototype.hasOwnProperty.call(val, 'cex')) {
        next.cex = (val.cex || []).map(x => String(x).toUpperCase());
    }
    saveToLocalStorage('FILTER_MULTICHAIN', next);
}

function getFilterChain(chain){
    const chainKey = String(chain).toLowerCase();
    const key = `FILTER_${String(chainKey).toUpperCase()}`;
    let f = getFromLocalStorage(key, null);
    if (!f || typeof f !== 'object'){
        try {
            const legacyName = (window.CONFIG_CHAINS?.[chainKey]?.Nama_Chain || '').toString().toUpperCase();
            if (legacyName) {
                const legacyKey = `FILTER_${legacyName}`;
                const lf = getFromLocalStorage(legacyKey, null);
                if (lf && typeof lf === 'object') {
                    // migrate
                    saveToLocalStorage(key, lf);
                    f = lf;
                }
            }
        } catch(_) {}
    }
    if (f && typeof f==='object') return { cex: (f.cex||[]).map(String), pair: (f.pair||[]).map(x=>String(x).toUpperCase()) };
    return { cex: [], pair: [] };
}

function setFilterChain(chain, val){
    const key = `FILTER_${String(chain).toUpperCase()}`;
    const prev = getFromLocalStorage(key, {}) || {};
    const next = { ...prev };
    if (val && Object.prototype.hasOwnProperty.call(val, 'cex')) {
        next.cex = (val.cex || []).map(String);
    }
    if (val && Object.prototype.hasOwnProperty.call(val, 'pair')) {
        next.pair = (val.pair || []).map(x => String(x).toUpperCase());
    }
    saveToLocalStorage(key, next);
}

// =================================================================================
// SORTING HELPERS (symbol_in ASC/DESC) BASED ON IDB DATA
// =================================================================================
function sortBySymbolIn(list, pref){
    const dir = (pref === 'Z') ? -1 : 1; // default ASC
    return (Array.isArray(list) ? [...list] : []).sort((a,b)=>{
        const A = String(a.symbol_in||'').toUpperCase();
        const B = String(b.symbol_in||'').toUpperCase();
        if (A < B) return -1 * dir;
        if (A > B) return  1 * dir;
        return 0;
    });
}

function getSortPrefForMulti(){
    try { const f = getFromLocalStorage('FILTER_MULTICHAIN', null); return (f && (f.sort==='A'||f.sort==='Z')) ? f.sort : 'A'; } catch(_) { return 'A'; }
}
function getSortPrefForChain(chain){
    try { const key = `FILTER_${String(chain).toUpperCase()}`; const f = getFromLocalStorage(key, null); return (f && (f.sort==='A'||f.sort==='Z')) ? f.sort : 'A'; } catch(_) { return 'A'; }
}

function getFlattenedSortedMulti(){
    const pref = getSortPrefForMulti();
    const tokens = getTokensMulti();
    const flat = flattenDataKoin(tokens);
    return sortBySymbolIn(flat, pref);
}

function getFlattenedSortedChain(chain){
    const pref = getSortPrefForChain(chain);
    const tokens = getTokensChain(chain);
    const flat = flattenDataKoin(tokens);
    return sortBySymbolIn(flat, pref);
}

function getTokensMulti(){
    const t = getFromLocalStorage('TOKEN_MULTICHAIN', []);
    return Array.isArray(t) ? t : [];
}

function setTokensMulti(list){
    const prev = getFromLocalStorage('TOKEN_MULTICHAIN', []);
    const arr = Array.isArray(list) ? list : [];
    saveToLocalStorage('TOKEN_MULTICHAIN', arr);
    try {
        const hadNoneBefore = !Array.isArray(prev) || prev.length === 0;
        const nowHas = Array.isArray(arr) && arr.length > 0;
        if (nowHas && hadNoneBefore) {
            // Initialize default FILTER_MULTICHAIN to select all chains and CEX
            const chains = Object.keys(window.CONFIG_CHAINS || {}).map(k => String(k).toLowerCase());
            const cex = Object.keys(window.CONFIG_CEX || {}).map(k => String(k).toUpperCase());
            const existing = getFromLocalStorage('FILTER_MULTICHAIN', null);
            const empty = !existing || (!Array.isArray(existing.chains) && !Array.isArray(existing.cex)) || ((existing.chains||[]).length===0 && (existing.cex||[]).length===0);
            if (empty) {
                setFilterMulti({ chains, cex });
            }
        }
    } catch(_) {}
}

// Async variants for explicit success/failure reporting (non-breaking: new helpers)
async function setTokensMultiAsync(list){
    const arr = Array.isArray(list) ? list : [];
    const { ok } = await (window.saveToLocalStorageAsync ? window.saveToLocalStorageAsync('TOKEN_MULTICHAIN', arr) : Promise.resolve({ ok: true }));
    return ok;
}

function getTokensChain(chain){
    const chainKey = String(chain).toLowerCase();
    const primaryKey = `TOKEN_${String(chainKey).toUpperCase()}`;
    let t = getFromLocalStorage(primaryKey, []);
    if (Array.isArray(t) && t.length) return t;
    // Fallback to legacy naming using Nama_Chain (e.g., ETHEREUM) if present in backup
    try {
        const legacyName = (window.CONFIG_CHAINS?.[chainKey]?.Nama_Chain || '').toString().toUpperCase();
        if (legacyName) {
            const legacyKey = `TOKEN_${legacyName}`;
            const legacy = getFromLocalStorage(legacyKey, []);
            if (Array.isArray(legacy) && legacy.length) {
                // Migrate into primary for consistency
                saveToLocalStorage(primaryKey, legacy);
                return legacy;
            }
        }
    } catch(_) {}
    return Array.isArray(t) ? t : [];
}

function setTokensChain(chain, list){
    const chainKey = String(chain).toLowerCase();
    const key = `TOKEN_${String(chainKey).toUpperCase()}`;
    const prev = getFromLocalStorage(key, []);
    const arr = Array.isArray(list) ? list : [];
    saveToLocalStorage(key, arr);
    try {
        const hadNoneBefore = !Array.isArray(prev) || prev.length === 0;
        const nowHas = Array.isArray(arr) && arr.length > 0;
        if (nowHas && hadNoneBefore) {
            // Initialize default FILTER_<CHAIN> to select all relevant CEX and PAIR
            const cfg = (window.CONFIG_CHAINS || {})[chainKey] || {};
            const cex = Object.keys(cfg.WALLET_CEX || window.CONFIG_CEX || {}).map(k => String(k));
            const pairs = Array.from(new Set([...(Object.keys(cfg.PAIRDEXS || {})), 'NON'])).map(x => String(x).toUpperCase());
            const fkey = `FILTER_${String(chainKey).toUpperCase()}`;
            const existing = getFromLocalStorage(fkey, null);
            const empty = !existing || ((existing.cex||[]).length===0 && (existing.pair||[]).length===0);
            if (empty) {
                setFilterChain(chain, { cex, pair: pairs });
            }
        }
    } catch(_) {}
}

async function setTokensChainAsync(chain, list){
    const key = `TOKEN_${String(chain).toLowerCase().toUpperCase()}`; // keep current primary
    const arr = Array.isArray(list) ? list : [];
    const { ok } = await (window.saveToLocalStorageAsync ? window.saveToLocalStorageAsync(key, arr) : Promise.resolve({ ok: true }));
    return ok;
}

// =================================================================================
// FEATURE READINESS & GATING HELPERS
// =================================================================================

function getFeatureReadiness() {
    const mode = getAppMode();
    const settings = getFromLocalStorage('SETTING_SCANNER', {});
    const hasSettings = !!(settings && typeof settings === 'object' && Object.keys(settings).length);
    let hasTokensMulti = false;
    let hasTokensChain = false;
    try {
        const multi = getTokensMulti();
        hasTokensMulti = Array.isArray(multi) && multi.length > 0;
    } catch(_) {}
    try {
        if (mode.type === 'single') {
            const chainList = getTokensChain(mode.chain);
            hasTokensChain = Array.isArray(chainList) && chainList.length > 0;
        }
    } catch(_) {}

    const feature = {
        settings: true,
        scan: hasSettings && (mode.type === 'single' ? hasTokensChain : hasTokensMulti),
        manage: hasSettings, // aktif jika setting sudah ada (semua mode)
        sync: hasSettings && (mode.type === 'single'),
        import: hasSettings,
        export: hasSettings && (mode.type === 'single' ? hasTokensChain : hasTokensMulti),
        wallet: hasSettings && (hasTokensChain || hasTokensMulti),
        assets: hasSettings,
        proxy: true,
        reload: true
    };

    return { mode, hasSettings, hasTokensMulti, hasTokensChain, feature };
}

/**
 * Apply theme color based on mode:
 * - multi: keep existing green accent
 * - single: use CONFIG_CHAINS[chain].WARNA
 */
function applyThemeForMode() {
    try {
        const m = getAppMode();
        const root = document.documentElement;
        const body = document.body || document.getElementsByTagName('body')[0];
        if (!root || !body) return;

        let accent = '#5c9514'; // default for multi
        let label = '[ALL]';
        body.classList.remove('theme-single', 'theme-multi');

        if (m.type === 'single') {
            const cfg = (window.CONFIG_CHAINS || {})[m.chain] || {};
            accent = cfg.WARNA || accent;
            label = `[${(cfg.Nama_Pendek || cfg.Nama_Chain || m.chain || 'CHAIN').toString().toUpperCase()}]`;
            body.classList.add('theme-single');
        } else {
            body.classList.add('theme-multi');
        }

        root.style.setProperty('--theme-accent', accent);
        const chainLabel = document.getElementById('current-chain-label');
        if (chainLabel) {
            chainLabel.textContent = label;
            chainLabel.style.color = accent;
        }

        // Inject or update a style tag for theme overrides
        let styleEl = document.getElementById('dynamic-theme-style');
        const css = `
          :root { --theme-accent: ${accent}; }
          .theme-single .uk-table thead th, .theme-multi .uk-table thead th { background: var(--theme-accent) !important; }
          #progress-bar { background-color: var(--theme-accent) !important; }
          #progress-container { border: 1px solid var(--theme-accent) !important; }
          .header-card { border-color: var(--theme-accent) !important; }
          /* Cards and panels */
          #filter-card, #scanner-config, #token-management { border-color: var(--theme-accent) !important; }
          .uk-overflow-auto { border-color: var(--theme-accent) !important; }
          .uk-card.uk-card-default { border-color: var(--theme-accent); }
          /* Modal header accent */
          .uk-modal-header { border-bottom: 2px solid var(--theme-accent) !important; }
          /* Toggles */
          .toggle-radio.active { background-color: var(--theme-accent) !important; }
          #judul { color: #000; }
          /* Themed body background */
          body.theme-single { background: linear-gradient(180deg, var(--theme-accent) 0%, #ffffff 45%) !important; }
          body.theme-multi  { background: linear-gradient(180deg, #5c9514 0%, #ffffff 45%) !important; }
        `;
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dynamic-theme-style';
            styleEl.type = 'text/css';
            styleEl.appendChild(document.createTextNode(css));
            document.head.appendChild(styleEl);
        } else {
            styleEl.textContent = css;
        }
    } catch (e) {
        console.warn('applyThemeForMode failed:', e);
    }
}

/**
 * Creates a hyperlink with a hover title.
 * @param {string} url - The URL for the link.
 * @param {string} text - The visible text for the link.
 * @param {string} [className=''] - Optional CSS class.
 * @returns {string} HTML string for the anchor tag.
 */
function createHoverLink(url, text, className = '') {
    // Force link to inherit color from its parent (so chain accent colors apply)
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="hover-link ${className}" style="color:inherit;" title="${url}">${text}</a>`;
}

/**
 * Validates a URL, returning a fallback if invalid.
 * @param {string} u - The URL to validate.
 * @param {string} fallback - The fallback URL.
 * @returns {string} The original URL or the fallback.
 */
function safeUrl(u, fallback) {
    return (u && typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : fallback;
}

/**
 * Creates a styled link for deposit/withdraw status.
 * @param {boolean} flag - The status flag (true for active).
 * @param {string} label - The label text (e.g., 'DP', 'WD').
 * @param {string} urlOk - The URL to use if the status is active.
 * @param {string} [colorOk='green'] - The color for the active status.
 * @returns {string} HTML string for the status.
 */
function linkifyStatus(flag, label, urlOk, colorOk = 'green') {
    // Selalu pertahankan hyperlink bila URL tersedia; ubah hanya teks + warna
    const safe = (u) => (u && /^https?:\/\//i.test(u)) ? u : '#';
    let text = label;
    let color = colorOk;
    if (flag === true) {
        text = label; // e.g., 'WD' / 'DP'
        color = colorOk || 'green';
    } else if (flag === false) {
        text = (label === 'DP') ? 'DX' : 'WX';
        color = 'red';
    } else {
        // Unknown / belum sinkron → tampilkan "WD ?" atau "DP ?"
        text = `${label}?`;
        color = 'black';
    }
    return `<a href="${safe(urlOk)}" target="_blank" rel="noopener noreferrer" class="uk-text-bold" style="color:${color};">${text}</a>`;
}

/**
 * Gets a styled status label.
 * @param {boolean} flag - The status flag.
 * @param {string} type - The label type (e.g., 'DP').
 * @returns {string} HTML string for the label.
 */
function getStatusLabel(flag, type) {
    if (flag === true) return `<b style="color:green; font-weight:bold;">${type}</b>`;
    if (flag === false) return `<b style="color:red; font-weight:bold;">${type.replace('P', 'X')}</b>`;
    return `<b style="color:black; font-weight:bold;">${type.replace('P', '-')}</b>`;
}

/**
 * Converts a HEX color to an RGBA color.
 * @param {string} hex - The hex color string.
 * @param {number} alpha - The alpha transparency value.
 * @returns {string} The RGBA color string.
 */
function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Formats a price number into a display string with a '$' sign.
 * Handles small decimal numbers with a special format.
 * @param {number} price - The price to format.
 * @returns {string} The formatted price string.
 */
function formatPrice(price) {
    if (price >= 1) {
        return price.toFixed(3) + '$'; // Jika >= 1, tampilkan 2 angka desimal
    }

    let strPrice = price.toFixed(20).replace(/0+$/, ''); // Paksa format desimal, hapus nol di akhir
    let match = strPrice.match(/0\.(0*)(\d+)/); // Ambil nol setelah koma dan angka signifikan

    if (match) {
        let zeroCount = match[1].length; // Hitung jumlah nol setelah koma
        let significant = match[2].substring(0, 4); // Ambil 5 digit signifikan pertama

        // Jika angka signifikan kurang dari 5 digit, tambahkan nol di akhir
        significant = significant.padEnd(4, '0');

        if (zeroCount >= 2) {
            return `0.{${zeroCount}}${significant}$`; // Format dengan {N} jika nol >= 2
        } else {
            return `0.${match[1]}${significant}$`; // Format biasa jika nol < 2
        }
    }

    return price.toFixed(6) + '$'; // Fallback jika format tidak dikenali
}

/**
 * Creates a simple hyperlink.
 * @param {string} url - The URL.
 * @param {string} text - The link text.
 * @param {string} [className=''] - Optional CSS class.
 * @returns {string} HTML string for the anchor tag.
 */
function createLink(url, text, className = '') {
    return url
        ? `<a href="${url}" target="_blank" class="${className}"><b>${text}</b></a>`
        : `<b>${text}</b>`;
}

/**
 * Generates various URLs for a given CEX and token pair.
 * @param {string} cex - The CEX name (e.g., 'GATE', 'BINANCE').
 * @param {string} NameToken - The base token symbol.
 * @param {string} NamePair - The quote token symbol.
 * @returns {object} An object containing different URL types (trade, withdraw, deposit).
 */
function GeturlExchanger(cex, NameToken, NamePair) {
    try {
        if (window.CEX && CEX.link && typeof CEX.link.buildAll === 'function') {
            return CEX.link.buildAll(cex, NameToken, NamePair);
        }
    } catch(_) {}
    // Fallback: use CONFIG_CEX.LINKS if available
    try {
        const cfg = (window.CONFIG_CEX || {})[String(cex||'').toUpperCase()] || {};
        const L = cfg.LINKS || {};
        const T = String(NameToken||'').toUpperCase();
        const P = String(NamePair||'').toUpperCase();
        const build = (fn, args) => { try { return typeof fn === 'function' ? fn(args) : null; } catch(_) { return null; } };
        const tradeToken = build(L.tradeToken, { cex, token: T, pair: P }) || '#';
        const tradePair  = build(L.tradePair,  { cex, token: T, pair: P }) || '#';
        const withdraw   = build(L.withdraw,   { cex, token: T, pair: P }) || '#';
        const deposit    = build(L.deposit,    { cex, token: T, pair: P }) || '#';
        return {
            tradeToken, tradePair,
            withdrawUrl: withdraw, depositUrl: deposit,
            withdrawTokenUrl: withdraw, depositTokenUrl: deposit,
            withdrawPairUrl: withdraw, depositPairUrl: deposit
        };
    } catch(_) {}
    // Last resort minimal object
    return { tradeToken: '#', tradePair: '#', withdrawUrl: '#', depositUrl: '#', withdrawTokenUrl: '#', depositTokenUrl: '#', withdrawPairUrl: '#', depositPairUrl: '#'};
}

/**
 * Retrieves configuration data for a specific chain.
 * @param {string} chainName - The name of the chain (e.g., 'polygon').
 * @returns {object|null} The chain configuration object or null if not found.
 */
function getChainData(chainName) {
    if (!chainName) return null;
    
    const chainLower = chainName.toLowerCase();
    const chainData = CONFIG_CHAINS[chainLower];
    
    const managedChains = getManagedChains();
    if (!managedChains.includes(chainLower)) {
        return null;
    }
    
    if (!chainData) {
        return null;
    }

    return {
        Kode_Chain: chainData.Kode_Chain || '',
        Nama_Chain: chainData.Nama_Chain || '',
        DEXS: chainData.DEXS || {},
        PAIRDExS: chainData.PAIRDExS || {},
        URL_Chain: chainData.URL_Chain || '', 
        DATAJSON: chainData.DATAJSON || {},
        BaseFEEDEX: chainData.BaseFEEDEX || '',
        CEXCHAIN: chainData.WALLET_CEX || {},
        ICON_CHAIN: chainData.ICON || '',
        COLOR_CHAIN: chainData.WARNA || '#000',
        SHORT_NAME: chainData.Nama_Pendek || '',
        RPC: chainData.RPC || '' // ⬅ penting
    };
}

function _normalizeChainLabel(s){
    return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function resolveWalletChainBySynonym(walletInfo, chainKey, desiredLabel){
    if (!walletInfo || typeof walletInfo !== 'object') return null;
    const keys = Object.keys(walletInfo);
    if (!keys.length) return null;
    const normDesired = _normalizeChainLabel(desiredLabel||'');
    // direct exact (normalized) match first
    if (normDesired) {
        const hit = keys.find(k => _normalizeChainLabel(k) === normDesired);
        if (hit) return walletInfo[hit];
    }
    // synonym match by chainKey catalogue
    let cat = [];
    try {
        cat = ((typeof window !== 'undefined' && window.CHAIN_SYNONYMS) ? window.CHAIN_SYNONYMS : (typeof CHAIN_SYNONYMS !== 'undefined' ? CHAIN_SYNONYMS : {}))[ String(chainKey||'').toLowerCase() ] || [];
    } catch(_) { cat = []; }
    const candidates = new Set(cat.map(_normalizeChainLabel));
    candidates.add(_normalizeChainLabel(chainKey));
    // try any key that matches synonyms
    for (const k of keys) {
        const nk = _normalizeChainLabel(k);
        if (candidates.has(nk)) return walletInfo[k];
    }
    // loose contains match (e.g., BASEMAINNET contains BASE)
    for (const k of keys) {
        const nk = _normalizeChainLabel(k);
        for (const s of candidates) { if (nk.includes(s)) return walletInfo[k]; }
    }
    return null;
}

try {
    if (typeof window !== 'undefined') {
        window.resolveWalletChainBySynonym = window.resolveWalletChainBySynonym || resolveWalletChainBySynonym;
    }
} catch(_){}

/**
 * Retrieves configuration data for a specific CEX.
 * @param {string} cexName - The name of the CEX (e.g., 'BINANCE').
 * @returns {object|null} The CEX configuration object or null if not found.
 */
function getCexDataConfig(cexName) {
    if (!cexName || typeof cexName !== 'string') return null;

    const key = cexName.toUpperCase();
    const cexData = (typeof CONFIG_CEX === 'object' && CONFIG_CEX[key]) ? CONFIG_CEX[key] : null;

    if (!cexData) {
        return null;
    }

    return {
        NAME: key,
        API_KEY: cexData.ApiKey || '',
        API_SECRET: cexData.ApiSecret || '',
        COLOR: cexData.WARNA || '#000'
    };
}

/**
 * Retrieves configuration data for a specific DEX.
 * @param {string} dexName - The name of the DEX (e.g., 'kyberswap').
 * @returns {object|null} The DEX configuration object or null if not found.
 */
function getDexData(dexName) {
    if (!dexName || typeof dexName !== 'string') return null;

    const nameLower = dexName.toLowerCase();
    let dexKey = nameLower;
    if (nameLower === '0x') dexKey = '0x';
    if (nameLower === '1inch') dexKey = '1inch';

    const dexConfig = (typeof CONFIG_DEXS === 'object') ? CONFIG_DEXS[dexKey] : undefined;

    if (!dexConfig) {
        return null;
    }

    const supportedChains = Object.keys(CONFIG_CHAINS || {})
        .filter(chain => Array.isArray(CONFIG_CHAINS[chain].DEXS) && CONFIG_CHAINS[chain].DEXS.map(String).map(s => s.toLowerCase()).includes(dexKey))
        .map(chain => ({
            key: chain,
            code: CONFIG_CHAINS[chain].Kode_Chain || '',
            name: CONFIG_CHAINS[chain].Nama_Chain || chain,
            short: CONFIG_CHAINS[chain].Nama_Pendek || '',
            color: CONFIG_CHAINS[chain].WARNA || '#000'
        }));

    return {
        NAME: dexKey,
        HAS_BUILDER: typeof dexConfig.builder === 'function',
        BUILDER: dexConfig.builder || null,
        ALLOW_FALLBACK: !!dexConfig.allowFallback,
        SUPPORTED_CHAINS: supportedChains
    };
}

/**
 * Flattens the token data from TOKEN_SCANNER, creating a separate entry for each selected CEX.
 * @param {Array} dataTokens - The array of token objects from storage.
 * @returns {Array} A flattened array of token objects, ready for scanning.
 */
function flattenDataKoin(dataTokens) {
  if (!Array.isArray(dataTokens)) {
    try { dataTokens = JSON.parse(dataTokens || '[]'); } catch { dataTokens = []; }
  }
  let flatResult = [];
  let counter = 1;

  // Note: Do not apply any FILTER_* logic here.
  // This function only flattens tokens → one row per selected CEX.
  // Filtering by chain/cex/pair is handled by callers (per mode).
  dataTokens.forEach(item => {
    if (!item || item.status === false) return;
    (item.selectedCexs || []).forEach(cex => {
      const cexUpper = String(cex).toUpperCase();
      const cexInfo = item.dataCexs?.[cexUpper] || {};
      const dexArray = (item.selectedDexs || []).map(dex => ({
        dex: dex,
        left: item.dataDexs?.[dex]?.left || 0,
        right: item.dataDexs?.[dex]?.right || 0
      }));

      flatResult.push({
        no: counter++,
        id: item.id,
        cex: cexUpper,
        feeWDToken: parseFloat(cexInfo.feeWDToken) || 0,
        feeWDPair:  parseFloat(cexInfo.feeWDPair)  || 0,
        depositToken: !!cexInfo.depositToken,
        withdrawToken: !!cexInfo.withdrawToken,
        depositPair: !!cexInfo.depositPair,
        withdrawPair: !!cexInfo.withdrawPair,
        chain: item.chain,
        symbol_in: item.symbol_in,
        sc_in: item.sc_in,
        des_in: item.des_in,
        symbol_out: item.symbol_out,
        sc_out: item.sc_out,
        des_out: item.des_out,
        status: item.status,
        dexs: dexArray
      });
    });
  });

  return flatResult;
}

/**
 * Calculates the estimated swap fee in USD for a given chain.
 * @param {string} chainName - The name of the chain.
 * @returns {number} The estimated swap fee in USD.
 */
function getFeeSwap(chainName) {
    const allGasData = getFromLocalStorage("ALL_GAS_FEES");
    if (!allGasData) return 0;

    // cari data gas untuk chain yang sesuai
    const gasInfo = allGasData.find(g => g.chain.toLowerCase() === chainName.toLowerCase());
    if (!gasInfo) {
        console.error(`❌ Gas data not found for chain: ${chainName}`);
        return 0;
    }

    // ambil GASLIMIT dari CONFIG_CHAINS
    const chainConfig = CONFIG_CHAINS[chainName.toLowerCase()];
    if (!chainConfig) {
        console.error(`❌ Chain config not found for: ${chainName}`);
        return 0;
    }

    const gasLimit = parseFloat(chainConfig.GASLIMIT || 250000); // default kalau tidak ada
    const feeSwap = ((parseFloat(gasInfo.gwei) * gasLimit) / Math.pow(10, 9)) * parseFloat(gasInfo.tokenPrice);

    return feeSwap;
}

/**
 * Generates a direct trade link for a given DEX.
 * @param {string} dex - The DEX name.
 * @param {string} chainName - The chain name.
 * @param {number} codeChain - The chain ID.
 * @param {string} NameToken - The input token symbol.
 * @param {string} sc_input - The input token contract address.
 * @param {string} NamePair - The output token symbol.
 * @param {string} sc_output - The output token contract address.
 * @returns {string|null} The DEX trade URL or null if not supported.
 */
function getWarnaCEX(cex) {
    if (!cex || typeof cex !== 'string') {
        return 'black';
    }
    try {
        const upperCex = cex.toUpperCase();
        if (CONFIG_CEX && CONFIG_CEX[upperCex] && CONFIG_CEX[upperCex].WARNA) {
            return CONFIG_CEX[upperCex].WARNA;
        }
        return 'black'; // Warna default
    } catch (error) {
        console.error('Error dalam getWarnaCEX:', error);
        return 'black';
    }
}

function generateDexLink(dex, chainName, codeChain, NameToken, sc_input, NamePair, sc_output) {
    if (!dex) return null;

    const lowerDex = dex.toLowerCase();

    // Find the correct DEX configuration key by checking if the input 'dex' string includes it.
    // This handles cases like "kyberswap" and "kyberswap via LIFI".
    const dexKey = Object.keys(CONFIG_DEXS).find(key => lowerDex.includes(key));

    if (dexKey && CONFIG_DEXS[dexKey] && typeof CONFIG_DEXS[dexKey].builder === 'function') {
        const builder = CONFIG_DEXS[dexKey].builder;
        return builder({
            chainName: chainName,
            // Provide both to satisfy different builder signatures
            codeChain: codeChain,    // some builders expect codeChain
            chainCode: codeChain,    // others used chainCode
            tokenAddress: sc_input,
            pairAddress: sc_output,
            NameToken: NameToken,
            NamePair: NamePair
        });
    }

    return null; // Return null if no matching DEX config is found
}

function convertIDRtoUSDT(idrAmount) {
    const rateUSDT = getFromLocalStorage("PRICE_RATE_USDT", 0);
    if (!rateUSDT || rateUSDT === 0) return 0;
    return parseFloat((idrAmount / rateUSDT).toFixed(8));
}

// Convert USDT amount to IDR number using cached rate
function convertUSDTtoIDR(usdtAmount) {
    const rateUSDT = parseFloat(getFromLocalStorage("PRICE_RATE_USDT", 0)) || 0;
    const v = parseFloat(usdtAmount) || 0;
    return rateUSDT > 0 ? v * rateUSDT : 0;
}

// Format IDR currency string from USDT amount
function formatIDRfromUSDT(usdtAmount) {
    const idr = convertUSDTtoIDR(usdtAmount);
    return idr > 0 ? idr.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' }) : 'N/A';
}

/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// =============================================================
// UI GATING WHILE SCANNING
// Disable most interactions while scan is running; allow Reload + Theme
// =============================================================
function setScanUIGating(isRunning) {
    try {
        const $allToolbar = $('.header-card a, .header-card .icon');
        if (isRunning) {
            // Dim and disable all toolbar actions
            $allToolbar.css({ pointerEvents: 'none', opacity: 0.4 });
            // Allow only reload + dark mode toggle
            $('#reload, #darkModeToggle').css({ pointerEvents: 'auto', opacity: 1 });
            // Disable scanner config controls and filter card inputs
            $('#scanner-config').find('input, select, button, textarea').prop('disabled', true);
            $('#filter-card').find('input, select, button, textarea').prop('disabled', true);
            // Some extra clickable items in page
            $('.sort-toggle, .edit-token-button, #chain-links-container a').css({ pointerEvents: 'none', opacity: 0.4 });
            // Lock token management & edit modal during scan
            $('#token-management').find('input, select, button, textarea').prop('disabled', true).css({ pointerEvents: 'none', opacity: 0.6 });
            $('#FormEditKoinModal').find('input, select, button, textarea').prop('disabled', true).css({ pointerEvents: 'none', opacity: 0.6 });
            // Keep STOP button usable during running
            $('#stopSCAN').prop('disabled', false).show();
            // Keep RELOAD usable (already via toolbar allow-list), disable START explicitly
            $('#startSCAN').prop('disabled', true);
        } else {
            // Re-enable toolbar
            $allToolbar.css({ pointerEvents: '', opacity: '' });
            // Reset controls (actual availability will be enforced by applyControlsFor)
            $('#scanner-config').find('input, select, button, textarea').prop('disabled', false);
            $('#filter-card').find('input, select, button, textarea').prop('disabled', false);
            $('.sort-toggle, .edit-token-button, #chain-links-container a').css({ pointerEvents: '', opacity: '' });
            $('#token-management, #FormEditKoinModal').find('input, select, button, textarea').prop('disabled', false).css({ pointerEvents: '', opacity: '' });
        }
    } catch (_) { /* noop */ }
}

// Optional namespacing for future modular use
try {
    if (window.App && typeof window.App.register === 'function') {
        window.App.register('Utils', {
            getAppMode,
            getActiveTokenKey,
            getActiveFilterKey,
            getActiveTokens,
            saveActiveTokens,
            getActiveFilters,
            saveActiveFilters,
            getPNLFilter,
            setPNLFilter,
            getFilterMulti,
            setFilterMulti,
            getFilterChain,
            setFilterChain,
            getTokensMulti,
            setTokensMulti,
            getTokensChain,
            setTokensChain,
            getFeatureReadiness,
            applyThemeForMode,
            createHoverLink,
            safeUrl,
            linkifyStatus,
            getStatusLabel,
            hexToRgba,
            flattenDataKoin,
            getFeeSwap,
            getWarnaCEX,
            generateDexLink,
            convertIDRtoUSDT,
            debounce,
            setScanUIGating
        });
    }
} catch(_) {}
