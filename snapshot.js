(async function(){
    if (window.__IDB_LOCALSTORAGE_READY__) {
      try { await window.__IDB_LOCALSTORAGE_READY__; } catch(_){}
    }
    // Compact duplicates (one-time at load)
    try { compactSnapshot(); } catch(_){}
    // Use random proxy prefix from CONFIG_PROXY if available, otherwise fallback
    const getCORS = () => (window.CONFIG_PROXY && window.CONFIG_PROXY.PREFIX) || 'https://proxykanan.awokawok.workers.dev/?';
    const prox = (u) => `${getCORS()}${u}`;
    // Pacing to avoid rate limits (user-configurable)
    let RATE = { CEX_DELAY_MS: 150, WEB3_DELAY_MS: 150, PRICE_DELAY_MS: 60 };
    // Key registry (used for IndexedDB KV)
    const LS_KEYS = {
      RATE: 'SNAPSHOT_RATE',
      SNAPSHOT: 'SNAPSHOT_DATA_KOIN',
      SELECTED_CEX: 'SNAPSHOT_SELECTED_CEX',
      LEGACY_SELECTED_CEX: 'TOOL_SELECTED_CEX'
    };
    // IndexedDB lightweight KV wrapper with in-memory cache
    const root = (typeof window !== 'undefined') ? window : {};
    const appCfg = (root.CONFIG_APP && root.CONFIG_APP.APP) ? root.CONFIG_APP.APP : {};
    const dbCfg = root.CONFIG_DB || {};
    const IDB_NAME = dbCfg.NAME || appCfg.NAME || 'MULTIALL-PLUS';
    const IDB_STORE = (dbCfg.STORES && dbCfg.STORES.SNAPSHOT) ? dbCfg.STORES.SNAPSHOT : 'SNAPSHOT_STORE';
    let IDB_DB = null;
    const IDB_CACHE = {}; // { key -> value }
    let snapshotInitTriggered = false;
    let uiInitializing = null;
    function safeStringify(obj){ try { return JSON.stringify(obj, (k,v)=> (typeof v==='bigint')? String(v): v); } catch(_) { try{ return JSON.stringify(obj);}catch(__){return '{}';} } }
    function openIDB(){
      return new Promise((resolve, reject)=>{
        try{
          const req = indexedDB.open(IDB_NAME);
          req.onupgradeneeded = function(ev){
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath:'key' });
          };
          req.onsuccess = function(ev){
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)){
              const next = (db.version || 1) + 1;
              db.close();
              const up = indexedDB.open(IDB_NAME, next);
              up.onupgradeneeded = function(e2){
                const udb = e2.target.result;
                if (!udb.objectStoreNames.contains(IDB_STORE)) udb.createObjectStore(IDB_STORE, { keyPath:'key' });
              };
              up.onsuccess = function(e2){ IDB_DB = e2.target.result; resolve(IDB_DB); };
              up.onerror = function(e2){ reject(e2.target.error || new Error('IDB upgrade failed')); };
            } else {
              IDB_DB = db;
              resolve(IDB_DB);
            }
          };
          req.onerror = function(ev){ reject(ev.target.error || new Error('IDB open failed')); };
        }catch(e){ reject(e); }
      });
    }
    function idbGet(key){
      return new Promise(async (resolve)=>{
        try{
          if (!IDB_DB) await openIDB();
          const tx = IDB_DB.transaction([IDB_STORE], 'readonly');
          const st = tx.objectStore(IDB_STORE);
          const req = st.get(String(key));
          req.onsuccess = function(){ resolve(req.result ? req.result.val : undefined); };
          req.onerror = function(){ resolve(undefined); };
        }catch(_){ resolve(undefined); }
      });
    }
    function idbSet(key, val){
      return new Promise(async (resolve)=>{
        try{
          if (!IDB_DB) await openIDB();
          const tx = IDB_DB.transaction([IDB_STORE], 'readwrite');
          const st = tx.objectStore(IDB_STORE);
          st.put({ key: String(key), val });
          tx.oncomplete = function(){ resolve(true); };
          tx.onerror = function(){ resolve(false); };
        }catch(_){ resolve(false); }
      });
    }
    // Load known keys to cache (best-effort, non-blocking)
    (async function initIDBCache(){
      try{
        const keys = [LS_KEYS.RATE, LS_KEYS.SNAPSHOT, LS_KEYS.SELECTED_CEX];
        for (let i=0;i<keys.length;i++){
          const k = keys[i];
          const v = await idbGet(k);
          if (v !== undefined) { IDB_CACHE[k] = v; continue; }
          // simple migration from localStorage if exists
          try{
            const raw = localStorage.getItem(k);
            if (raw!=null) { const parsed = JSON.parse(raw); IDB_CACHE[k]=parsed; await idbSet(k, parsed); }
          }catch(_){ /* ignore */ }
        }
        try { initializeUI().catch(()=>{}); } catch(_){}
      }catch(_){ /* ignore init errors */ }
    })();
    initializeUI().catch(()=>{});
    // KV helpers reusing cache; non-throwing
    function trySave(key, val){ IDB_CACHE[key]=val; idbSet(key, val); return true; }
    function loadJSON(key, def){ const v = (IDB_CACHE.hasOwnProperty(key)? IDB_CACHE[key] : undefined); return (v===undefined)? (def||{}) : v; }
    // Rate
    const LS_RATE=LS_KEYS.RATE;
    function loadRate(){ return loadJSON(LS_RATE, {}); }
    function saveRate(obj){ trySave(LS_RATE, obj||{}); }

    const ROOT = (function(){
      try {
        if (window.parent && window.parent.CONFIG_CHAINS) return window.parent;
      } catch(_) {}
      return window;
    })();

    // Central config to simplify adding new CEX/Chains
    const DEBUG = false;

    const CEX_CONFIG = (ROOT.CONFIG_CEX && typeof ROOT.CONFIG_CEX === 'object') ? ROOT.CONFIG_CEX : {};

    const CHAIN_CONFIG = (ROOT.CONFIG_CHAINS && typeof ROOT.CONFIG_CHAINS === 'object') ? ROOT.CONFIG_CHAINS : {};
    const CEX_API = (ROOT.CEX_SECRETS && typeof ROOT.CEX_SECRETS === 'object') ? ROOT.CEX_SECRETS : {};

    const PRICE_SUPPORTED_CEX = new Set(['BINANCE','MEXC','GATE','KUCOIN','OKX','BITGET','BYBIT','INDODAX']);

    const SNAPSHOT_LAST_CHAIN = 'SNAPSHOT_LAST_CHAIN';
    function getSnapshotMode(){
      try {
        if (typeof getAppMode === 'function') return getAppMode();
      } catch(_) {}
      return { type: 'multi' };
    }

    function getChainConfig(chainKey){
      const keyStr = String(chainKey || '');
      if (!keyStr) return {};
      if (Object.prototype.hasOwnProperty.call(CHAIN_CONFIG, keyStr)) {
        return CHAIN_CONFIG[keyStr] || {};
      }
      const lower = keyStr.toLowerCase();
      const foundKey = Object.keys(CHAIN_CONFIG || {}).find(k => String(k).toLowerCase() === lower);
      return foundKey ? (CHAIN_CONFIG[foundKey] || {}) : {};
    }
    function getChainLabel(chainKey){
      const cfg = getChainConfig(chainKey);
      return (cfg.Nama_Pendek || cfg.Nama_Chain || chainKey || '').toString().toUpperCase();
    }
    function getChainKeys(){ return Object.keys(CHAIN_CONFIG || {}); }
    function getChainRpc(chainKey){
      const cfg = getChainConfig(chainKey);
      return cfg.RPC || '';
    }
    function getChainDataUrl(chainKey){
      const cfg = getChainConfig(chainKey);
      return cfg.DATAJSON || '';
    }
    function getCexColor(cex){
      const keyUp = String(cex || '').toUpperCase();
      const cfg = CEX_CONFIG[keyUp] || {};
      return (cfg && cfg.WARNA) || '#333';
    }

    const $cex = $('#snapshot-cex-list');
    const $chain = $('#snapshot-chain');
    const $tbody = $('#snapshot-tbody');
    const $status = $('#snapshot-status');
    const $btnFetch = $('#snapshot-btn-fetch');
    const $btnExport = $('#snapshot-btn-export');
    const $rateCex = $('#snapshot-rate-cex');
    const $rateWeb3 = $('#snapshot-rate-web3');
    const $ratePrice = $('#snapshot-rate-price');
    const $tableSearch = $('#snapshot-search');
    const $chainSelectWrap = $('#snapshot-chain-select-wrap');
    const $chainLabel = $('#snapshot-chain-label');

    // localStorage keys (prefixed) — use earlier LS_KEYS helpers
    const LS_SNAPSHOT = LS_KEYS.SNAPSHOT;
    function loadSelectedCex(){
      try{
        let arr = IDB_CACHE[LS_KEYS.SELECTED_CEX];
        if (!Array.isArray(arr) || !arr.length){
          // legacy migrate from localStorage
          try { arr = JSON.parse(localStorage.getItem(LS_KEYS.SELECTED_CEX)||'[]'); } catch(_) { arr = []; }
          if (!Array.isArray(arr) || !arr.length){ try { arr = JSON.parse(localStorage.getItem(LS_KEYS.LEGACY_SELECTED_CEX)||'[]'); } catch(_) { arr = []; } }
          if (Array.isArray(arr) && arr.length) trySave(LS_KEYS.SELECTED_CEX, arr);
        }
        return Array.isArray(arr)? arr.map(v => String(v).toUpperCase()) : [];
      }catch(_){ return []; }
    }
    function loadSnapshot(){ try{ const v = IDB_CACHE[LS_SNAPSHOT]; return (v && typeof v==='object')? v : {}; }catch(_){ return {}; } }
    function saveSnapshot(obj){ trySave(LS_SNAPSHOT, obj); }
    // Upsert to prevent duplicates per (cex, sc)
    function upsertSnapshot(chain, rec){
      const snap = loadSnapshot();
      const list = Array.isArray(snap[chain]) ? snap[chain] : [];
      const scLow = String(rec.sc||'').toLowerCase();
      const cexUp = String(rec.cex||'').toUpperCase();
      let updated = false;
      for (let i=0;i<list.length;i++){
        const it = list[i]||{};
        if (String(it.cex||'').toUpperCase() === cexUp && String(it.sc||'').toLowerCase() === scLow){
          // Smart merge: Jangan timpa 'des'/'decimals' jika nilai baru tidak valid
          const existingDecimals = it.des ?? it.decimals;
          const newDecimals = rec.des ?? rec.decimals;

          const merged = { ...it, ...rec };
          
          // Jika nilai desimal baru tidak ada (kosong, null, undefined), pertahankan nilai lama.
          if (newDecimals === '' || newDecimals == null) {
            merged.des = existingDecimals;
          } else {
            merged.des = (typeof newDecimals === 'bigint') ? String(newDecimals) : newDecimals;
          }
          list[i] = merged;
          updated = true; break;
        }
      }
      if (!updated) list.push({ ...rec, des: (typeof rec.des==='bigint')? String(rec.des): rec.des });
      snap[chain] = list; saveSnapshot(snap);
    }
    // One-time compaction to fix old duplicates
    function compactSnapshot(){
      const snap = loadSnapshot();
      const out = {};
      Object.keys(snap||{}).forEach(chain => {
        const seen = new Map();
        (Array.isArray(snap[chain])? snap[chain]: []).forEach(it => {
          const key = `${String(it.cex||'').toUpperCase()}|${String(it.sc||'').toLowerCase()}`;
          seen.set(key, it); // last write wins
        });
        out[chain] = Array.from(seen.values());
      });
      saveSnapshot(out);
    }
    // Import snapshot seed helper
    const SNAPSHOT_SEED_URL = 'https://multiscanner.vercel.app/datajson.json';
    let uiInitialized = false;

    function setChainLabelDisplay(chainKey){
      if (!$chainLabel || !$chainLabel.length) return;
      const label = getChainLabel(chainKey) || String(chainKey || '').toUpperCase();
      $chainLabel.text(label || '-');
    }

    function getSelectedChainKey(){
      const mode = getSnapshotMode();
      if (mode && String(mode.type || '').toLowerCase() === 'single' && mode.chain) {
        return String(mode.chain).toLowerCase();
      }
      const val = String($chain.val() || '').toLowerCase();
      if (val) return val;
      const keys = getChainKeys();
      return keys.length ? String(keys[0]).toLowerCase() : '';
    }

    function syncChainControls(){
      const keys = getChainKeys();
      const mode = getSnapshotMode();
      const multiMode = !mode || String(mode.type || '').toLowerCase() !== 'single';
      const select = $chain;
      let resolved = '';
      if (!keys.length) {
        select.empty();
      if ($chainSelectWrap && $chainSelectWrap.length) $chainSelectWrap.hide();
      setChainLabelDisplay(resolved);
      return resolved;
    }
    if (multiMode) {
        if ($chainSelectWrap && $chainSelectWrap.length) $chainSelectWrap.show();
        const opts = keys.slice().sort((a,b)=> getChainLabel(a).localeCompare(getChainLabel(b)));
        select.empty();
        opts.forEach(key => {
          const value = String(key).toLowerCase();
          select.append(`<option value="${value}">${getChainLabel(key)}</option>`);
        });
        let stored = null;
        try { stored = localStorage.getItem(SNAPSHOT_LAST_CHAIN); } catch(_){ }
        if (!stored || !getChainConfig(stored)) {
          stored = String(opts[0] || '').toLowerCase();
        }
        select.val(stored);
        resolved = String(select.val() || stored || '').toLowerCase();
        try { localStorage.setItem(SNAPSHOT_LAST_CHAIN, resolved); } catch(_){ }
      } else {
        const key = String(mode.chain || keys[0]).toLowerCase();
        resolved = key;
        select.empty();
        select.append(`<option value="${key}">${getChainLabel(key)}</option>`);
        select.val(key);
        if ($chainSelectWrap && $chainSelectWrap.length) $chainSelectWrap.hide();
      }
      setChainLabelDisplay(resolved);
      return resolved;
    }

    async function ensureChainSnapshot(chainKey, options = {}) {
      const { silent = false, force = false } = options;
      const key = String(chainKey || '').toLowerCase();
      if (!key) return 0;
      const snap = loadSnapshot();
      const existing = Array.isArray(snap[key]) ? snap[key] : [];
      if (!force && existing.length) return existing.length;
      
      // Prioritaskan URL spesifik chain dari config.js
      const dataUrl = getChainDataUrl(key);

      if (!dataUrl || !/^https?:\/\//i.test(dataUrl)) return 0;
      const overlayVisible = $('#snapshot-overlay').is(':visible');
      if (!silent && !overlayVisible) {
        showOverlay(`Mengambil snapshot awal (${getChainLabel(key)})...`);
        setOverlayPhase('Download', 1);
        updateOverlayProgress(0);
      }
      try {
        const data = await fetchJsonWithFallback(dataUrl);
        if (!silent && !overlayVisible) {
          showOverlay('Menyimpan ke Database...');
          setOverlayPhase('Import', 1);
        }
        const imported = await applySeedObject(data, key);
        if (!silent) {
          try { UIkit.notification(`✅ Snapshot ${getChainLabel(key)} diperbarui (${imported || 0} item)`, { status: 'success' }); } catch(_) {}
        }
        return imported;
      } catch (e) {
        console.error('ensureChainSnapshot error:', e);
        if (!silent) {
          try { UIkit.notification(`❌ Snapshot ${getChainLabel(key)} gagal: ${e.message || e}`, { status: 'danger' }); } catch(_) {}
        }
        return 0;
      } finally {
        if (!overlayVisible) hideOverlay();
      }
    }

    async function renderLocalSnapshot(chainKey, options = {}) {
      const { fetchPrices = false, silent = false } = options;
      const key = String(chainKey || '').toLowerCase();
      if (!key) {
        $tbody.empty();
        setStatus('Pilih chain.');
        $btnFetch.prop('disabled', true); // Disable fetch button if no chain
        return;
      }
      setChainLabelDisplay(key);
      const snap = loadSnapshot();
      const list = Array.isArray(snap[key]) ? snap[key] : [];
      const selectedCexInitial = $('.cex-check:checked').map(function(){return String(this.value).toUpperCase();}).get();
      const filtered = selectedCexInitial.length
        ? list.filter(it => selectedCexInitial.includes(String(it.cex||'').toUpperCase()))
        : list;
      let rows = filtered.map(it => {
        // ... (kode yang ada tetap sama)
        const rawTrade = (typeof it.trade === 'string') ? it.trade.trim().toUpperCase() : '';
        const tradeableRaw = it.tradeable;
        let tradeableFlag;
        if (typeof tradeableRaw === 'boolean') {
          tradeableFlag = tradeableRaw;
        } else if (typeof tradeableRaw === 'string') {
          const lower = tradeableRaw.trim().toLowerCase();
          if (lower === 'true') tradeableFlag = true;
          else if (lower === 'false') tradeableFlag = false;
        }
        const tradeFromFlag = (tradeableFlag !== undefined) ? (tradeableFlag ? 'ON' : 'OFF') : '';
        const finalTrade = rawTrade || tradeFromFlag || 'OFF';
        const finalTradeable = (tradeableFlag !== undefined) ? tradeableFlag : false;
        return {
          cex: String(it.cex || '-').toUpperCase(),
          chain: it.chain || key,
          token: String(it.name || it.token || '').trim(),
          symbol: String(it.ticker || it.koin || it.symbol || '').toUpperCase(),
          sc: it.sc || '',
          decimals: it.des ?? it.decimals ?? '',
          feeWD: it.feeWD,
          deposit: it.deposit,
          withdraw: it.withdraw,
          trade: finalTrade,
          price: 0,
          tradeable: finalTradeable
        };
      });

      renderRows(rows, key);
      setStatus(rows.length ? `${rows.length} tokens (Snapshot)` : 'Tidak ada data snapshot.');
      try { renderSummary(rows); } catch(_){}
      $btnFetch.prop('disabled', !rows.length); // Enable/disable based on data
      setupExport(rows, `snapshot_${String(key).toUpperCase()}`);

      if (!fetchPrices || !rows.length) return;

      if (!silent) {
        showOverlay('Loading from Database...');
        setOverlayPhase('Bulk Prices', rows.length);
        updateOverlayProgress(0);
      }

     let selectedCex = $('.cex-check:checked').map(function(){return String(this.value).toUpperCase();}).get();
      selectedCex = selectedCex.filter(cx => PRICE_SUPPORTED_CEX.has(cx));
      if (!selectedCex.length) {
        const set = new Set();
        rows.forEach(r => {
          const cx = String(r.cex || '').toUpperCase();
          if (cx && PRICE_SUPPORTED_CEX.has(cx)) set.add(cx);
        });
        selectedCex = Array.from(set.values());
      }
      if (!selectedCex.length) {
        UIkit.notification('Tidak ada CEX untuk diambil harganya', { status:'warning' });
        if (!silent) hideOverlay();
        return;
      }

      if (!silent) {
        setOverlayPhase('Bulk Prices', selectedCex.length);
        updateOverlayProgress(0);
      }
      try {
        const getPrice = await fetchBulkPrices(selectedCex, rows, (idx, cex, err)=>{
          if (err) UIkit.notification({message:`PRICE_BULK gagal [${cex}]: ${err}`, status:'warning'});
          if (!silent) updateOverlayProgress(idx);
        });
        rows = rows.map(r => {
          const price = getPrice(r.cex, r.symbol);
          const tradeStatus = (r.tradeable !== undefined)
            ? (r.tradeable ? 'ON' : 'OFF')
            : (price != null ? 'ON' : 'OFF');
          const tradeableValue = (r.tradeable !== undefined) ? r.tradeable : (price != null);
          return Object.assign({}, r, {
            price,
            trade: tradeStatus,
            tradeable: tradeableValue
          });
        });
        if (!silent) showOverlay('Rendering results...');
        renderRows(rows, key);
        setStatus(`${rows.length} tokens (DB + Price)`);
        try { renderSummary(rows); } catch(_){}
        setupExport(rows, `local_${String(key).toUpperCase()}`);
      } catch (e) {
        UIkit.notification({message:`Bulk price gagal: ${e.message||e}`, status:'warning'});
      } finally {
        if (!silent) hideOverlay();
      }
    }

    async function loadChainData(initial = false, chainOverride = ''){
      const chainKey = chainOverride || String($chain.val() || '').toLowerCase();
      if (!chainKey) return;
      try { localStorage.setItem(SNAPSHOT_LAST_CHAIN, chainKey); } catch(_){}
      $btnFetch.prop('disabled', true); // Disable while loading
      // Pastikan ada data snapshot, jika tidak ada, fetch dari seed JSON.
      // Fungsi ini sekarang hanya memastikan data untuk chain spesifik ada,
      // setelah ensureFullSnapshot() kemungkinan sudah mengisi semuanya.
      await ensureChainSnapshot(chainKey, { silent: initial });
      buildCexChips();
      await renderLocalSnapshot(chainKey, { fetchPrices: false, silent: true }); // Always silent on data render
    }

    async function initializeUI(force = false){
      if (!force && !snapshotInitTriggered) return false;
      if (uiInitialized) return false;
      if (uiInitializing) return uiInitializing;
      snapshotInitTriggered = true;
      const initialChain = syncChainControls();
      uiInitializing = (async () => {
        await loadChainData(true, initialChain); // Pass initialChain to ensure correct first load
        uiInitialized = true;
        const done = true;
        uiInitializing = null;
        return done;
      })();
      return uiInitializing;
    }

    async function fetchJsonWithFallback(url){
      // Try direct fetch first
      try {
        const r = await fetch(url, { credentials:'omit' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        // Fallback via proxy if available
        try {
          const r2 = await $.ajax({ url: prox(url), method:'GET', dataType:'json' });
          return r2;
        } catch (e2) {
          throw e2 || e;
        }
      }
    }
    function normalizeRecord(it, chainFallback){
      // Cek format baru (symbol_in, sc_in, des_in)
      if (it.symbol_in && it.sc_in) {
        const chain = String(it.chain || chainFallback || '').trim().toLowerCase();
        const ticker = String(it.symbol_in || '').toUpperCase();
        const name = String(it.name || ticker).trim(); // Gunakan nama jika ada, jika tidak, gunakan ticker
        const sc = String(it.sc_in || '').trim();
        const des = it.des_in ?? '';
        const cex = String(it.cex || '-').toUpperCase();
        return { chain, name, ticker, sc, des, cex };
      }
      
      // Fallback ke format lama
      else {
        const chain = String(it.chain || chainFallback || '').trim().toLowerCase();
        const name = String(it.name ?? it.token ?? '').trim();
        const ticker = String((it.ticker ?? it.symbol ?? it.koin ?? '')||'').toUpperCase();
        const sc = String(it.sc ?? it.contract ?? it.address ?? '').trim();
        const des = (it.des ?? it.decimals ?? '');
        const cex = String((it.cex ?? it.exchange ?? '-')||'').toUpperCase();
        return { chain, name, ticker, sc, des, cex };
      }
    }
    async function applySeedObject(obj, onlyChainKey){
      if (!obj || typeof obj !== 'object') throw new Error('Format JSON tidak valid');
      // If wrapped like { SNAPSHOT_DATA_KOIN: {...} }
      const root = (obj && obj.SNAPSHOT_DATA_KOIN) ? obj.SNAPSHOT_DATA_KOIN : obj;
      const knownChains = getChainKeys().map(k => String(k).toLowerCase());
      const bag = {}; // chainKey -> array of normalized records
      const lcOnly = onlyChainKey ? String(onlyChainKey).toLowerCase() : '';
      const pushRec = (rec) => {
        if (!rec) return;
        if (!rec.sc) return;
        if (lcOnly && String(rec.chain||'').toLowerCase() !== lcOnly) return;
        const ck = String(rec.chain||'').trim().toLowerCase();
        if (!ck) return;
        if (!bag[ck]) bag[ck] = [];
        bag[ck].push({ ...rec, chain: ck });
      };

      // If array provided at root
      if (Array.isArray(root)){
        // Perbaikan: Gunakan 'onlyChainKey' sebagai fallback jika 'it.chain' tidak ada.
        // Ini penting untuk format JSON baru yang berupa array.
        root.forEach(it => { 
          const rec = normalizeRecord(it, it.chain || onlyChainKey); pushRec(rec); 
        });
      } else {
        // Object keyed by chain
        Object.keys(root||{}).forEach(chainKey => {
          const arr = Array.isArray(root[chainKey]) ? root[chainKey] : [];
          const chainKeyLc = String(chainKey).toLowerCase();
          const isKnown = knownChains.includes(chainKeyLc);
          if (isKnown) {
            if (lcOnly && chainKeyLc !== lcOnly) return; // skip other chains fast
            arr.forEach(it => { const rec = normalizeRecord(it, chainKeyLc); pushRec(rec); });
          } else if (Array.isArray(root[chainKey])) {
            // Unknown key but array: try to infer chain from each item
            arr.forEach(it => { const rec = normalizeRecord(it, it.chain); pushRec(rec); });
          }
        });
      }

      // Nothing to import
      const chainsToImport = Object.keys(bag);
      if (!chainsToImport.length) return 0;

      // Prepare progress
      let total = 0; chainsToImport.forEach(k => { total += (bag[k]||[]).length; });
      try { setOverlayPhase('Import', total); } catch(_){ }

      // Load snapshot once and merge in-memory
      const snap = loadSnapshot();
      let processed = 0;
      const YIELD_EVERY = 500; // yield to UI every N items

      for (let c=0; c<chainsToImport.length; c++){
        const chainKey = chainsToImport[c];
        const existing = Array.isArray(snap[chainKey]) ? snap[chainKey] : [];
        const map = new Map(); // key: CEX|scLower -> record
        // Seed existing (compacting duplicates)
        for (let i=0;i<existing.length;i++){
          const it = existing[i]||{};
          const scLow = String(it.sc||'').toLowerCase();
          if (!scLow) continue;
          const cexUp = String(it.cex||'').toUpperCase();
          const rec = { ...it };
          if (typeof rec.des==='bigint') rec.des = String(rec.des);
          map.set(`${cexUp}|${scLow}`, rec);
        }
        const addArr = bag[chainKey] || [];
        for (let i=0;i<addArr.length;i++){
          const r = addArr[i]||{};
          const scLow = String(r.sc||'').toLowerCase();
          if (!scLow) { processed++; continue; }
          const cexUp = String(r.cex||'').toUpperCase();
          const key = `${cexUp}|${scLow}`;
          const prev = map.get(key) || {};
          const merged = { ...prev, ...r };
          if (typeof merged.des==='bigint') merged.des = String(merged.des);
          map.set(key, merged);
          processed++;
          if (processed % YIELD_EVERY === 0){
            try { updateOverlayProgress(processed); } catch(_){ }
            await new Promise(r=>setTimeout(r,0));
          }
        }
        snap[chainKey] = Array.from(map.values());
      }
      try { updateOverlayProgress(total); } catch(_){ }
      saveSnapshot(snap);
      return total;
    }

    // Summary badges and search
    function computeCounts(rows){
      const counts = {};
      (rows||[]).forEach(r => { const k = String(r.cex||'-').toUpperCase(); counts[k] = (counts[k]||0)+1; });
      return counts;
    }
    function renderBadges(counts){
      const keys = Object.keys(counts||{});
      if (!keys.length) { $('#snapshot-summary').html('<span class="uk-text-meta">No data</span>'); return; }
      let html='';
      keys.sort().forEach(cx => {
        const color = getCexColor(cx);
        html += `<span class=\"uk-badge\" style=\"background:${color};\">${cx}: ${counts[cx]}</span>`;
      });
      $('#snapshot-summary').html(html);
    }
    function renderSummary(rows){ renderBadges(computeCounts(rows)); }
    function buildSavedTokenSet(chainKey){
      const set = new Set();
      try {
        const chainLower = String(chainKey || '').toLowerCase();
        const appendTokens = (list) => {
          (list || []).forEach(tok => {
            if (!tok) return;
            const sym = String(tok.symbol_in || tok.symbol || '').toUpperCase();
            if (!sym) return;
            const chainTok = String(tok.chain || '').toLowerCase();
            if (chainLower && chainTok && chainTok !== chainLower) return;
            const cexListRaw = Array.isArray(tok.selectedCexs) && tok.selectedCexs.length ? tok.selectedCexs : [tok.cex];
            (cexListRaw || []).forEach(cx => {
              if (!cx) return;
              const key = `${String(cx).toUpperCase()}__${sym}`;
              set.add(key);
            });
          });
        };
        if (typeof getTokensChain === 'function') {
          appendTokens(getTokensChain(chainKey));
        }
        if (typeof getTokensMulti === 'function') {
          appendTokens((getTokensMulti() || []).filter(t => String(t.chain || '').toLowerCase() === chainLower));
        }
      } catch(_) {}
      return set;
    }
    function formatScDisplay(scRaw){
      const sc = String(scRaw || '');
      if (!sc) return '-';
      if (sc.length <= 12) return sc;
      return `${sc.slice(0, 6)}...${sc.slice(-4)}`;
    }
    function renderRows(rows, chainKey){
      $tbody.empty();
      const savedSet = buildSavedTokenSet(chainKey);
      (rows||[]).forEach((r,idx)=>{
        const parsedPrice = Number(r.price);
        const hasPrice = r.price !== null && r.price !== undefined && r.price !== '' && Number.isFinite(parsedPrice);
        const price = hasPrice ? (parsedPrice === 0 ? '0' : parsedPrice.toFixed(6)) : '-';
        let tradeHtml;
        if (r.trade === 'ON') {
          tradeHtml = '<span class="uk-text-success">ON</span>';
        } else if (r.trade === 'OFF') {
          tradeHtml = '<span class="uk-text-danger">OFF</span>';
        } else {
          tradeHtml = r.trade || '-';
        }
        const symUpper = String(r.symbol||'').toUpperCase();
        const cexUpper = String(r.cex||'').toUpperCase();
        const savedKey = `${cexUpper}__${symUpper}`;
        const statusHtml = savedSet.has(savedKey)
          ? '<span class="uk-text-success uk-text-bold">Sudah Dipilih</span>'
          : '<span class="uk-text-muted">-</span>';
        const scRaw = String(r.sc || '');
        const scDisplay = formatScDisplay(scRaw);
        $tbody.append(`<tr>
          <td>${idx+1}</td>
          <td>${cexUpper || '-'}</td>
          <td>${r.token||''}</td>
          <td class="mono">${symUpper}</td>
          <td>${statusHtml}</td>
          <td class="mono" title="${scRaw}">${scDisplay}</td>
          <td>${r.decimals||''}</td>
          <td>${tradeHtml}</td>
          <td>${price}</td>
        </tr>`);
      });
      renderSummary(rows||[]);
    }
    function setupExport(rows, suffix){
      $btnExport.prop('disabled', !(rows&&rows.length));
      $btnExport.off('click').on('click', function(){
        const header = 'no,cex,chain,nama_token,ticker,sc,decimals,feeWD,trade,deposit,withdraw,price\n';
        const body = (rows||[]).map((r,i)=> {
          const fee = Number(r.feeWD);
          const hasFee = r.feeWD !== null && r.feeWD !== undefined && r.feeWD !== '' && Number.isFinite(fee);
          const priceNum = Number(r.price);
          const hasPrice = r.price !== null && r.price !== undefined && r.price !== '' && Number.isFinite(priceNum);
          return [
            i+1,
            r.cex||'',
            r.chain||'',
            (r.token||''),
            (r.symbol||'').toUpperCase(),
            r.sc||'',
            r.decimals||'',
            hasFee ? fee : (r.feeWD||''),
            r.trade||'',
            r.deposit,
            r.withdraw,
            hasPrice ? priceNum : ''
          ].join(',');
        }).join('\n');
        const blob = new Blob([header+body], {type:'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href=url; a.download=`SNAPSHOT_koin_${suffix||'data'}.csv`; a.click(); URL.revokeObjectURL(url);
      });
    }
    function updateSummaryFromVisible(){
      const counts = {};
      $('#snapshot-tbody tr:visible').each(function(){ const cx = ($(this).find('td').eq(1).text()||'-').toUpperCase(); counts[cx] = (counts[cx]||0)+1; });
      renderBadges(counts);
    }
    $tableSearch.on('input', function(){
      const q = String($(this).val()||'').toLowerCase();
      if (!q) { $('#snapshot-tbody tr').show(); updateSummaryFromVisible(); return; }
      $('#snapshot-tbody tr').each(function(){ const t = ($(this).text()||'').toLowerCase(); $(this).toggle(t.indexOf(q)!==-1); });
      updateSummaryFromVisible();
    });

    // Build CEX chips (single row) with saved-count badges per selected chain
    function getSavedCounts(chainKey){
      const snap = loadSnapshot();
      const key = String(chainKey || '').toLowerCase();
      const arr = Array.isArray(snap[key]) ? snap[key] : [];
      const map = new Map(); // cex -> Set of sc
      (arr||[]).forEach(it=>{
        const cx = String(it.cex||'-').toUpperCase();
        const sc = String(it.sc||'').toLowerCase();
        if (!map.has(cx)) map.set(cx, new Set());
        if (sc) map.get(cx).add(sc);
      });
      const c = {};
      map.forEach((set, cx) => { c[cx] = set.size; });
      return c;
    }
    function buildCexChips(){
      const selected = new Set(loadSelectedCex().map(v => String(v).toUpperCase()));
      const keys = Object.keys(CEX_CONFIG || {}).sort();
      const counts = getSavedCounts(getSelectedChainKey());
      let html = ``;
      keys.forEach(k => {
        const color = getCexColor(k);
        const checked = selected.has(k) ? 'checked' : '';
        const n = counts[String(k).toUpperCase()] || 0;
        html += `<label class=\"uk-margin-small-right\"><input type=\"checkbox\" class=\"uk-checkbox cex-check\" value=\"${k}\" ${checked}> <span class=\"name\" style=\"color:${color};\">${k}</span> <span class=\"uk-badge\" style=\"background:${color};\">${n}</span></label>`;
      });
      $cex.html(html);
    }
    // Initialize rate inputs from localStorage
    try {
      const r = loadRate();
      RATE = {
        CEX_DELAY_MS: Number(r.CEX_DELAY_MS ?? RATE.CEX_DELAY_MS),
        WEB3_DELAY_MS: Number(r.WEB3_DELAY_MS ?? RATE.WEB3_DELAY_MS),
        PRICE_DELAY_MS: Number(r.PRICE_DELAY_MS ?? RATE.PRICE_DELAY_MS),
      };
      $rateCex.val(RATE.CEX_DELAY_MS);
      $rateWeb3.val(RATE.WEB3_DELAY_MS);
      $ratePrice.val(RATE.PRICE_DELAY_MS);
    } catch(_) {}
    // Bind changes to persist and apply immediately
    $('#snapshot-rate-cex, #snapshot-rate-web3, #snapshot-rate-price').on('change', function(){
      const vC = Math.max(0, parseInt($rateCex.val(),10)||0);
      const vW = Math.max(0, parseInt($rateWeb3.val(),10)||0);
      const vP = Math.max(0, parseInt($ratePrice.val(),10)||0);
      RATE = { CEX_DELAY_MS: vC, WEB3_DELAY_MS: vW, PRICE_DELAY_MS: vP };
      saveRate(RATE);
      try { UIkit.notification('Delay updated', {status:'success'}); } catch(_){ }
    });
    $chain.on('change', () => { const key = getSelectedChainKey(); setChainLabelDisplay(key); loadChainData(false); });
    $cex.on('change', '.cex-check', function(){
      const selected = $('.cex-check:checked').map(function(){ return String(this.value).toUpperCase(); }).get();
      trySave(LS_KEYS.SELECTED_CEX, selected);
      renderLocalSnapshot(String($chain.val() || '').toLowerCase(), { fetchPrices: false, silent: true }).catch(()=>{});
    });

    function setStatus(msg){ $status.text(msg||''); }
    function showOverlay(msg){ try{$('#snapshot-overlay .msg').text(msg||'Processing...'); $('#snapshot-overlay').show();}catch(_){} }
    function setOverlayPhase(name, total){
      try{
        $('#snapshot-overlay .phase').text(String(name||'').toUpperCase());
        const $p = $('#snapshot-ov-progress'); $p.attr('max', Math.max(1, total||1)).val(0);
        $('#snapshot-overlay .counter').text(`0 / ${total||0} (0%)`);
      }catch(_){ }
    }
    function updateOverlayProgress(done){
      try{
        const $p = $('#snapshot-ov-progress');
        const max = parseInt($p.attr('max'),10)||1; const val = Math.min(max, Math.max(0, done||0));
        $p.val(val);
        const pct = Math.floor((val/max)*100);
        $('#snapshot-overlay .counter').text(`${val} / ${max} (${isFinite(pct)?pct:0}%)`);
      }catch(_){ }
    }
    function hideOverlay(){ try{$('#snapshot-overlay').hide();}catch(_){} }

    // Helpers: alias matching for networks per chain (regex per chain)
    function defaultAliases(chainKey){
      const base = { ethereum:['ETH','ERC20','ETHEREUM'], bsc:['BSC','BEP20','BINANCE SMART CHAIN'], polygon:['MATIC','POLYGON'], base:['BASE'], arbitrum:['ARBITRUM','ARB','ARBETH','ARBITRUM ONE'] };
      return base[chainKey]||[];
    }
    function chainAliases(chainKey){
      const ext = {
        ethereum: ['ETH','ERC20','ETHEREUM'],
        bsc: ['BSC','BEP20','BINANCE SMART CHAIN','BNB SMART CHAIN','BEP-20'],
        polygon: ['POLYGON','MATIC','POLYGON POS','POLYGON (MATIC)','POL'],
        arbitrum: ['ARBITRUM','ARB','ARBITRUM ONE','ARBEVM','ARBITRUMONE','ARB-ETH'],
        base: ['BASE']
      };
      const d = defaultAliases(chainKey);
      const e = ext[chainKey] || [];
      const set = new Set([...(d||[]), ...(e||[])]);
      return Array.from(set);
    }
    function escapeRegex(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function chainRegex(chainKey){
      const aliases = chainAliases(chainKey);
      if (!aliases.length) return null;
      const alt = aliases.map(escapeRegex).join('|');
      return new RegExp(alt, 'i');
    }
    function matches(chainKey, net){
      const rx = chainRegex(chainKey);
      return rx ? rx.test(String(net||'')) : true;
    }
    function matchesCex(chainKey, net, cex){
      // cex parameter ignored; chain-level regex only
      return matches(chainKey, net);
    }

    // Gate SIGN helper (v4): method + "\n" + path + "\n" + query + "\n" + sha512(body) + "\n" + timestamp
    function sha512Hex(str){ return CryptoJS.SHA512(str).toString(CryptoJS.enc.Hex); }
    function gateSign({ method, path, query = '', body = '', ts, secret }){
      const pre = [
        String(method||'GET').toUpperCase(),
        path,
        query,
        sha512Hex(body||''),
        String(ts)
      ].join('\n');
      return CryptoJS.HmacSHA512(pre, secret).toString(CryptoJS.enc.Hex);
    }

    // Bybit V5 sign helper: preSign = `${ts}${apiKey}${recvWindow}${queryString}`
    function bybitSignV5({ ts, apiKey, recvWindow, queryString = '', secret }){
      const pre = `${ts}${apiKey}${recvWindow}${queryString}`;
      return CryptoJS.HmacSHA256(pre, secret).toString(CryptoJS.enc.Hex);
    }

    // Read API keys from embedded const
    function getKeys(){ return CEX_API; }

    let indodaxUsdtRateCache = { ts: 0, rate: null };

    async function getIndodaxUsdtRate() {
      const now = Date.now();
      if (indodaxUsdtRateCache.rate && (now - indodaxUsdtRateCache.ts) < 60000) {
        return indodaxUsdtRateCache.rate;
      }
      try {
        const res = await $.ajax({ url: prox('https://indodax.com/api/ticker/usdtidr'), dataType: 'json' });
        const rate = parseFloat(res?.ticker?.last);
        if (Number.isFinite(rate) && rate > 0) {
          indodaxUsdtRateCache = { rate, ts: now };
          return rate;
        }
      } catch (_){}
      indodaxUsdtRateCache = { ts: now, rate: null };
      return null;
    }

    async function fetchPriceForSymbol(cex, symbol) {
      const upperCex = String(cex || '').toUpperCase();
      const sym = String(symbol || '').toUpperCase();
      if (!upperCex || !sym) return null;

      try {
        switch (upperCex) {
          case 'BINANCE': {
            const url = `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(sym + 'USDT')}`;
            const res = await $.ajax({ url, dataType: 'json' });
            const price = parseFloat(res?.price);
            return Number.isFinite(price) ? price : null;
          }
          case 'MEXC': {
            const url = prox(`https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym + 'USDT')}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const price = parseFloat(res?.price);
            return Number.isFinite(price) ? price : null;
          }
          case 'GATE': {
            const pair = `${sym}_USDT`;
            const url = prox(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const data = Array.isArray(res) ? res[0] : res;
            const price = parseFloat(data?.last);
            return Number.isFinite(price) ? price : null;
          }
          case 'KUCOIN': {
            const url = prox(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${encodeURIComponent(sym + '-USDT')}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const price = parseFloat(res?.data?.price);
            return Number.isFinite(price) ? price : null;
          }
          case 'OKX': {
            const url = prox(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(sym + '-USDT')}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const data = Array.isArray(res?.data) ? res.data[0] : undefined;
            const price = parseFloat(data?.last);
            return Number.isFinite(price) ? price : null;
          }
          case 'BITGET': {
            const url = prox(`https://api.bitget.com/api/v2/spot/market/ticker?symbol=${encodeURIComponent(sym + 'USDT')}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const data = Array.isArray(res?.data) ? res.data[0] : undefined;
            const price = parseFloat(data?.lastPr ?? data?.close ?? data?.last);
            return Number.isFinite(price) ? price : null;
          }
          case 'BYBIT': {
            const url = prox(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(sym + 'USDT')}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const data = Array.isArray(res?.result?.list) ? res.result.list[0] : undefined;
            const price = parseFloat(data?.lastPrice);
            return Number.isFinite(price) ? price : null;
          }
          case 'INDODAX': {
            // Fallback to single ticker if needed, but bulk is preferred.
            // First, try to get USDT rate.
            const rate = await getIndodaxUsdtRate();
            if (!Number.isFinite(rate) || rate <= 0) return null;
            // Then get the specific coin's IDR price.
            const pair = `${sym.toLowerCase()}_idr`;
            const url = prox(`https://indodax.com/api/ticker/${pair}`);
            const res = await $.ajax({ url, dataType: 'json' });
            const lastIdr = parseFloat(res?.ticker?.last);
            if (!Number.isFinite(lastIdr) || lastIdr <= 0) return null;
            const price = lastIdr / rate; // Calculate USDT price
            return Number.isFinite(price) ? price : null;
          }
          default:
            return null;
        }
      } catch (error) {
        console.warn(`fetchPriceForSymbol gagal [${upperCex} ${sym}]:`, error?.message || error);
        return null;
      }
    }

    // Web3 Helpers
    async function getDecimals(chainKey, contractAddress) {
      try {
        const rpc = getChainRpc(chainKey);
        if (!rpc || !contractAddress) return null;
        const web3 = new Web3(rpc);
        const contract = new web3.eth.Contract([{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"}], contractAddress);
        const decimals = await contract.methods.decimals().call();
        return decimals;
      } catch (e) {
        console.warn(`getDecimals failed for ${contractAddress} on ${chainKey}:`, e.message);
        return null;
      }
    }

    async function findContractBySymbol(chainKey, symbol) {
      try {
        const cfg = getChainConfig(chainKey);
        const rpc = cfg.RPC;
        const routerAddr = cfg.ROUTER;
        const wethAddr = cfg.WETH;
        if (!rpc || !routerAddr || !wethAddr || !symbol) return null;

        const web3 = new Web3(rpc);
        const router = new web3.eth.Contract([{"constant":true,"inputs":[{"internalType":"address","name":"tokenA","type":"address"},{"internalType":"address","name":"tokenB","type":"address"}],"name":"getPair","outputs":[{"internalType":"address","name":"pair","type":"address"}],"payable":false,"stateMutability":"view","type":"function"}], routerAddr);
        
        // Cari pair antara WETH dan token yang dicari (by symbol, ini tidak standar)
        // Ini adalah pendekatan heuristik dan mungkin tidak selalu berhasil.
        // Untuk implementasi yang lebih andal, diperlukan API eksternal atau daftar token yang lebih lengkap.
        // Untuk saat ini, kita asumsikan kita perlu SC untuk mencari, jadi fungsi ini lebih sebagai placeholder.
        // Logika yang lebih realistis adalah mencari di snapshot berdasarkan simbol, bukan via web3.
        // Jika ada API khusus chain untuk lookup simbol, itu bisa digunakan di sini.
        return null; // Placeholder, karena lookup by symbol via web3 tidak trivial.
      } catch (e) {
        console.warn(`findContractBySymbol failed for ${symbol} on ${chainKey}:`, e.message);
        return null;
      }
    }

    /**
     * Helper untuk memperkaya data CEX dengan desimal.
     * Mencari di database dulu, jika tidak ada baru ke Web3.
     */
    async function enrichWithDecimals(item, chainKey, snapBySc) {
      if (!item || !item.sc) return item;

      const scLower = String(item.sc).toLowerCase();
      const snapIt = snapBySc.get(scLower);

      let decimals = snapIt?.des ?? snapIt?.decimals;

      // Jika desimal tidak ditemukan di snapshot, coba fetch via Web3
      if (decimals === undefined || decimals === '' || decimals === null) {
        const fetchedDecimals = await getDecimals(chainKey, item.sc);
        if (fetchedDecimals !== null) {
          decimals = fetchedDecimals;
          // Pacing untuk menghindari rate-limit RPC
          await new Promise(r => setTimeout(r, RATE.WEB3_DELAY_MS));
        }
      }
      return { ...item, decimals: decimals ?? '' };
    }

    // Fetchers: return [{ cex, chain, token, symbol, sc, decimals, deposit, withdraw, feeWD }]
    const fetchers = {
      async BINANCE(chainKey){
        const k = CEX_API.BINANCE; if(!k?.ApiKey||!k?.ApiSecret) return [];
        const ts = Date.now(); const q = `timestamp=${ts}`;
        const sig = CryptoJS.HmacSHA256(q, k.ApiSecret).toString(CryptoJS.enc.Hex);
        const url = `https://api-gcp.binance.com/sapi/v1/capital/config/getall?${q}&signature=${sig}`;
        const res = await $.ajax({ url: prox(url), headers: { 'X-MBX-ApiKey': k.ApiKey } });
        const out = [];
        (res||[]).forEach(item=>{
          const net = (item.networkList||[]).find(n=> matchesCex(chainKey, n.network, 'BINANCE'));
          if(!net) return;
          out.push({ cex:'BINANCE', chain: chainKey, token: item.name||item.coin||item.asset||'', symbol: String(item.coin||'').toUpperCase(), sc: net.contractAddress||'', tradeable: item.trading === true, decimals:'', deposit: !!net.depositEnable, withdraw: !!net.withdrawEnable, feeWD: parseFloat(net.withdrawFee||0) });
        });
        return out;
      },
      async MEXC(chainKey){
        const k = CEX_API.MEXC; if(!k?.ApiKey||!k?.ApiSecret) return [];
        const ts = Date.now(); const q = `recvWindow=5000&timestamp=${ts}`;
        const sig = CryptoJS.HmacSHA256(q, k.ApiSecret).toString(CryptoJS.enc.Hex);
        const url = `https://api.mexc.com/api/v3/capital/config/getall?${q}&signature=${sig}`;
        const res = await $.ajax({ url: prox(url), headers: { 'X-MEXC-APIKEY': k.ApiKey } });
        const out = [];
        (res||[]).forEach(item => {
          // Prioritaskan 'netWork' (e.g., "ARB") lalu 'network' (e.g., "Arbitrum One(ARB)")
          const net = (item.networkList||[]).find(n => matchesCex(chainKey, n.netWork || n.network, 'MEXC'));
          if(!net) return;
          // 'tradeable' tidak tersedia di endpoint ini, akan diisi saat fetch harga.
          out.push({ cex:'MEXC', chain: chainKey, token: item.name||item.coin||'', symbol: String(item.coin||'').toUpperCase(), sc: net.contract || net.contractAddress || '', decimals:'', deposit: !!net.depositEnable, withdraw: !!net.withdrawEnable, feeWD: parseFloat(net.withdrawFee||0) });
        });
        return out;
      },
      async GATE(chainKey){
        // 1) Ambil daftar currencies (public) – kini sudah menyertakan chains[].addr (SC)
        const cur = await $.ajax({ url: prox(`https://api.gateio.ws/api/v4/spot/currencies`) });
        // 2) Optional: ambil withdraw_status (private) untuk fee WD
        let wd = [];
        try {
          const g = CEX_API.GATE || {};
          if (g.ApiKey && g.ApiSecret) {
            const ts = Math.floor(Date.now()/1000);
            const method = 'GET'; const path = '/api/v4/wallet/withdraw_status';
            const sign = gateSign({ method, path, ts, secret: g.ApiSecret });
            wd = await $.ajax({ url: prox(`https://api.gateio.ws${path}`), headers: { 'KEY': g.ApiKey, 'Timestamp': String(ts), 'SIGN': sign } });
          }
        } catch(e) { wd = []; UIkit.notification({message:`GATE withdraw_status gagal: ${e.message||e}`, status:'warning'}); }

        // 3) Gunakan chains dari currencies langsung (addr = SC). Decimals tetap diisi via Web3 nanti.
        const out = [];
        (cur||[]).forEach(item => {
          const symbol = String(item.currency||'').toUpperCase();
          const name = item.name || symbol;
          (item.chains||[]).forEach(ch => {
            const code = String(ch.name||ch.chain||'').toUpperCase();
            if (!matchesCex(chainKey, code, 'GATE')) return;
            let fee = 0; if (Array.isArray(wd) && wd.length){
              const match = wd.find(w => String(w.currency||'').toUpperCase()===symbol);
              const feeMap = match?.withdraw_fix_on_chains || {}; fee = feeMap[code] ?? 0;
            }
            out.push({
              cex:'GATE', chain: chainKey,
              token: name,
              symbol,
              sc: ch.addr || ch.contract_address || '',
              // Handle both 'trade_disabled' (boolean) and 'trade_status' (string)
              // A coin is tradeable if trade_disabled is false.
              tradeable: item.trade_disabled === false,
              decimals: '',
              deposit: ch.deposit_disabled===false,
              withdraw: ch.withdraw_disabled===false,
              feeWD: parseFloat(fee||0)
            });
          });
        });
        return out;
      },
      async KUCOIN(chainKey){
        const res = await $.ajax({ url: prox('https://api.kucoin.com/api/v3/currencies') });
        const out = [];
        (res?.data||[]).forEach(item=>{
          (item.chains||[]).forEach(ch=>{
            if(!matchesCex(chainKey, ch.chainName, 'KUCOIN')) return;
            // Fallback for trade status: assume tradeable if margin or debit is enabled, as 'isTradeable' is gone.
            const isTradeable = item.isTradeable === true || item.isMarginEnabled === true || item.isDebitEnabled === true;

            out.push({ cex:'KUCOIN', chain: chainKey, token: item.name||item.currency||'', symbol: String(item.currency||'').toUpperCase(), sc: ch.contractAddress||'', tradeable: isTradeable, decimals:'', deposit: ch.isDepositEnabled===true, withdraw: ch.isWithdrawEnabled===true, feeWD: parseFloat(ch.withdrawalMinFee||ch.withdrawFee||0) });
          });
        });
        return out;
      },
      async OKX(chainKey){
        const res = await $.ajax({ url: prox('https://www.okx.com/api/v5/asset/currencies') });
        const out = [];
        (res?.data||[]).forEach(item=>{
          const chain = item.chain || '';
          if(!matchesCex(chainKey, chain, 'OKX')) return;
          out.push({ cex:'OKX', chain: chainKey, token: item.name||item.ccy||'', symbol: String(item.ccy||'').toUpperCase(), sc: item.ctAddr||'', tradeable: String(item.trade) === 'true', decimals:'', deposit: String(item.canDep)==='true', withdraw: String(item.canWd)==='true', feeWD: parseFloat(item.minFee||0) });
        });
        return out;
      },
      async BITGET(chainKey){
        const res = await $.ajax({ url: 'https://api.bitget.com/api/v2/spot/public/coins'});
        const out = [];
        (res?.data||[]).forEach(i=> (i.chains||[]).forEach(ch=>{
          if(!matchesCex(chainKey, ch.chain, 'BITGET')) return;
          // Status 'tradeable' tidak tersedia di endpoint ini, akan diisi saat pengambilan harga.
          // Nama token diambil dari 'name' jika ada, jika tidak, gunakan 'coin'.
          out.push({ cex:'BITGET', chain: chainKey, token: i.name||i.coin||'', symbol: String(i.coin||'').toUpperCase(), sc: ch.contractAddress||'', decimals:'', deposit: String(ch.rechargeable).toLowerCase()==='true', withdraw: String(ch.withdrawable).toLowerCase()==='true', feeWD: parseFloat(ch.withdrawFee||0) });
        }));
        return out;
      },
      async BYBIT(chainKey){
        const b = CEX_API.BYBIT || {};
        if (!b.ApiKey || !b.ApiSecret) return [];
        const ts = Date.now().toString(); const recvWindow='5000'; const query='';
        const sign = bybitSignV5({ ts, apiKey:b.ApiKey, recvWindow, queryString: query, secret:b.ApiSecret });
        const res = await $.ajax({ url: `https://api.bybit.com/v5/asset/coin/query-info`, headers: {
          'X-BAPI-SIGN-TYPE': '2',
          'X-BAPI-SIGN': sign,
          'X-BAPI-API-KEY': b.ApiKey,
          'X-BAPI-TIMESTAMP': ts,
          'X-BAPI-RECV-WINDOW': recvWindow
        }});
        const data = res?.result?.rows || res?.result?.list || res?.result || [];
        const out=[];
        (data||[]).forEach(row => {
          const coin = row?.coin || row?.name || row?.symbol || '';
          const chains = row?.chains || row?.chainInfos || [];
          (chains||[]).forEach(ch => {
            const net = ch?.chain || ch?.chainType || ch?.name || '';
            if (!matchesCex(chainKey, net, 'BYBIT')) return;
            out.push({ cex:'BYBIT', chain: chainKey, token: String(coin||''), symbol: String(coin||'').toUpperCase(), sc: ch?.contractAddress || '', decimals:'', deposit: ch?.depositable===true || ch?.canDeposit===true, withdraw: ch?.withdrawable===true || ch?.canWithdraw===true, feeWD: parseFloat(ch?.withdrawFee || ch?.withdrawMinFee || 0) });
          });
        });
        return out;
      },
      async INDODAX(chainKey){
        // Use INDODAX private TAPI getInfo to obtain network mapping per coin
        const k = CEX_API.INDODAX || {};
        if (!k.ApiKey || !k.ApiSecret) return [];
        const ts = Date.now();
        const recvWindow = 5000;
        const method = 'getInfo';
        const body = `method=${method}&timestamp=${ts}&recvWindow=${recvWindow}`;
        const sign = CryptoJS.HmacSHA512(body, k.ApiSecret).toString();
        let res;
        try {
          res = await $.ajax({
            url: prox('https://indodax.com/tapi'),
            type: 'POST',
            headers: { 'Key': k.ApiKey, 'Sign': sign },
            data: body
          });
        } catch(e){ return []; }
        const networkMap = res?.return?.network || {};
        const out = [];
        // Build snapshot index by chain+symbol for enrichment
        let snapBySym = new Map();
        try {
          const snap = loadSnapshot();
          const key = String(chainKey||'').toLowerCase();
      const arr = Array.isArray(snap[key]) ? snap[key] : [];
          arr.forEach(it => {
            const sym = String(it.ticker || it.symbol || '').toUpperCase();
            if (sym) snapBySym.set(sym, it);
          });
        } catch(_){}
        // Iterate network mapping and filter by selected chain aliases
        Object.keys(networkMap||{}).forEach(symRaw => {
          const sym = String(symRaw||'').trim().toUpperCase();
          const netVal = networkMap[symRaw];
          const nets = Array.isArray(netVal) ? netVal : [netVal];
          // Pick any network alias that matches this chain
          const hit = (nets||[]).some(n => matchesCex(chainKey, n, 'INDODAX'));
          if (!hit) return;
          // Hapus `tradeable: false` agar status trade ditentukan oleh ketersediaan harga.
          const base = { cex:'INDODAX', chain: chainKey, token: sym, symbol: sym, sc:'', decimals:'', deposit: null, withdraw: null, feeWD: 0 };
          out.push(base); // Push base record first
        });

        // Asynchronous enrichment step
        const enrichedOut = [];
        for (const item of out) {
          const sym = item.symbol;
          let snapIt = snapBySym.get(sym);
          let sc = snapIt?.sc || '';
          let decimals = snapIt?.des ?? snapIt?.decimals ?? '';
          let tokenName = snapIt?.name || snapIt?.token || item.token;

          // Jika SC tidak ada, coba cari (logika placeholder)
          if (!sc) {
            // sc = await findContractBySymbol(chainKey, sym); // Placeholder
          }

          // Jika SC ada tapi decimals tidak, fetch via web3
          if (sc && (decimals === '' || decimals == null)) {
            decimals = await getDecimals(chainKey, sc);
            await new Promise(r => setTimeout(r, RATE.WEB3_DELAY_MS)); // Pacing
          }
          enrichedOut.push({ ...item, sc: sc || '', decimals: decimals ?? '', token: tokenName });
        }
        return enrichedOut;
      }
    };

    async function fetchBulkPrices(selectedCex, rows, onStep) {
      const maps = {};
      const grouped = {};
    
      (rows || []).forEach(r => {
        const cex = String(r.cex || '').toUpperCase();
        const sym = String(r.symbol || '').toUpperCase();
        if (!cex || !sym) return;
        if (!selectedCex.includes(cex)) return;
        if (!PRICE_SUPPORTED_CEX.has(cex)) return;
        if (!grouped[cex]) grouped[cex] = new Set(); // Symbols needed for this CEX
        grouped[cex].add(sym);
      });
    
      for (let i = 0; i < selectedCex.length; i++) {
        const cex = selectedCex[i];
        maps[cex] = {};
        try {
          let url = '';
          switch (cex) {
            case 'BINANCE': url = 'https://data-api.binance.vision/api/v3/ticker/price'; break;
            case 'MEXC': url = prox('https://api.mexc.com/api/v3/ticker/price'); break;
            case 'GATE': url = prox('https://api.gateio.ws/api/v4/spot/tickers'); break;
            case 'KUCOIN': url = prox('https://api.kucoin.com/api/v1/market/allTickers'); break;
            case 'OKX': url = prox('https://www.okx.com/api/v5/market/tickers?instType=SPOT'); break;
            case 'BITGET': url = prox('https://api.bitget.com/api/v2/spot/market/tickers'); break;
            case 'BYBIT': url = prox('https://api.bybit.com/v5/market/tickers?category=spot'); break;
            case 'INDODAX': url = prox('https://indodax.com/api/ticker_all'); break;
          }
    
          const res = await $.ajax({ url, dataType: 'json' });
          switch (cex) {
            case 'BINANCE': (res || []).forEach(t => { if (t.symbol.endsWith('USDT')) maps[cex][t.symbol.slice(0, -4)] = parseFloat(t.price); }); break;
            case 'MEXC': (res || []).forEach(t => { if (t.symbol.endsWith('USDT')) maps[cex][t.symbol.slice(0, -4)] = parseFloat(t.price); }); break;
            case 'GATE': (res || []).forEach(t => { if (t.currency_pair.endsWith('_USDT')) maps[cex][t.currency_pair.slice(0, -5)] = parseFloat(t.last); }); break;
            case 'KUCOIN': (res?.data?.ticker || []).forEach(t => { if (t.symbol.endsWith('-USDT')) maps[cex][t.symbol.slice(0, -5)] = parseFloat(t.last); }); break;
            case 'OKX': (res?.data || []).forEach(t => { if (t.instId.endsWith('-USDT')) maps[cex][t.instId.slice(0, -5)] = parseFloat(t.last); }); break;
            case 'BITGET': (res?.data || []).forEach(t => { if (t.symbol.endsWith('USDT')) maps[cex][t.symbol.slice(0, -4)] = parseFloat(t.lastPr); }); break;
            case 'BYBIT': (res?.result?.list || []).forEach(t => { if (t.symbol.endsWith('USDT')) maps[cex][t.symbol.slice(0, -4)] = parseFloat(t.lastPrice); }); break;
            case 'INDODAX': {
              const tickers = res?.tickers || res?.Tickers || res || {};
              const usdtTicker = tickers['usdt_idr'] || tickers['usdtidr'] || tickers['USDT_IDR'] || tickers['USDTIDR'];
              const storedRate = Number(getFromLocalStorage('PRICE_RATE_USDT') || 0);
              const usdtRate = Number(usdtTicker?.last || usdtTicker?.sell || usdtTicker?.buy || storedRate);
              Object.keys(tickers).forEach(pair => {
                const info = tickers[pair];
                if (!info || typeof info !== 'object') return;
                const lastRaw = info.last ?? info.close ?? info.price ?? info.sell ?? info.buy;
                const last = Number(lastRaw);
                if (!Number.isFinite(last) || last <= 0) return;
                const upper = String(pair || '').toUpperCase();
                if (upper.endsWith('IDR')) {
                  const base = upper.replace('_IDR', '').replace('IDR', '').replace('-', '').toUpperCase();
                  const rate = Number.isFinite(usdtRate) && usdtRate > 0 ? usdtRate : storedRate;
                  if (rate > 0) {
                    maps[cex][base] = last / rate;
                  }
                } else if (upper.endsWith('USDT')) {
                  const base = upper.replace('_USDT', '').replace('USDT', '').replace('-', '').toUpperCase();
                  maps[cex][base] = last;
                }
              });
            } break;
          }
    
          // Filter only the symbols we need to reduce memory usage
          const neededSymbols = grouped[cex] || new Set();
          const filteredMap = {};
          neededSymbols.forEach(sym => {
            if (maps[cex].hasOwnProperty(sym)) {
              filteredMap[sym] = maps[cex][sym];
            }
          });
          maps[cex] = filteredMap;
    
          if (onStep) onStep(i + 1, cex);
        } catch (error) {
          if (onStep) onStep(i + 1, cex, error?.message || error);
        }
        // Add delay between CEX calls, not between symbols
        await new Promise(resolve => setTimeout(resolve, RATE.PRICE_DELAY_MS));
      }
    
      return function getPrice(cex, base){
        const cx = String(cex || '').toUpperCase();
        const sym = String(base || '').toUpperCase();
        const map = maps[cx] || {};
        const value = map[sym];
        return (value !== undefined && value !== null) ? value : null;
      };
    }

    async function fetchAll(){
      const selectedCex = $('.cex-check:checked').map(function(){return String(this.value).toUpperCase();}).get();
      const chainKey = getSelectedChainKey();
      if(!selectedCex.length){ UIkit.notification('Pilih minimal 1 CEX', {status:'warning'}); return; }
      if(!chainKey){ UIkit.notification('Pilih chain', {status:'warning'}); return; }

      const startedAt = Date.now();
      let statusForHistory = 'success';
      let errorMessage = null;

      $btnFetch.prop('disabled', true); $btnExport.prop('disabled', true);
      $tbody.empty(); setStatus('Memulai sinkronisasi CEX...');
      showOverlay('Sinkronisasi CEX...');
      setOverlayPhase('CEX Sync', selectedCex.length);
      updateOverlayProgress(0);

      try {
        // Buat index dari snapshot saat ini untuk pencarian desimal yang efisien
        const snapBySc = getSnapshotIndexBySc(chainKey);

        // Loop melalui setiap CEX yang dipilih
        for (let i = 0; i < selectedCex.length; i++) {
          const cex = selectedCex[i];
          const fetcher = fetchers[cex];
          if (!fetcher) {
            UIkit.notification(`Tidak ada fetcher untuk ${cex}`, { status: 'warning' });
            updateOverlayProgress(i + 1);
            continue;
          }

          showOverlay(`Sinkronisasi data dari ${cex}...`);
          try {
            // Panggil fetcher untuk CEX ini dan chain yang dipilih
            const results = await fetcher(chainKey);
            const enrichedResults = [];

            // Perkaya setiap hasil dengan desimal menggunakan logika baru
            for (const rec of results) {
              const enrichedRec = await enrichWithDecimals(rec, chainKey, snapBySc);
              enrichedResults.push(enrichedRec);
            }

            // Simpan (upsert) setiap hasil ke database
            enrichedResults.forEach(rec => {
              if (rec && rec.sc) { upsertSnapshot(chainKey, rec); }
            });

            UIkit.notification(`✅ ${cex}: ${results.length} token disinkronkan`, { status: 'success' });
          } catch (err) {
            UIkit.notification(`❌ Gagal sinkronisasi ${cex}: ${err.message || err}`, { status: 'danger' });
          }

          updateOverlayProgress(i + 1);
          // Tambahkan jeda untuk menghindari rate-limit
          await new Promise(r => setTimeout(r, RATE.CEX_DELAY_MS));
        }

        // Setelah semua CEX selesai, render ulang data dari database
        showOverlay('Menampilkan hasil terbaru...');
        // Render ulang CEX chips untuk update jumlah
        try { buildCexChips(); } catch(_){}
        // Render ulang tabel dengan data terbaru dari DB, termasuk harga
        await renderLocalSnapshot(chainKey, { fetchPrices: true, silent: true });

      } catch (err) {
        statusForHistory = 'error';
        errorMessage = err && (err.message || err.toString());
        UIkit.notification({ message: `Gagal sinkronisasi: ${errorMessage}`, status: 'danger' });
        setStatus('Gagal sinkronisasi');
      } finally {
        hideOverlay();
        $btnFetch.prop('disabled', false);
        // Status tombol export akan diatur oleh renderLocalSnapshot

        const meta = {
          chain: String(chainKey).toUpperCase(),
          requestedCex: selectedCex,
          durationMs: Date.now() - startedAt
        };
        if (errorMessage) meta.errorMessage = errorMessage;
        try {
          if (typeof setLastAction === 'function') {
            setLastAction('SNAPSHOT SYNC CEX', statusForHistory, meta);
          } else if (typeof addHistoryEntry === 'function') {
            addHistoryEntry('SNAPSHOT SYNC CEX', statusForHistory, meta, { includeChain: true });
          }
        } catch(_){}
      }
    }

    function getSnapshotIndexBySc(chainKey) {
      const snap = loadSnapshot();
      const key = String(chainKey || '').toLowerCase();
      const arr = Array.isArray(snap[key]) ? snap[key] : [];
      const map = new Map();
      arr.forEach(it => {
        const sc = String(it.sc || '').toLowerCase();
        if (sc) {
          // Last write wins, which is fine for this purpose.
          map.set(sc, it);
        }
      });
      return map;
    }

    $('#snapshot-btn-fetch').on('click', fetchAll);

  function getSnapshotModalInstance() {
    try {
      const ui = (ROOT && ROOT.UIkit) ? ROOT.UIkit : (typeof UIkit !== 'undefined' ? UIkit : null);
      if (ui && typeof ui.modal === 'function') {
        return ui.modal('#snapshot-modal');
      }
    } catch(_) {}
    return null;
  }

  (function bindSnapshotModalHooks(){
    try {
      const modalEl = document.getElementById('snapshot-modal');
      const ui = (ROOT && ROOT.UIkit) ? ROOT.UIkit : (typeof UIkit !== 'undefined' ? UIkit : null);
      if (modalEl && ui && ui.util && typeof ui.util.on === 'function') {
        ui.util.on(modalEl, 'hide', function(){
          $('#snapshot-modal').removeData('return-to-sync');
        });
      } else if (modalEl) {
        modalEl.addEventListener('hide', function(){
          $('#snapshot-modal').removeData('return-to-sync');
        });
      }
    } catch(_) {}
  })();

  window.SnapshotModule = {
    async init(){
      snapshotInitTriggered = true;
      syncChainControls();
      await initializeUI(true);
    },
    async show(){
      snapshotInitTriggered = true;
      const key = syncChainControls();
      const initResult = await initializeUI(true);
      if (!initResult) {
        await loadChainData(false, key);
      }
      const modal = getSnapshotModalInstance();
      if (modal) {
        try { modal.show(); } catch(_) {}
      } else {
        $('#snapshot-modal').addClass('uk-open').show();
      }
    },
    hide(){
      hideOverlay();
      const modal = getSnapshotModalInstance();
      if (modal) {
        try { modal.hide(); } catch(_) {}
      }
      $('#snapshot-modal').removeClass('uk-open').hide().removeData('return-to-sync');
    }
  };
})();
