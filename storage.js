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
                    const req = indexedDB.open(DB_NAME, 1);
                    req.onupgradeneeded = (ev)=>{
                        const d = ev.target.result;
                        if (!d.objectStoreNames.contains(STORE_KV)) d.createObjectStore(STORE_KV, { keyPath:'key' });
                    };
                    req.onsuccess = (ev)=>{ db = ev.target.result; resolve(db); };
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

        setLastAction(`EXPORT DATA KOIN [${chainLabel}]`);
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

                // Tampilkan alert dengan Unicode
                alert(`✅ BERHASIL IMPORT ${jumlahToken} TOKEN 📦`);
                setLastAction(`IMPORT DATA KOIN [${chainLabel}]`);
                location.reload();

            } catch (error) {
                console.error("Error parsing CSV:", error);
                toastr.error("Format file CSV tidak valid!");
            }
        };
        reader.readAsText(file);
    }
