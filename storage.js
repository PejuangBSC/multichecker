    // IndexedDB-based storage with in-memory cache.
    // Object store (table) names use prefix MULTICHECKER_.
    (function initIndexedDBStorage(){
        const DB_NAME = 'MULTICHECKER_DB';
        const STORE_KV = 'MULTICHECKER_KV';
        const cache = {}; // runtime cache for sync reads
        let db = null;

        function openDB(){
            return new Promise((resolve, reject)=>{
                if (db) return resolve(db);
                try{
                    // Open without explicit version to avoid VersionError when DB was upgraded elsewhere
                    const req = indexedDB.open(DB_NAME);
                    req.onupgradeneeded = (ev)=>{
                        const d = ev.target.result;
                        if (!d.objectStoreNames.contains(STORE_KV)) d.createObjectStore(STORE_KV, { keyPath:'key' });
                    };
                    req.onsuccess = (ev)=>{
                        const d = ev.target.result;
                        // Ensure required store exists; if not, perform lightweight upgrade to add it
                        if (!d.objectStoreNames.contains(STORE_KV)){
                            const nextVersion = (d.version || 1) + 1;
                            d.close();
                            const up = indexedDB.open(DB_NAME, nextVersion);
                            up.onupgradeneeded = (e2)=>{
                                const udb = e2.target.result;
                                if (!udb.objectStoreNames.contains(STORE_KV)) udb.createObjectStore(STORE_KV, { keyPath:'key' });
                            };
                            up.onsuccess = (e2)=>{ db = e2.target.result; resolve(db); };
                            up.onerror = (e2)=>{ reject(e2.target.error || new Error('IDB upgrade failed')); };
                        } else {
                            db = d; resolve(db);
                        }
                    };
                    req.onerror = (ev)=>{ reject(ev.target.error || new Error('IDB open failed')); };
                } catch(e){ reject(e); }
            });
        }

        async function idbGetAll(){
            await openDB();
            return new Promise((resolve)=>{
                const out = [];
                try{
                    const tx = db.transaction([STORE_KV], 'readonly');
                    const st = tx.objectStore(STORE_KV);
                    const req = st.openCursor();
                    req.onsuccess = function(e){
                        const cursor = e.target.result;
                        if (cursor) {
                            try { out.push({ key: cursor.key, val: cursor.value?.val }); } catch(_){}
                            cursor.continue();
                        } else { resolve(out); }
                    };
                    req.onerror = function(){ resolve(out); };
                }catch(_){ resolve(out); }
            });
        }

        function idbGet(nsKey){
            return new Promise(async (resolve)=>{
                try{
                    await openDB();
                    const tx = db.transaction([STORE_KV], 'readonly');
                    const st = tx.objectStore(STORE_KV);
                    const req = st.get(nsKey);
                    req.onsuccess = ()=> resolve(req.result ? req.result.val : undefined);
                    req.onerror = ()=> resolve(undefined);
                }catch(_){ resolve(undefined); }
            });
        }
        function idbSet(nsKey, val){
            return new Promise(async (resolve)=>{
                try{
                    await openDB();
                    const tx = db.transaction([STORE_KV], 'readwrite');
                    tx.objectStore(STORE_KV).put({ key: nsKey, val });
                    tx.oncomplete = ()=> resolve(true);
                    tx.onerror = ()=> resolve(false);
                }catch(_){ resolve(false); }
            });
        }
        function idbDel(nsKey){
            return new Promise(async (resolve)=>{
                try{
                    await openDB();
                    const tx = db.transaction([STORE_KV], 'readwrite');
                    tx.objectStore(STORE_KV).delete(nsKey);
                    tx.oncomplete = ()=> resolve(true);
                    tx.onerror = ()=> resolve(false);
                }catch(_){ resolve(false); }
            });
        }

        // Note: LocalStorage mirroring removed. All state persisted in IndexedDB only.

        // Warm all cache entries early (best-effort)
        function warmCacheAll(){
            return new Promise(async (resolve)=>{
                try{
                    await openDB();
                    const tx = db.transaction([STORE_KV], 'readonly');
                    const st = tx.objectStore(STORE_KV);
                    const req = st.openCursor();
                    req.onsuccess = function(e){
                        const cursor = e.target.result;
                        if (cursor) {
                            try { cache[cursor.key] = cursor.value?.val; } catch(_){}
                            cursor.continue();
                        } else { resolve(true); }
                    };
                    req.onerror = function(){ resolve(false); };
                }catch(_){ resolve(false); }
            });
        }
        try { window.whenStorageReady = warmCacheAll(); } catch(_){}

        // Initialize cross-tab channel for state sync (best-effort)
        try { window.__MC_BC = window.__MC_BC || new BroadcastChannel('MULTICHECKER_APP'); } catch(_) {}

        // Public API (kept sync signatures to avoid large refactor)
        window.getFromLocalStorage = function(key, defaultValue){
            try{
                const nsKey = String((window.storagePrefix||'') + key);
                if (Object.prototype.hasOwnProperty.call(cache, nsKey)) return cache[nsKey];
                // Lazy load from IDB; return fallback synchronously
                idbGet(nsKey).then(val => { if (val !== undefined) cache[nsKey] = val; });
                return defaultValue;
            }catch(e){ return defaultValue; }
        };

        // History helpers (append-only list in KV)
        function resolveModeInfo(){
            try {
                if (typeof getAppMode === 'function') {
                    const m = getAppMode();
                    if (m && String(m.type).toLowerCase() === 'single') {
                        return { mode: 'single', chain: String(m.chain||'').toUpperCase() || 'UNKNOWN' };
                    }
                    return { mode: 'multi', chain: 'MULTICHAIN' };
                }
            } catch(_) {}
            // Fallback to URL param
            try {
                const params = new URLSearchParams(window.location.search || '');
                const raw = (params.get('chain') || 'all').toLowerCase();
                if (!raw || raw === 'all') return { mode: 'multi', chain: 'MULTICHAIN' };
                return { mode: 'single', chain: raw.toUpperCase() };
            } catch(_) { return { mode: 'multi', chain: 'MULTICHAIN' }; }
        }

        function formatActionLabel(action, includeChain){
            try {
                const hasBracket = /\[[^\]]+\]$/.test(String(action));
                if (!includeChain || hasBracket) return String(action);
                const info = resolveModeInfo();
                return `${String(action)} [${info.chain}]`;
            } catch(_) { return String(action); }
        }

        async function getHistoryLog(){
            try {
                const key = String((window.storagePrefix||'') + 'HISTORY_LOG');
                if (Object.prototype.hasOwnProperty.call(cache, key)) return Array.isArray(cache[key]) ? cache[key] : [];
                const val = await idbGet(key);
                if (val !== undefined) cache[key] = val;
                return Array.isArray(val) ? val : [];
            } catch(_) { return []; }
        }

        async function addHistoryEntryRaw(entry){
            try {
                const list = await getHistoryLog();
                const capped = list.slice(-999);
                capped.push(entry);
                const key = String((window.storagePrefix||'') + 'HISTORY_LOG');
                cache[key] = capped;
                await idbSet(key, capped);
                try { if (window.__MC_BC) window.__MC_BC.postMessage({ type: 'history', entry }); } catch(_) {}
                return true;
            } catch(_) { return false; }
        }

        // options: { includeChain?: boolean }
        window.addHistoryEntry = async function(action, status, meta, options){
            try {
                const when = new Date();
                const stamp = when.toLocaleString('id-ID', { hour12: false });
                const includeChain = (options && typeof options.includeChain === 'boolean') ? options.includeChain : true;
                const actionLabel = formatActionLabel(action, includeChain);
                const entry = {
                    id: (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
                    timeISO: when.toISOString(),
                    time: stamp,
                    action: String(actionLabel||'').trim(),
                    status: String(status||'success').toLowerCase(),
                    meta: meta || undefined
                };
                return await addHistoryEntryRaw(entry);
            } catch(_) { return false; }
        };

        // Expose getters and bulk delete utilities
        window.getHistoryLog = async function(){ return await getHistoryLog(); };
        window.clearHistoryLog = async function(){
            try{
                const key = String((window.storagePrefix||'') + 'HISTORY_LOG');
                cache[key] = [];
                await idbSet(key, []);
                try { if (window.__MC_BC) window.__MC_BC.postMessage({ type: 'history_clear' }); } catch(_) {}
                return true;
            } catch(_) { return false; }
        };
        window.deleteHistoryByIds = async function(ids){
            try{
                const list = await getHistoryLog();
                const set = new Set((ids||[]).map(String));
                const filtered = list.filter(e => !set.has(String(e.id)));
                const key = String((window.storagePrefix||'') + 'HISTORY_LOG');
                cache[key] = filtered;
                await idbSet(key, filtered);
                try { if (window.__MC_BC) window.__MC_BC.postMessage({ type: 'history_delete', ids: Array.from(set) }); } catch(_) {}
                return { ok: true, removed: list.length - filtered.length };
            } catch(e){ return { ok:false, error: e }; }
        };

        window.saveToLocalStorage = function(key, value){
            try{
                const nsKey = String((window.storagePrefix||'') + key);
                cache[nsKey] = value;
                idbSet(nsKey, value);
                // Broadcast key update (e.g., APP_STATE) to other tabs
                try { if (window.__MC_BC) window.__MC_BC.postMessage({ type: 'kv', key, val: value }); } catch(_) {}
                // no localStorage mirror
            }catch(_){ /* ignore */ }
        };

        // Async variant with explicit success/failure result for better UX
        window.saveToLocalStorageAsync = async function(key, value){
            const nsKey = String((window.storagePrefix||'') + key);
            try {
                cache[nsKey] = value;
                const ok = await idbSet(nsKey, value);
                // no localStorage mirror
                if (!ok) {
                    try {
                        window.LAST_STORAGE_ERROR = 'IndexedDB transaction failed (possibly quota or permissions).';
                    } catch(_) {}
                }
                try { if (ok && window.__MC_BC) window.__MC_BC.postMessage({ type: 'kv', key, val: value }); } catch(_) {}
                return { ok };
            } catch (e) {
                try { window.LAST_STORAGE_ERROR = (e && e.message) ? e.message : String(e); } catch(_) {}
                return { ok: false, error: e };
            }
        };

        window.removeFromLocalStorage = function(key){
            try{
                const nsKey = String((window.storagePrefix||'') + key);
                delete cache[nsKey];
                idbDel(nsKey);
                // no localStorage mirror
            }catch(_){ /* ignore */ }
        };

        // ============================
        // BACKUP & RESTORE HELPERS
        // ============================
        window.exportIDB = async function(){
            try {
                const items = await idbGetAll();
                return {
                    schema: 'kv-v1',
                    db: DB_NAME,
                    store: STORE_KV,
                    prefix: (window.storagePrefix||''),
                    exportedAt: new Date().toISOString(),
                    count: items.length,
                    items
                };
            } catch(e){ return { schema:'kv-v1', error: String(e) }; }
        };

        window.restoreIDB = async function(payload, opts){
            const options = Object.assign({ overwrite: true }, opts||{});
            let ok = 0, fail = 0;
            if (!payload || !Array.isArray(payload.items)) return { ok, fail, error: 'Invalid payload' };
            for (const it of payload.items){
                try {
                    if (!it || !it.key) { fail++; continue; }
                    // Optional: honor prefix if provided; else write as-is
                    const key = String(it.key);
                    const res = await idbSet(key, it.val);
                    if (res) { cache[key] = it.val; ok++; } else { fail++; }
                } catch(_) { fail++; }
            }
            return { ok, fail };
        };

        window.downloadJSON = function(filename, obj){
            try {
                const dataStr = JSON.stringify(obj, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename || 'backup.json';
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return true;
            } catch(_) { return false; }
        };
    })();

   // ============================
    // DOWNLOAD CSV
    // ============================
    function getActiveTokenKeyLocal() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const raw = (params.get('chain') || '').toLowerCase();
            if (!raw || raw === 'all') return 'TOKEN_MULTICHAIN';
            return `TOKEN_${String(raw).toUpperCase()}`;
        } catch(_) { return 'TOKEN_MULTICHAIN'; }
    }

    function getActiveChainLabel() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const raw = (params.get('chain') || 'all').toLowerCase();
            return (!raw || raw === 'all') ? 'MULTICHAIN' : raw.toUpperCase();
        } catch(_) { return 'MULTICHAIN'; }
    }

    function downloadTokenScannerCSV() {
        const tokenData = getFromLocalStorage(getActiveTokenKeyLocal(), []);
        const chainLabel = getActiveChainLabel();

        // Header sesuai struktur
        const headers = [
            "id","no","symbol_in","symbol_out","chain",
            "sc_in","des_in","sc_out","des_out",
            "dataCexs","dataDexs","status","selectedCexs","selectedDexs"
        ];

        // Konversi setiap item
        const rows = tokenData.map(token => [
            token.id ?? "",
            token.no ?? "",
            token.symbol_in ?? "",
            token.symbol_out ?? "",
            token.chain ?? "",
            token.sc_in ?? "",
            token.des_in ?? "",
            token.sc_out ?? "",
            token.des_out ?? "",
            JSON.stringify(token.dataCexs ?? {}),    // object → JSON string
            JSON.stringify(token.dataDexs ?? {}),
            token.status ? "true" : "false",         // boolean → string
            (token.selectedCexs ?? []).join("|"),    // array → A|B|C
            (token.selectedDexs ?? []).join("|")
        ].map(v => `"${String(v).replace(/"/g, '""')}"`)); // escape CSV

        // Gabungkan jadi CSV
        const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

        // Buat file download
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `KOIN_MULTICHECKER_${chainLabel}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        try { setLastAction(`EXPORT DATA KOIN`, 'success'); } catch(_) {}
    }

    // ============================
    // UPLOAD CSV
    // ============================
    function uploadTokenScannerCSV(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const csvText = e.target.result.trim();
                const rows = csvText.split("\n");

                // Ambil header
                const headers = rows[0].split(",").map(h => h.trim());

                // Parse tiap baris → object
                const tokenData = rows.slice(1).map(row => {
                    // Split CSV aman, mempertahankan koma dalam tanda kutip
                    const values = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

                    let obj = {};
                    headers.forEach((header, index) => {
                        let val = values[index] ? values[index].trim() : "";

                        // Hapus tanda kutip luar & ganti "" jadi "
                        if (val.startsWith('"') && val.endsWith('"')) {
                            val = val.slice(1, -1).replace(/""/g, '"');
                        }

                        // Parsing field sesuai tipe
                        if (header === "dataCexs" || header === "dataDexs") {
                            try { val = JSON.parse(val || "{}"); } catch { val = {}; }
                        }
                        else if (header === "selectedCexs" || header === "selectedDexs") {
                            val = val ? val.split("|") : [];
                        }
                        else if (header === "no" || header === "des_in" || header === "des_out") {
                            val = val ? Number(val) : null;
                        }
                        else if (header === "status") {
                            val = (val || "").toString().trim().toLowerCase() === "true";
                        }

                        obj[header] = val;
                    });

                    return obj;
                });

                // Simpan ke storage (IndexedDB KV)
                const chainLabel = getActiveChainLabel();
                saveToLocalStorage(getActiveTokenKeyLocal(), tokenData);
                // Hitung jumlah token yang diimport
                let jumlahToken = Array.isArray(tokenData) ? tokenData.length : 0;

                // Notifikasi sukses + tetap tampil setelah reload
                try { setLastAction(`IMPORT DATA KOIN`, 'success', { count: jumlahToken }); } catch(_) {}
                try {
                    if (typeof reloadWithNotify === 'function') {
                        reloadWithNotify('success', `✅ BERHASIL IMPORT ${jumlahToken} TOKEN 📦`);
                    } else if (typeof notifyAfterReload === 'function') {
                        notify('success', `✅ BERHASIL IMPORT ${jumlahToken} TOKEN 📦`, null, { persist: true });
                        location.reload();
                    } else if (typeof toast !== 'undefined' && toast.success) {
                        // refactor: route via toast helper
                        toast.success(`✅ BERHASIL IMPORT ${jumlahToken} TOKEN 📦`);
                        location.reload();
                    } else {
                        alert(`✅ BERHASIL IMPORT ${jumlahToken} TOKEN 📦`);
                        location.reload();
                    }
                } catch(_) { try { location.reload(); } catch(_){} }

            } catch (error) {
                console.error("Error parsing CSV:", error);
                try { setLastAction('IMPORT DATA KOIN', 'error', { error: String(error && error.message || error) }); } catch(_) {}
                if (typeof toast !== 'undefined' && toast.error) toast.error("Format file CSV tidak valid!"); else alert("Format file CSV tidak valid!");
            }
        };
        reader.readAsText(file);
    }
