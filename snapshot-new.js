// =================================================================================
// SNAPSHOT COINS MODULE - Unified CEX Integration with Real-time Pricing
// =================================================================================
// REFACTORED: Single unified snapshot system for modal "Sinkronisasi Koin"
//
// Main Process Flow:
// 1. Fetch data wallet exchanger dari CEX APIs (via services/cex.js)
// 2. Enrichment data dengan Web3 untuk decimals/SC
// 3. Fetch harga real-time dari orderbook CEX (menggunakan getPriceCEX dari services/cex.js)
// 4. Save to unified IndexedDB snapshot storage
// 5. Tampilkan di tabel dengan progress tracking
//
// Key Functions:
// - processSnapshotForCex(): Main orchestrator for snapshot process
// - fetchCexData(): Fetch wallet status from CEX APIs
// - validateTokenData(): Validate and enrich token with decimals/SC
// - saveToSnapshot(): Save to IndexedDB snapshot storage
//
// Price Fetching:
// - PRIORITY 1: getPriceCEX() dari services/cex.js (orderbook-based, lebih akurat)
// - FALLBACK: fetchPriceMapForCex() dengan ticker API (jika services/cex.js tidak tersedia)
//
// Sumber Harga Rate:
// - Orderbook API dari masing-masing CEX (via services/cex.js::getPriceCEX)
//   * BINANCE: api.binance.me/api/v3/depth
//   * GATE: api.gateio.ws/api/v4/spot/order_book
//   * MEXC: api.mexc.com/api/v3/depth
//   * KUCOIN: api.kucoin.com/api/v1/market/orderbook/level2_20
//   * BITGET: api.bitget.com/api/v2/spot/market/orderbook
//   * BYBIT: api.bybit.com/v5/market/orderbook
//   * INDODAX: indodax.com/api/depth
//
// Used by:
// - Modal "Sinkronisasi Koin" (sync-modal)
// - Update Wallet Exchanger section (wallet-exchanger.js)

(function() {
    'use strict';

    // ====================
    // INDEXEDDB CONFIGURATION
    // ====================
    const SNAPSHOT_DB_CONFIG = (function(){
        const root = (typeof window !== 'undefined') ? window : {};
        const appCfg = (root.CONFIG_APP && root.CONFIG_APP.APP) ? root.CONFIG_APP.APP : {};
        const dbCfg = root.CONFIG_DB || {};
        return {
            name: dbCfg.NAME || appCfg.NAME || 'MULTIALL-PLUS',
            store: (dbCfg.STORES && dbCfg.STORES.SNAPSHOT) ? dbCfg.STORES.SNAPSHOT : 'SNAPSHOT_STORE',
            snapshotKey: 'SNAPSHOT_DATA_KOIN'
        };
    })();

    let snapshotDbInstance = null;

    // ====================
    // WEB3 CACHE SYSTEM
    // ====================
    // Persistent cache untuk web3 token data (decimals, symbol, name)
    // Mengurangi RPC calls dengan menyimpan data ke IndexedDB

    const WEB3_CACHE_KEY = 'WEB3_TOKEN_CACHE';
    const WEB3_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    const WEB3_PENDING_REQUESTS = new Map(); // Track pending requests untuk deduplication

    // Load web3 cache from IndexedDB
    async function loadWeb3Cache() {
        try {
            const data = await snapshotDbGet(WEB3_CACHE_KEY);
            if (data && typeof data === 'object') {
                return data;
            }
        } catch(e) {
            console.warn('[Web3 Cache] Failed to load cache:', e);
        }
        return {};
    }

    // Save web3 cache to IndexedDB
    async function saveWeb3Cache(cache) {
        try {
            await snapshotDbSet(WEB3_CACHE_KEY, cache);
        } catch(e) {
            console.warn('[Web3 Cache] Failed to save cache:', e);
        }
    }

    // Get cached web3 data for a contract
    function getWeb3CacheEntry(cache, contractAddress, chainKey) {
        const key = `${chainKey}:${contractAddress.toLowerCase()}`;
        const entry = cache[key];
        if (!entry) return null;

        const now = Date.now();
        if (now - entry.timestamp > WEB3_CACHE_TTL) {
            // Cache expired
            delete cache[key];
            return null;
        }

        return entry.data;
    }

    // Set cache entry for web3 data
    function setWeb3CacheEntry(cache, contractAddress, chainKey, data) {
        const key = `${chainKey}:${contractAddress.toLowerCase()}`;
        cache[key] = {
            data,
            timestamp: Date.now()
        };
    }

    // ====================
    // INDEXEDDB FUNCTIONS
    // ====================

    async function openSnapshotDatabase() {
        if (snapshotDbInstance) return snapshotDbInstance;
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB tidak tersedia di lingkungan ini.');

        snapshotDbInstance = await new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(SNAPSHOT_DB_CONFIG.name);
                req.onupgradeneeded = (ev) => {
                    const db = ev.target.result;
                    if (!db.objectStoreNames.contains(SNAPSHOT_DB_CONFIG.store)) {
                        db.createObjectStore(SNAPSHOT_DB_CONFIG.store, { keyPath: 'key' });
                    }
                };
                req.onsuccess = (ev) => {
                    resolve(ev.target.result);
                };
                req.onerror = (ev) => {
                    reject(ev.target.error || new Error('Gagal buka Snapshot DB'));
                };
            } catch(err) {
                reject(err);
            }
        });

        return snapshotDbInstance;
    }

    async function snapshotDbGet(key) {
        try {
            const db = await openSnapshotDatabase();
            return await new Promise((resolve) => {
                try {
                    const tx = db.transaction([SNAPSHOT_DB_CONFIG.store], 'readonly');
                    const st = tx.objectStore(SNAPSHOT_DB_CONFIG.store);
                    const req = st.get(String(key));
                    req.onsuccess = function() { resolve(req.result ? req.result.val : undefined); };
                    req.onerror = function() { resolve(undefined); };
                } catch(_) { resolve(undefined); }
            });
        } catch(error) {
            // console.error('snapshotDbGet error:', error);
            return undefined;
        }
    }

    async function snapshotDbSet(key, val) {
        try {
            const db = await openSnapshotDatabase();
            return await new Promise((resolve) => {
                try {
                    const tx = db.transaction([SNAPSHOT_DB_CONFIG.store], 'readwrite');
                    const st = tx.objectStore(SNAPSHOT_DB_CONFIG.store);
                    st.put({ key: String(key), val });
                    tx.oncomplete = function() { resolve(true); };
                    tx.onerror = function() { resolve(false); };
                } catch(_) { resolve(false); }
            });
        } catch(error) {
            // console.error('snapshotDbSet error:', error);
            return false;
        }
    }

    // ====================
    // STORAGE ABSTRACTION
    // ====================

    // All storage operations now unified through snapshot functions
    // syncDbGet and syncDbSet aliases removed - use snapshotDbGet/snapshotDbSet directly

    // ====================
    // REMOVED: SYNC STORAGE FUNCTIONS
    // ====================
    // saveSyncCoins() and getSyncCoins() removed - unified with snapshot storage
    // Use saveToSnapshot() and load via loadSnapshotRecords() instead

    // Get root window (handle iframe context)
    const ROOT = (function(){
        try {
            if (window.parent && window.parent.CONFIG_CHAINS) return window.parent;
        } catch(_) {}
        return window;
    })();

    const CONFIG_CHAINS = (ROOT.CONFIG_CHAINS && typeof ROOT.CONFIG_CHAINS === 'object') ? ROOT.CONFIG_CHAINS : {};
    // NOTE: CONFIG_CEX removed - CEX API handling moved to services/cex.js

    // ====================
    // HELPER FUNCTIONS
    // ====================

    // NOTE: getCexApiKeys() removed - handled by services/cex.js

    // NOTE: getChainAliasesForIndodax() removed - chain matching handled by existing matchesCex()

    // Helper: Get chain synonyms directly from config.js
    function getChainSynonyms(chainKey) {
        // Use CHAIN_SYNONYMS from config.js
        if (typeof window !== 'undefined' && window.CHAIN_SYNONYMS) {
            return window.CHAIN_SYNONYMS[chainKey] || [];
        }
        return [];
    }

    function escapeRegex(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function chainRegex(chainKey) {
        const synonyms = getChainSynonyms(chainKey);
        if (!synonyms.length) return null;
        const alt = synonyms.map(escapeRegex).join('|');
        return new RegExp(alt, 'i');
    }

    function matches(chainKey, net) {
        const rx = chainRegex(chainKey);
        return rx ? rx.test(String(net || '')) : true;
    }

    function matchesCex(chainKey, net) {
        // chain-level regex matching only
        return matches(chainKey, net);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ====================
    // PRICE FETCH HELPERS
    // ====================

    function getPriceProxyPrefix() {
        try {
            return (window.CONFIG_PROXY && window.CONFIG_PROXY.PREFIX) || 'https://proxykanan.awokawok.workers.dev/?';
        } catch(_) {
            return 'https://proxykanan.awokawok.workers.dev/?';
        }
    }

    function proxPrice(url) {
        if (!url) return url;
        try {
            const prefix = getPriceProxyPrefix();
            if (!prefix) return url;
            if (url.startsWith(prefix)) return url;
            if (/^https?:\/\//i.test(url)) return prefix + url;
        } catch(_) {}
        return url;
    }

    // Generic price parser to reduce duplication
    function createGenericPriceParser(symbolPath, pricePath, dataPath = null) {
        return (data) => {
            const list = dataPath ? (dataPath.split('.').reduce((o, k) => o?.[k], data) || []) : (Array.isArray(data) ? data : []);
            const map = new Map();
            list.forEach(item => {
                const symbol = String(item?.[symbolPath] || '').toUpperCase();
                const price = Number(item?.[pricePath]);
                if (!symbol || !Number.isFinite(price)) return;
                map.set(symbol, price);
                // Handle pairs like "BTC-USDT" or "BTC_USDT"
                map.set(symbol.replace(/[_-]/g, ''), price);
            });
            return map;
        };
    }

    const PRICE_ENDPOINTS = {
        BINANCE: {
            url: 'https://data-api.binance.vision/api/v3/ticker/price',
            proxy: false,
            parser: (data) => {
                const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
                const map = new Map();
                list.forEach(item => {
                    const symbol = String(item?.symbol || '').toUpperCase();
                    const price = Number(item?.price ?? item?.lastPrice ?? item?.last);
                    if (!symbol || !Number.isFinite(price)) return;
                    map.set(symbol, price);
                });
                return map;
            }
        },
        MEXC: {
            url: 'https://api.mexc.com/api/v3/ticker/price',
            proxy: true,
            parser: createGenericPriceParser('symbol', 'price')
        },
        GATE: {
            url: 'https://api.gateio.ws/api/v4/spot/tickers',
            proxy: true,
            parser: createGenericPriceParser('currency_pair', 'last')
        },
        KUCOIN: {
            url: 'https://api.kucoin.com/api/v1/market/allTickers',
            proxy: true,
            parser: createGenericPriceParser('symbol', 'last', 'data.ticker')
        },
        OKX: {
            url: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
            proxy: true,
            parser: createGenericPriceParser('instId', 'last', 'data')
        },
        BITGET: {
            url: 'https://api.bitget.com/api/v2/spot/market/tickers',
            proxy: false,
            parser: (data) => {
                const list = Array.isArray(data?.data) ? data.data
                              : Array.isArray(data?.data?.list) ? data.data.list : [];
                const map = new Map();
                list.forEach(item => {
                    const symbol = String(item?.symbol || item?.instId || '').toUpperCase();
                    const price = Number(item?.lastPr ?? item?.close);
                    if (!symbol || !Number.isFinite(price)) return;
                    map.set(symbol, price);
                });
                return map;
            }
        },
        BYBIT: {
            url: 'https://api.bybit.com/v5/market/tickers?category=spot',
            proxy: true,
            parser: createGenericPriceParser('symbol', 'lastPrice', 'result.list')
        },
        INDODAX: {
            url: 'https://indodax.com/api/ticker_all',
            proxy: true,
            parser: (data) => {
                const payload = data?.tickers || data || {};
                const map = new Map();
                Object.keys(payload).forEach(key => {
                    const info = payload[key];
                    const price = Number(info?.last ?? info?.last_price ?? info?.close);
                    if (!Number.isFinite(price)) return;
                    const upperKey = String(key || '').toUpperCase();
                    map.set(upperKey, price);
                    map.set(upperKey.replace(/[_-]/g, ''), price);
                });
                return map;
            }
        }
    };

    const PRICE_CACHE = new Map();
    const PRICE_CACHE_TTL = 60000;

    function resolvePriceFromMap(cex, priceMap, baseSymbol, quoteSymbol) {
        if (!priceMap) return NaN;
        const base = String(baseSymbol || '').toUpperCase();
        const cexUpper = String(cex || '').toUpperCase();

        // Special handling for INDODAX - always use IDR pairs
        const quote = (cexUpper === 'INDODAX') ? 'IDR' : String(quoteSymbol || 'USDT').toUpperCase();

        if (!base || !quote) return NaN;

        const candidates = [
            `${base}${quote}`,
            `${base}_${quote}`,
            `${base}-${quote}`,
            `${base}/${quote}`,
            `${base}${quote}`.toLowerCase(),
            `${base}_${quote}`.toLowerCase(),
            `${base}-${quote}`.toLowerCase()
        ];

        const mapGetter = (key) => priceMap instanceof Map ? priceMap.get(key) : priceMap[key];

        for (const key of candidates) {
            const val = mapGetter(key);
            if (Number.isFinite(val)) return Number(val);
        }
        return NaN;
    }

    // Helper: Fetch with timeout
    async function fetchWithTimeout(url, timeoutMs = 30000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch(error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeoutMs}ms`);
            }
            throw error;
        }
    }

    async function fetchPriceMapForCex(cexName) {
        const upper = String(cexName || '').toUpperCase();
        if (!upper || !PRICE_ENDPOINTS[upper]) return new Map();

        const now = Date.now();
        const cached = PRICE_CACHE.get(upper);
        if (cached && (now - cached.ts) < PRICE_CACHE_TTL) {
            return cached.map;
        }

        const endpoint = PRICE_ENDPOINTS[upper];
        let url = endpoint.url;
        if (endpoint.proxy) {
            url = proxPrice(url);
        }

        // ========== RETRY MECHANISM ==========
        const MAX_RETRIES = 3;
        const FETCH_TIMEOUT = 30000; // 30 seconds for fetch
        const JSON_TIMEOUT = 10000;  // 10 seconds for JSON parsing
        const TOTAL_TIMEOUT = 45000; // 45 seconds total per attempt
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`[fetchPriceMapForCex] ${upper} - Attempt ${attempt}/${MAX_RETRIES}`);

                // Wrap entire attempt in timeout to prevent hanging
                const attemptPromise = (async () => {
                    const response = await fetchWithTimeout(url, FETCH_TIMEOUT);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    }

                    // ========== TIMEOUT FOR JSON PARSING ==========
                    // Add timeout for response.json() to prevent hanging
                    const jsonTimeout = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('JSON parsing timeout after 10s')), JSON_TIMEOUT);
                    });

                    const jsonPromise = response.json();
                    const data = await Promise.race([jsonPromise, jsonTimeout]);

                    // Validate response data
                    if (!data) {
                        throw new Error('Empty response data from API');
                    }

                    // Check if data is valid (array or object with data)
                    const isEmpty = (Array.isArray(data) && data.length === 0) ||
                                   (typeof data === 'object' && Object.keys(data).length === 0);

                    if (isEmpty) {
                        throw new Error('API returned empty data');
                    }
                    // =============================================

                    const map = endpoint.parser(data) || new Map();

                    // Validate parsed map has data
                    if (map.size === 0) {
                        console.warn(`[fetchPriceMapForCex] ${upper} - Parser returned empty map, data:`, data);
                        throw new Error('Parser returned empty price map');
                    }

                    return map;
                })();

                // Race against total timeout
                const totalTimeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Total timeout after ${TOTAL_TIMEOUT}ms`)), TOTAL_TIMEOUT);
                });

                const map = await Promise.race([attemptPromise, totalTimeout]);

                PRICE_CACHE.set(upper, { map, ts: now });

                console.log(`[fetchPriceMapForCex] ${upper} - Success (${map.size} pairs)`);

                // Clear error notification if previous attempt failed
                if (attempt > 1 && typeof toast !== 'undefined' && toast.success) {
                    toast.success(`✅ Berhasil fetch harga ${upper} (attempt ${attempt})`);
                }

                return map;

            } catch(error) {
                lastError = error;
                console.error(`[fetchPriceMapForCex] ${upper} - Attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

                // Show warning for retry
                if (attempt < MAX_RETRIES) {
                    if (typeof toast !== 'undefined' && toast.warning) {
                        toast.warning(
                            `⚠️ Fetch harga ${upper} gagal (attempt ${attempt}/${MAX_RETRIES})\n` +
                            `Error: ${error.message}\n` +
                            `Mencoba lagi...`,
                            { duration: 3000 }
                        );
                    }

                    // Wait before retry (exponential backoff)
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Final attempt failed - show error
                    if (typeof toast !== 'undefined' && toast.error) {
                        toast.error(
                            `❌ Gagal fetch harga ${upper} setelah ${MAX_RETRIES} percobaan\n` +
                            `Error: ${error.message}\n` +
                            `Harga tidak akan ditampilkan untuk ${upper}`,
                            { duration: 8000 }
                        );
                    }
                }
            }
        }
        // =====================================

        // All retries failed - return empty map
        console.error(`[fetchPriceMapForCex] ${upper} - All ${MAX_RETRIES} attempts failed. Last error:`, lastError?.message);
        PRICE_CACHE.set(upper, { map: new Map(), ts: now });
        return new Map();
    }

    async function saveToSnapshot(chainKey, tokens) {
        try {
            // console.log('saveToSnapshot called:', { chainKey, tokensLength: tokens?.length });

            const snapshotMap = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
            // console.log('saveToSnapshot - Existing map keys:', Object.keys(snapshotMap));

            const keyLower = String(chainKey || '').toLowerCase();
            // console.log('saveToSnapshot - Will save to key:', keyLower);

            // Convert tokens to snapshot format
            const snapshotTokens = tokens.map(token => {
                const cexUpper = String(token.cex || '').toUpperCase();
                // Default currency: INDODAX uses IDR, others use USDT
                const defaultCurrency = (cexUpper === 'INDODAX') ? 'IDR' : 'USDT';

                return {
                    cex: cexUpper,
                    symbol_in: String(token.symbol_in || '').toUpperCase(),
                    sc_in: String(token.sc_in || '').trim(),
                    des_in: Number(token.des_in || token.decimals || 0),
                    symbol_out: String(token.symbol_out || '').toUpperCase(),
                    sc_out: String(token.sc_out || '').trim(),
                    des_out: Number(token.des_out || 0),
                    token_name: token.token_name || token.name || token.symbol_in,
                    deposit: token.deposit,
                    withdraw: token.withdraw,
                    feeWD: token.feeWD,
                    tradeable: token.tradeable,
                    current_price: Number.isFinite(Number(token.current_price)) ? Number(token.current_price) : 0,
                    price_currency: token.price_currency || defaultCurrency,
                    price_timestamp: token.price_timestamp || null
                };
            });

            // console.log('saveToSnapshot - Converted tokens:', snapshotTokens.length);

            snapshotMap[keyLower] = snapshotTokens;
            // console.log('saveToSnapshot - Map now has keys:', Object.keys(snapshotMap));

            const saved = await snapshotDbSet(SNAPSHOT_DB_CONFIG.snapshotKey, snapshotMap);
            // console.log('saveToSnapshot - Save result:', saved);

            return saved;
        } catch(error) {
            // console.error('saveToSnapshot failed:', error);
            return false;
        }
    }

    // ====================
    // INDODAX ENRICHMENT FROM TOKEN DATABASE
    // ====================

    async function enrichIndodaxFromTokenDatabase(chainKey, indodaxTokens) {
        try {
            // Get TOKEN database key
            const chainUpper = String(chainKey || '').toUpperCase();
            const tokenDbKey = `TOKEN_${chainUpper}`;

            // console.log(`[INDODAX] Looking up ${indodaxTokens.length} tokens in ${tokenDbKey}...`);

            // Load TOKEN database
            let tokenDatabase = [];
            try {
                // Try to get from localStorage/indexedDB
                if (typeof window !== 'undefined') {
                    // Try window.getFromLocalStorage first (if available)
                    if (typeof window.getFromLocalStorage === 'function') {
                        tokenDatabase = window.getFromLocalStorage(tokenDbKey, []);
                    } else if (typeof localStorage !== 'undefined') {
                        const raw = localStorage.getItem(tokenDbKey);
                        tokenDatabase = raw ? JSON.parse(raw) : [];
                    }
                }
            } catch(err) {
                // console.error(`[INDODAX] Failed to load ${tokenDbKey}:`, err);
                tokenDatabase = [];
            }

            if (!Array.isArray(tokenDatabase) || tokenDatabase.length === 0) {
                // console.warn(`[INDODAX] ${tokenDbKey} is empty or not found. Cannot enrich.`);
                return indodaxTokens;
            }

            // console.log(`[INDODAX] Found ${tokenDatabase.length} tokens in ${tokenDbKey}`);

            // Create lookup map by nama koin (case-insensitive)
            const tokenLookup = new Map();
            tokenDatabase.forEach(token => {
                const names = [
                    String(token.name || '').trim().toLowerCase(),
                    String(token.token_name || '').trim().toLowerCase(),
                    String(token.symbol_in || '').trim().toLowerCase(),
                    String(token.symbol || '').trim().toLowerCase()
                ].filter(n => n.length > 0);

                names.forEach(name => {
                    if (!tokenLookup.has(name)) {
                        tokenLookup.set(name, token);
                    }
                });
            });

            // console.log(`[INDODAX] Created lookup map with ${tokenLookup.size} unique names`);

            // Enrich INDODAX tokens
            let matchCount = 0;
            const enriched = indodaxTokens.map(indoToken => {
                const tokenName = String(indoToken.token_name || indoToken.symbol_in || '').trim().toLowerCase();

                if (!tokenName) {
                    return indoToken;
                }

                // Lookup di TOKEN database berdasarkan nama
                const dbToken = tokenLookup.get(tokenName);

                if (dbToken) {
                    matchCount++;
                    const sc = String(dbToken.sc_in || dbToken.sc || '').trim();
                    const des = dbToken.des_in || dbToken.decimals || dbToken.des || '';

                    // console.log(`✅ [INDODAX] Match: ${tokenName} → SC: ${sc.slice(0, 10)}... DES: ${des}`);

                    return {
                        ...indoToken,
                        sc_in: sc || indoToken.sc_in,
                        des_in: des || indoToken.des_in,
                        decimals: des || indoToken.decimals,
                        token_name: dbToken.token_name || dbToken.name || indoToken.token_name
                    };
                }

                return indoToken;
            });

            // console.log(`[INDODAX] Enrichment complete: ${matchCount}/${indodaxTokens.length} tokens matched`);

            return enriched;
        } catch(error) {
            // console.error('[INDODAX] enrichIndodaxFromTokenDatabase failed:', error);
            return indodaxTokens; // Return original on error
        }
    }

    // ====================
    // CEX API FETCHERS (REFACTORED)
    // ====================

    async function fetchCexData(chainKey, cex) {
        try {
            const chainConfig = CONFIG_CHAINS[chainKey];
            if (!chainConfig) {
                throw new Error(`No config for chain ${chainKey}`);
            }

            const cexUpper = cex.toUpperCase();
            const chainLower = String(chainKey || '').toLowerCase();

            // console.log(`fetchCexData for ${cex} on chain ${chainLower} - Using services/cex.js`);

            let coins = [];

            // Use the unified fetchWalletStatus from services/cex.js
            if (window.App?.Services?.CEX?.fetchWalletStatus) {
                try {
                    // console.log(`Fetching wallet status for ${cexUpper} using services/cex.js...`);
                    const walletData = await window.App.Services.CEX.fetchWalletStatus(cexUpper);

                    if (walletData && Array.isArray(walletData)) {
                        // Load existing snapshot data for enrichment
                        const existingData = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
                        const keyLower = String(chainKey || '').toLowerCase();
                        const existingTokens = Array.isArray(existingData[keyLower]) ? existingData[keyLower] : [];

                        // Create lookup map by symbol and CEX
                        const existingLookup = new Map();
                        existingTokens.forEach(token => {
                            const key = `${String(token.cex || '').toUpperCase()}_${String(token.symbol_in || '').toUpperCase()}`;
                            existingLookup.set(key, token);
                        });

                        // Convert format dari services/cex.js ke format snapshot with enrichment
                        coins = walletData
                            .filter(item => {
                                // Filter by chain using existing matchesCex logic
                                return matchesCex(chainKey, item.chain);
                            })
                            .map(item => {
                                const symbol = String(item.tokenName || '').toUpperCase();
                                const lookupKey = `${cexUpper}_${symbol}`;
                                const existing = existingLookup.get(lookupKey);

                                // Extract contract address from CEX response
                                let contractAddress = '';
                                if (item.contractAddress) {
                                    // Direct field (from services/cex.js normalized response)
                                    contractAddress = String(item.contractAddress).trim();
                                } else if (existing?.sc_in) {
                                    // Fallback to existing data
                                    contractAddress = existing.sc_in;
                                }

                                return {
                                    cex: cexUpper,
                                    symbol_in: symbol,
                                    token_name: existing?.token_name || item.tokenName || '',
                                    sc_in: contractAddress, // Use contract address from CEX API
                                    tradeable: item.trading !== undefined ? !!item.trading : true, // Use trading status dari CEX API, fallback true jika tidak ada
                                    decimals: existing?.des_in || existing?.decimals || '',
                                    des_in: existing?.des_in || existing?.decimals || '',
                                    deposit: item.depositEnable ? '1' : '0',
                                    // Perubahan: Kosongkan symbol_out dan sc_out saat mengambil data dari CEX
                                    symbol_out: '',
                                    sc_out: '',
                                    des_out: 0,
                                    withdraw: item.withdrawEnable ? '1' : '0',
                                    feeWD: parseFloat(item.feeWDs || 0)
                                };
                            });

                        // console.log(`Converted ${coins.length} coins from ${cexUpper} wallet API data`);
                    } else {
                        // console.warn(`${cexUpper}: No wallet data returned from services/cex.js`);
                    }
                } catch(serviceError) {
                    // console.error(`${cexUpper} wallet service failed:`, serviceError);
                    // Will fallback to cached data below
                }
            } else {
                // console.warn('window.App.Services.CEX.fetchWalletStatus not available, falling back to cached data');
            }

            // Fallback: Use cached data if service failed or no data returned
            if (coins.length === 0) {
                // console.log(`${cexUpper}: Using cached snapshot data as fallback`);
                const snapshotMap = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
                const keyLower = String(chainKey || '').toLowerCase();
                const allTokens = Array.isArray(snapshotMap[keyLower]) ? snapshotMap[keyLower] : [];

                coins = allTokens.filter(token => {
                    return String(token.cex || '').toUpperCase() === cexUpper;
                });

                // console.log(`Using cached data for ${cexUpper}: ${coins.length} coins`);

                if (coins.length === 0) {
                    // console.warn(`${cexUpper}: No service data and no cached data available`);
                }
            }

            // console.log(`fetchCexData for ${cex}: fetched ${coins.length} coins total`);
            return coins;
        } catch(error) {
            // console.error(`fetchCexData failed for ${cex}:`, error);
            return [];
        }
    }

    // ====================
    // WEB3 VALIDATION
    // ====================

    // Enhanced validate token data with database optimization + AUTO-SAVE per-koin
    async function validateTokenData(token, snapshotMap, symbolLookupMap, chainKey, progressCallback, errorCount, web3Cache = null) {
        let sc = String(token.sc_in || '').toLowerCase().trim();
        const symbol = String(token.symbol_in || '').toUpperCase();
        const cexUp = String(token.cex || token.exchange || '').toUpperCase();
        const chainUpper = String(chainKey || '').toUpperCase();

        // Update progress callback if provided
        if (progressCallback) {
            progressCallback(`Validating ${symbol}...`);
        }

        if (!sc || sc === '0x') {
            // Token tidak memiliki SC, coba cari di database berdasarkan simbol / nama
            let matched = null;
            if (symbolLookupMap instanceof Map) {
                const keyByCexSymbol = `CEX:${cexUp}__SYM:${symbol}`;
                if (symbolLookupMap.has(keyByCexSymbol)) {
                    matched = symbolLookupMap.get(keyByCexSymbol);
                }
                if (!matched && symbolLookupMap.has(`SYM:${symbol}`)) {
                    matched = symbolLookupMap.get(`SYM:${symbol}`);
                }
                if (!matched) {
                    const tokenNameLower = String(token.token_name || token.name || '').toLowerCase();
                    if (tokenNameLower && symbolLookupMap.has(`NAME:${tokenNameLower}`)) {
                        matched = symbolLookupMap.get(`NAME:${tokenNameLower}`);
                    }
                }
            }

            if (matched) {
                const matchedSc = String(matched.sc_in || matched.sc || '').trim();
                if (matchedSc && matchedSc !== '0x') {
                    token.sc_in = matchedSc;
                    sc = matchedSc.toLowerCase();
                    // console.log(`✅ ${symbol}: SC resolved from database lookup (${token.sc_in})`);

                    const matchedDecimals = matched.des_in ?? matched.decimals ?? matched.des ?? matched.dec_in;
                    if (Number.isFinite(matchedDecimals) && matchedDecimals > 0) {
                        token.des_in = matchedDecimals;
                        token.decimals = matchedDecimals;
                        // console.log(`✅ ${symbol}: Decimals resolved from database lookup (${token.des_in})`);
                    }

                    if (!token.token_name && matched.token_name) {
                        token.token_name = matched.token_name;
                    }

                    // Perbarui cache untuk pencarian berikutnya
                    snapshotMap[sc] = {
                        ...matched,
                        sc: sc
                    };
                }
            }

            if (!sc || sc === '0x') {
                // console.log(`ℹ️ ${symbol}: No contract address provided and no match found in database. Skipping Web3 validation.`);
                return token;
            }
        }

        // Check if DES is missing
        const needsDecimals = !token.des_in || token.des_in === 0 || token.des_in === '' ||
                             !token.decimals || token.decimals === 0 || token.decimals === '';

        if (needsDecimals) {
            // Step 1: Lookup in snapshot database first (fastest)
            const existing = snapshotMap[sc];
            if (existing && existing.des_in && existing.des_in > 0) {
                token.des_in = existing.des_in;
                token.decimals = existing.des_in;
                // Also update name and symbol if available in cached data
                if (existing.token_name && !token.token_name) {
                    token.token_name = existing.token_name;
                }
                if (existing.symbol_in && existing.symbol_in !== symbol) {
                    token.symbol_in = existing.symbol_in;
                }
                // console.log(`✅ ${symbol}: DES found in database (${token.des_in})`);
                return token;
            }

            // Step 2: If not found in database, fetch from web3
            if (progressCallback) {
                progressCallback(`Fetching Web3 data for ${symbol}...`);
            }

            try {
                // console.log(`🔍 ${symbol}: Fetching decimals from Web3 for ${sc}`);
                const web3Data = await fetchWeb3TokenData(sc, chainKey, web3Cache);

                if (web3Data && web3Data.decimals && web3Data.decimals > 0) {
                    token.des_in = web3Data.decimals;
                    token.decimals = web3Data.decimals;

                    // Update token metadata if available from web3
                    if (web3Data.name && web3Data.name.trim()) {
                        token.token_name = web3Data.name;
                    }
                    if (web3Data.symbol && web3Data.symbol.trim()) {
                        token.symbol_in = web3Data.symbol.toUpperCase();
                    }

                    // console.log(`✅ ${symbol}: DES fetched from Web3 (${token.des_in})`);

                    // Update snapshotMap for future lookups in the same session
                    snapshotMap[sc] = {
                        ...token,
                        sc: sc
                    };
                } else {
                    // Set default decimals 18 jika web3 tidak berhasil
                    token.des_in = 18;
                    token.decimals = 18;
                    // console.warn(`⚠️ ${symbol}: Using default decimals (18) - Web3 returned no data`);
                }
            } catch(e) {
                // Set default decimals 18 jika error
                token.des_in = 18;
                token.decimals = 18;

                // Show toast error for Web3 fetch failure (with more details)
                // Only show every 5th error to avoid spam
                if (typeof toast !== 'undefined' && toast.error) {
                    const showToast = !errorCount || (errorCount.web3 % 5 === 0);

                    if (showToast) {
                        const scShort = sc.length > 12 ? `${sc.slice(0, 8)}...${sc.slice(-4)}` : sc;
                        const errorMsg = e.message || 'RPC request failed';

                        toast.error(
                            `❌ Web3 Error [${chainUpper}]\n` +
                            `Token: ${symbol}\n` +
                            `SC: ${scShort}\n` +
                            `Error: ${errorMsg}`,
                            {
                                duration: 4000,
                                position: 'bottom-right'
                            }
                        );
                    }
                }

                // Increment error count if provided
                if (errorCount && errorCount.web3 !== undefined) {
                    errorCount.web3++;
                }

                // console.warn(`❌ ${symbol}: Web3 fetch failed for ${sc}, using default decimals (18):`, e.message);
            }
        } else {
            // console.log(`✅ ${symbol}: DES already available (${token.des_in})`);
        }

        if (symbolLookupMap instanceof Map) {
            const symKey = `SYM:${symbol}`;
            symbolLookupMap.set(symKey, token);
            if (cexUp) {
                symbolLookupMap.set(`CEX:${cexUp}__SYM:${symbol}`, token);
            }
            const nameKey = String(token.token_name || token.name || '').toLowerCase();
            if (nameKey) {
                symbolLookupMap.set(`NAME:${nameKey}`, token);
            }
        }

        // ========== AUTO-SAVE PER-KOIN JIKA DATA LENGKAP ==========
        // Cek apakah token sudah lengkap (symbol, sc, des)
        const isComplete = token.symbol_in &&
                          token.sc_in &&
                          token.sc_in !== '0x' &&
                          token.des_in &&
                          Number.isFinite(token.des_in) &&
                          token.des_in > 0;

        if (isComplete) {
            try {
                // Load existing snapshot
                const snapshotMapFull = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
                const keyLower = String(chainKey || '').toLowerCase();
                const existingTokensFull = Array.isArray(snapshotMapFull[keyLower]) ? snapshotMapFull[keyLower] : [];

                // Create token map
                const tokenMap = new Map();
                existingTokensFull.forEach(existingToken => {
                    const key = `${existingToken.cex}_${existingToken.symbol_in}_${existingToken.sc_in || 'NOSC'}`;
                    tokenMap.set(key, existingToken);
                });

                // Add/update THIS token
                const tokenKey = `${token.cex}_${token.symbol_in}_${token.sc_in || 'NOSC'}`;
                tokenMap.set(tokenKey, token);

                // Convert map back to array
                const mergedList = Array.from(tokenMap.values());

                // Save to database
                await saveToSnapshot(chainKey, mergedList);

                // console.log(`💾 [AUTO-SAVE] ${symbol}: Saved to database (SC: ${token.sc_in.slice(0, 8)}..., DES: ${token.des_in})`);
            } catch(saveErr) {
                console.error(`❌ [AUTO-SAVE] ${symbol}: Failed to save -`, saveErr.message);
                // Don't throw error, just log - continue processing other tokens
            }
        }
        // ==========================================================

        return token;
    }

    // Fetch token data from web3 (decimals, symbol, name)
    async function fetchWeb3TokenData(contractAddress, chainKey, web3Cache = null) {
        const chainConfig = CONFIG_CHAINS[chainKey];
        if (!chainConfig) {
            throw new Error(`No config for chain ${chainKey}`);
        }

        const contract = String(contractAddress || '').toLowerCase().trim();

        if (!contract || contract === '0x') {
            return null;
        }

        // ========== CHECK PERSISTENT CACHE FIRST ==========
        if (web3Cache) {
            const cached = getWeb3CacheEntry(web3Cache, contract, chainKey);
            if (cached) {
                console.log(`[Web3 Cache] HIT for ${contract} on ${chainKey}`);
                return cached;
            }
        }
        // ==================================================

        // ========== REQUEST DEDUPLICATION ==========
        // If there's already a pending request for this contract+chain, reuse it
        const requestKey = `${chainKey}:${contract}`;
        if (WEB3_PENDING_REQUESTS.has(requestKey)) {
            console.log(`[Web3 Dedup] Waiting for pending request: ${contract} on ${chainKey}`);
            return await WEB3_PENDING_REQUESTS.get(requestKey);
        }
        // ===========================================

        try {
            // Use RPCManager for RPC access (auto fallback to defaults)
            const rpc = (typeof window !== 'undefined' && window.RPCManager && typeof window.RPCManager.getRPC === 'function')
                ? window.RPCManager.getRPC(chainKey)
                : null;

            if (!rpc) {
                throw new Error(`No RPC configured for chain ${chainKey}`);
            }

            // Create fetch promise and store it for deduplication
            const fetchPromise = (async () => {
                try {
                    // Log RPC source for debugging
                    const rpcSource = (typeof getRPC === 'function' && getRPC(chainKey) !== chainConfig.RPC)
                        ? 'SETTING_SCANNER (Custom RPC)'
                        : 'CONFIG_CHAINS (Default RPC)';

                  //  console.log(`[Web3] Fetching data for ${contract} on ${chainKey} via ${rpc} (${rpcSource})`);

                    // ABI method signatures for ERC20
                    const decimalsData = '0x313ce567'; // decimals()
                    const symbolData = '0x95d89b41';   // symbol()
                    const nameData = '0x06fdde03';     // name()

                    // Batch RPC call with timeout and AbortController
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

                    try {
                        const batchResponse = await fetch(rpc, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify([
                                { jsonrpc: '2.0', method: 'eth_call', params: [{ to: contract, data: decimalsData }, 'latest'], id: 1 },
                                { jsonrpc: '2.0', method: 'eth_call', params: [{ to: contract, data: symbolData }, 'latest'], id: 2 },
                                { jsonrpc: '2.0', method: 'eth_call', params: [{ to: contract, data: nameData }, 'latest'], id: 3 }
                            ]),
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);

                        if (!batchResponse.ok) {
                            const errorText = await batchResponse.text().catch(() => 'Unknown error');
                            throw new Error(`RPC batch request failed (${batchResponse.status}): ${errorText.substring(0, 200)}`);
                        }

                        let results;
                        try {
                            results = await batchResponse.json();
                        } catch(jsonErr) {
                            throw new Error(`RPC response is not valid JSON: ${jsonErr.message}`);
                        }

                        if (!Array.isArray(results)) {
                            // Log actual response untuk debugging
                            console.error(`[RPC ERROR] Expected array, got:`, typeof results, results);

                            // Check jika response adalah error object
                            if (results && results.error) {
                                throw new Error(`RPC Error: ${results.error.message || JSON.stringify(results.error)}`);
                            }

                            throw new Error(`GAGAL MENDAPATKAN DESIMAL KOIN, SILAKAN COBA GANTI RPC`);
                        }

                        const decimalsResult = results.find(r => r.id === 1)?.result;
                        const symbolResult = results.find(r => r.id === 2)?.result;
                        const nameResult = results.find(r => r.id === 3)?.result;

                        // Fetch decimals
                        let decimals = 18; // default
                        if (decimalsResult && decimalsResult !== '0x' && !results.find(r => r.id === 1)?.error) {
                            decimals = parseInt(decimalsResult, 16);
                        }

                        // Fetch symbol
                        let symbol = '';
                        if (symbolResult && symbolResult !== '0x' && !results.find(r => r.id === 2)?.error) {
                            symbol = decodeAbiString(symbolResult);
                        }

                        // Fetch name
                        let name = '';
                        if (nameResult && nameResult !== '0x' && !results.find(r => r.id === 3)?.error) {
                            name = decodeAbiString(nameResult);
                        }

                        const result = { decimals, symbol, name };

                        // ========== SAVE TO CACHE ==========
                        if (web3Cache) {
                            setWeb3CacheEntry(web3Cache, contract, chainKey, result);
                           // console.log(`[Web3 Cache] SAVED for ${contract} on ${chainKey}`);
                        }
                        // ===================================

                        return result;
                    } catch(fetchError) {
                        clearTimeout(timeoutId);
                        if (fetchError.name === 'AbortError') {
                            throw new Error(`Web3 RPC timeout after 30s for ${contract}`);
                        }
                        throw fetchError;
                    }
                } finally {
                    // Remove from pending requests when done
                    WEB3_PENDING_REQUESTS.delete(requestKey);
                }
            })();

            // Store promise for deduplication
            WEB3_PENDING_REQUESTS.set(requestKey, fetchPromise);

            return await fetchPromise;
        } catch(error) {
            // Show toast for critical RPC/network errors
            const isNetworkError = error.message && (
                error.message.includes('fetch') ||
                error.message.includes('network') ||
                error.message.includes('timeout') ||
                error.message.includes('RPC')
            );

            if (isNetworkError && typeof toast !== 'undefined' && toast.error) {
                toast.error(`🌐 RPC Error (${chainKey}): ${error.message}`, {
                    duration: 4000,
                    position: 'bottom-right'
                });
            }

            // console.error('fetchWeb3TokenData failed:', error);
            return null;
        }
    }

    // Helper: Decode ABI-encoded string from hex
    function decodeAbiString(hexString) {
        try {
            // Remove 0x prefix
            let hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;

            // ABI string encoding: first 32 bytes = offset, next 32 bytes = length, then data
            // Skip first 64 chars (offset), next 64 chars for length
            const lengthHex = hex.slice(64, 128);
            const length = parseInt(lengthHex, 16);

            // Get actual string data
            const dataHex = hex.slice(128, 128 + (length * 2));

            // Convert hex to string
            let str = '';
            for (let i = 0; i < dataHex.length; i += 2) {
                const charCode = parseInt(dataHex.substr(i, 2), 16);
                if (charCode !== 0) { // Skip null bytes
                    str += String.fromCharCode(charCode);
                }
            }

            return str;
        } catch(e) {
            // console.warn('Failed to decode ABI string:', e);
            return '';
        }
    }

    // ====================
    // MAIN SNAPSHOT PROCESS
    // ====================

    async function processSnapshotForCex(chainKey, selectedCex, perTokenCallback = null) {
        if (!selectedCex || selectedCex.length === 0) return;

        const chainConfig = CONFIG_CHAINS[chainKey];
        if (!chainConfig) return;

        // Get chain display name
        const chainDisplay = chainKey === 'multichain' ? 'MULTICHAIN' :
                            (chainConfig.Nama_Chain || chainKey).toUpperCase();

        // Modal and form selectors
        const modalSelector = '#sync-modal';
        const formElementsSelector = `${modalSelector} input, ${modalSelector} select, ${modalSelector} button`;

        // Disable all form inputs during process
        document.querySelectorAll(formElementsSelector).forEach(el => el.disabled = true);

        // Show modern overlay using SnapshotOverlay
        if (window.SnapshotOverlay) {
            window.SnapshotOverlay.show(
                `Update Snapshot ${chainDisplay}`,
                `Memproses ${selectedCex.length} exchanger...`
            );
        }

        try {
            // ========== LOAD WEB3 CACHE ==========
            const web3Cache = await loadWeb3Cache();
            //console.log('[Web3 Cache] Loaded cache with', Object.keys(web3Cache).length, 'entries');
            // =====================================

            // Load existing snapshot data
            const existingData = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
            const keyLower = String(chainKey || '').toLowerCase();
            const existingTokens = Array.isArray(existingData[keyLower]) ? existingData[keyLower] : [];

            const snapshotMap = {}; // Map by SC address for quick lookup
            const snapshotSymbolMap = new Map(); // Map by symbol/name for SC-less resolution
            existingTokens.forEach(token => {
                const sc = String(token.sc_in || token.sc || '').toLowerCase();
                if (sc) snapshotMap[sc] = token;
                const sym = String(token.symbol_in || token.symbol || '').toUpperCase();
                const cexTok = String(token.cex || token.exchange || '').toUpperCase();
                if (sym) {
                    const symKey = `SYM:${sym}`;
                    if (!snapshotSymbolMap.has(symKey)) {
                        snapshotSymbolMap.set(symKey, token);
                    }
                    if (cexTok) {
                        const cexSymKey = `CEX:${cexTok}__SYM:${sym}`;
                        if (!snapshotSymbolMap.has(cexSymKey)) {
                            snapshotSymbolMap.set(cexSymKey, token);
                        }
                    }
                }
                const nameKey = String(token.token_name || token.name || '').toLowerCase();
                if (nameKey && !snapshotSymbolMap.has(`NAME:${nameKey}`)) {
                    snapshotSymbolMap.set(`NAME:${nameKey}`, token);
                }
            });

        // ========== PHASE 1: FETCH CEX DATA (WALLET STATUS) ==========
        // Process each CEX - INDODAX terakhir untuk lookup TOKEN database
        let allTokens = [];
        const cexResults = new Map(); // Track hasil per CEX
        const failedCexList = []; // Track CEX yang gagal

        // Pisahkan INDODAX dari CEX lain
        const regularCex = selectedCex.filter(c => String(c).toUpperCase() !== 'INDODAX');
        const hasIndodax = selectedCex.some(c => String(c).toUpperCase() === 'INDODAX');
        const orderedCex = [...regularCex];
        if (hasIndodax) orderedCex.push('INDODAX');

        for (let i = 0; i < orderedCex.length; i++) {
            const cex = orderedCex[i];
            const cexUpper = String(cex).toUpperCase();
            const isIndodax = cexUpper === 'INDODAX';

            // Update overlay progress for CEX fetch
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.updateMessage(
                    `Update Snapshot ${chainDisplay}`,
                    `Mengambil data wallet dari ${cex}...`
                );
                window.SnapshotOverlay.updateProgress(
                    i,
                    orderedCex.length,
                    `CEX ${i + 1}/${orderedCex.length}: ${cex}`
                );
            }

            // Fetch CEX data (deposit/withdraw status from wallet API)
            let cexTokens;
            let fetchError = null;

            try {
                cexTokens = await fetchCexData(chainKey, cex);
            } catch(error) {
                fetchError = error;
                cexTokens = null;
            }

            // ========== VALIDASI HASIL FETCH CEX ==========
            if (!cexTokens || cexTokens.length === 0 || fetchError) {
                failedCexList.push(cexUpper);
                cexResults.set(cexUpper, { success: false, count: 0, error: fetchError?.message || 'No data returned' });

                const errorDetail = fetchError?.message || 'Tidak ada data yang dikembalikan dari API';

                // Show error in overlay
                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateMessage(
                        `Update Snapshot ${chainDisplay}`,
                        `❌ ${cexUpper}: Gagal fetch data - ${errorDetail}`
                    );
                }

                // Log error untuk debugging
                console.error(`❌ [${cexUpper}] Failed to fetch wallet data:`, errorDetail);

                // Show toast error immediately untuk setiap CEX yang gagal
                if (typeof toast !== 'undefined' && toast.error) {
                    toast.error(
                        `❌ ${cexUpper} gagal fetch data!\n\n` +
                        `Error: ${errorDetail}\n\n` +
                        `Silakan cek:\n` +
                        `- API Key di menu Setting\n` +
                        `- Koneksi internet\n` +
                        `- Status API ${cexUpper}`,
                        {
                            duration: 10000,
                            position: 'top-center'
                        }
                    );
                }

                // Lanjut ke CEX berikutnya
                continue;
            }

            // CEX berhasil
            cexResults.set(cexUpper, { success: true, count: cexTokens.length });

            // Special handling untuk INDODAX: lookup TOKEN database
            if (isIndodax && cexTokens.length > 0) {
                cexTokens = await enrichIndodaxFromTokenDatabase(chainKey, cexTokens);
            }

            allTokens = allTokens.concat(cexTokens);

            await sleep(100); // Small delay between CEX
        }

        // ========== VALIDASI HASIL AKHIR SEMUA CEX ==========
        const successCount = orderedCex.length - failedCexList.length;

        // Jika SEMUA CEX GAGAL, hentikan proses dengan detail error
        if (failedCexList.length === orderedCex.length) {
            // Build detail error message dengan info dari setiap CEX
            let errorDetails = '';
            failedCexList.forEach(cexName => {
                const result = cexResults.get(cexName);
                const errorMsg = result?.error || 'Unknown error';
                errorDetails += `\n• ${cexName}: ${errorMsg}`;
            });

            const errorMsg = `❌ SEMUA CEX GAGAL MENGAMBIL DATA KOIN!\n\nCEX yang gagal: ${failedCexList.join(', ')}${errorDetails}\n\n` +
                            `Kemungkinan penyebab:\n` +
                            `- API Key tidak valid atau expired\n` +
                            `- Network/koneksi bermasalah\n` +
                            `- Rate limit dari CEX terlampaui\n` +
                            `- Service CEX sedang down/maintenance\n\n` +
                            `LANGKAH SELANJUTNYA:\n` +
                            `1. Cek API Key di menu Setting\n` +
                            `2. Pastikan koneksi internet stabil\n` +
                            `3. Tunggu beberapa menit (rate limit)\n` +
                            `4. Klik tombol Update lagi untuk retry`;

            // Show error in overlay (persistent - tidak auto hide)
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.showError(errorMsg, 0); // 0 = no auto-hide
            }

            // Show toast error dengan instruksi retry
            if (typeof toast !== 'undefined' && toast.error) {
                toast.error(
                    `❌ PROSES DIHENTIKAN!\n\n` +
                    `Semua CEX gagal mengambil data.\n` +
                    `Silakan cek API Key dan coba lagi.`,
                    {
                        duration: 15000,
                        position: 'top-center'
                    }
                );
            }

            // Throw error untuk dihentikan di catch block
            throw new Error(`Semua CEX gagal fetch data wallet: ${failedCexList.join(', ')}`);
        }

        // Jika SEBAGIAN CEX GAGAL, tampilkan warning detail tapi lanjut proses
        if (failedCexList.length > 0) {
            // Build detail error message untuk CEX yang gagal
            let errorDetails = '';
            failedCexList.forEach(cexName => {
                const result = cexResults.get(cexName);
                const errorMsg = result?.error || 'Unknown error';
                errorDetails += `\n• ${cexName}: ${errorMsg}`;
            });

            const warningMsg = `⚠️ ${failedCexList.length} CEX GAGAL MENGAMBIL DATA\n\n` +
                              `Gagal: ${failedCexList.join(', ')}${errorDetails}\n\n` +
                              `Berhasil: ${successCount} CEX (${allTokens.length} koin)\n\n` +
                              `CATATAN:\n` +
                              `- Proses dilanjutkan dengan CEX yang berhasil\n` +
                              `- CEX yang gagal akan di-skip\n` +
                              `- Anda bisa retry nanti untuk CEX yang gagal`;

            // Show warning toast dengan detail
            if (typeof toast !== 'undefined' && toast.warning) {
                toast.warning(warningMsg, {
                    duration: 10000,
                    position: 'top-center'
                });
            }

            // Update overlay dengan warning
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.updateMessage(
                    `Update Snapshot ${chainDisplay}`,
                    `⚠️ ${failedCexList.length} CEX gagal | Lanjut dengan ${successCount} CEX`
                );
            }

            console.warn(`[Snapshot] Partial success: ${successCount}/${orderedCex.length} CEX succeeded`, {
                failed: failedCexList,
                failedDetails: Array.from(cexResults.entries()).filter(([, v]) => !v.success),
                tokens: allTokens.length
            });
        }

        // Jika tidak ada token sama sekali (edge case)
        if (allTokens.length === 0) {
            const errorMsg = `❌ TIDAK ADA DATA KOIN!\n\n` +
                           `Semua CEX berhasil fetch tapi tidak mengembalikan data koin.\n\n` +
                           `Kemungkinan:\n` +
                           `- Chain "${chainKey}" tidak match dengan data CEX\n` +
                           `- Filter chain terlalu ketat\n` +
                           `- CEX tidak support chain ini\n\n` +
                           `Silakan cek konfigurasi chain dan coba lagi.`;

            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.showError(errorMsg, 0);
            }

            throw new Error('Tidak ada data koin yang berhasil diambil dari semua CEX');
        }

        // Validate & enrich data with PARALLEL batch processing
        if (window.SnapshotOverlay) {
            window.SnapshotOverlay.updateMessage(
                `Validasi Data ${chainDisplay}`,
                'Memulai validasi desimal dan contract address...'
            );
            window.SnapshotOverlay.updateProgress(0, allTokens.length, 'Validasi dimulai');
        }

        const enrichedTokens = [];
        let web3FetchCount = 0;
        let cachedCount = 0;
        let errorCount = 0;
        let mergedTokens = []; // Declare here for broader scope

        // Error tracking for toast throttling
        const errorTracking = {
            web3: 0,      // Web3 fetch errors
            batch: 0,     // Batch validation errors
            total: 0      // Total errors
        };

        // OPTIMIZED: Parallel batch processing configuration
        const BATCH_SIZE = 5; // Process 5 tokens concurrently
        const BATCH_DELAY = 250; // Delay between batches (ms)

        // Process tokens in parallel batches
        for (let batchStart = 0; batchStart < allTokens.length; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, allTokens.length);
            const batch = allTokens.slice(batchStart, batchEnd);
            const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(allTokens.length / BATCH_SIZE);

            // Update progress for batch
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.updateMessage(
                    `Validasi Data ${chainDisplay}`,
                    `Batch ${batchNumber}/${totalBatches} - Processing ${batch.length} tokens in parallel...`
                );
            }

            // Process batch in parallel with Promise.all
            const batchResults = await Promise.allSettled(
                batch.map(async (token, batchIndex) => {
                    const globalIndex = batchStart + batchIndex;
                    const progressPercent = Math.floor(((globalIndex + 1) / allTokens.length) * 100);

                    // Progress callback for individual token
                    const progressCallback = (message) => {
                        if (window.SnapshotOverlay && batchIndex === 0) {
                            // Only update overlay for first token in batch to avoid spam
                            const statusMsg = `${message} | Batch ${batchNumber}/${totalBatches} (${progressPercent}%)`;
                            window.SnapshotOverlay.updateProgress(globalIndex + 1, allTokens.length, statusMsg);
                        }
                    };

                    // Track pre-validation state
                    const hadDecimals = token.des_in && token.des_in > 0;
                    const hadCachedData = snapshotMap[String(token.sc_in || '').toLowerCase()];

                    // Validate token (pass errorTracking for toast throttling + web3Cache)
                    const validated = await validateTokenData(token, snapshotMap, snapshotSymbolMap, chainKey, progressCallback, errorTracking, web3Cache);

                    return {
                        validated,
                        hadDecimals,
                        hadCachedData
                    };
                })
            );

            // Process batch results
            let batchErrorCount = 0;
            const batchErrorTokens = [];

            batchResults.forEach((result, batchIndex) => {
                const globalIndex = batchStart + batchIndex;
                const token = batch[batchIndex];

                if (result.status === 'fulfilled' && result.value?.validated) {
                    const { validated, hadDecimals, hadCachedData } = result.value;
                    enrichedTokens.push(validated);

                    // Update statistics
                    if (!hadDecimals && !hadCachedData && validated.des_in) {
                        web3FetchCount++;
                    } else if (!hadDecimals && hadCachedData) {
                        cachedCount++;
                    }
                } else {
                    // Handle errors
                    errorCount++;
                    batchErrorCount++;
                    batchErrorTokens.push(token.symbol_in || '???');

                    // console.error(`Validation failed for token ${token.symbol_in}:`, result.reason);
                    enrichedTokens.push({
                        ...token,
                        des_in: 18,
                        decimals: 18
                    });
                }
            });

            // Show toast for batch errors (if any)
            if (batchErrorCount > 0 && typeof toast !== 'undefined' && toast.warning) {
                const errorMsg = batchErrorCount === 1
                    ? `⚠️ Batch ${batchNumber}: 1 token gagal validasi (${batchErrorTokens[0]})`
                    : `⚠️ Batch ${batchNumber}: ${batchErrorCount} token gagal validasi (${batchErrorTokens.slice(0, 3).join(', ')}${batchErrorCount > 3 ? '...' : ''})`;

                toast.warning(errorMsg, {
                    duration: 4000,
                    position: 'bottom-right'
                });
            }

            // Update progress after batch completion
            if (window.SnapshotOverlay) {
                const processed = Math.min(batchEnd, allTokens.length);
                const percent = Math.floor((processed / allTokens.length) * 100);
                window.SnapshotOverlay.updateProgress(
                    processed,
                    allTokens.length,
                    `Batch ${batchNumber}/${totalBatches} selesai (${percent}%) | Web3: ${web3FetchCount}, Cache: ${cachedCount}, Error: ${errorCount}`
                );
            }

            // Delay between batches (except for last batch)
            if (batchEnd < allTokens.length) {
                await sleep(BATCH_DELAY);
            }
        }

            // Show validation summary
            // console.log(`📊 Validation Summary: ${enrichedTokens.length} tokens processed`);
            // console.log(`   💾 From cache: ${cachedCount}`);

            // Show final error summary toast if there were Web3 errors
            if (errorTracking.web3 > 0 && typeof toast !== 'undefined' && toast.info) {
                toast.info(
                    `ℹ️ Web3 Validation Summary [${chainUpper}]\n` +
                    `Total: ${enrichedTokens.length} tokens\n` +
                    `✅ Cache: ${cachedCount} | 🌐 Web3: ${web3FetchCount}\n` +
                    `❌ Errors: ${errorTracking.web3} (using default decimals 18)`,
                    {
                        duration: 5000,
                        position: 'bottom-right'
                    }
                );
            }
            // console.log(`   🌐 From Web3: ${web3FetchCount}`);
            // console.log(`   ❌ Errors: ${errorCount}`);

            // ========== PHASE 3: FETCH HARGA CEX ==========
        // Setelah semua data token lengkap & tersimpan, fetch harga untuk semua koin
        if (window.SnapshotOverlay) {
            window.SnapshotOverlay.updateMessage(
                `Fetch Harga ${chainDisplay}`,
                `Mengambil harga dari ${selectedCex.length} exchanger...`
            );
        }

        const priceMapsByCex = new Map(); // Store price maps for each CEX
        const failedPriceFetchList = [];

        // Get unique CEX list from enrichedTokens
        const activeCexList = [...new Set(enrichedTokens.map(t => String(t.cex || '').toUpperCase()))].filter(c => c);

        for (let i = 0; i < activeCexList.length; i++) {
            const cexUpper = activeCexList[i];

            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.updateMessage(
                    `Fetch Harga ${chainDisplay}`,
                    `Mengambil harga dari ${cexUpper}...`
                );
                window.SnapshotOverlay.updateProgress(
                    i + 1,
                    activeCexList.length,
                    `Harga ${cexUpper} (${i + 1}/${activeCexList.length})`
                );
            }

            try {
                // Fetch price map untuk CEX ini (semua pair sekaligus)
                const priceMap = await fetchPriceMapForCex(cexUpper);

                if (!priceMap || priceMap.size === 0) {
                    throw new Error(`Price map kosong untuk ${cexUpper}`);
                }

                priceMapsByCex.set(cexUpper, {
                    map: priceMap,
                    timestamp: Date.now()
                });

                console.log(`✅ [${cexUpper}] Berhasil fetch ${priceMap.size} harga`);

                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateMessage(
                        `Fetch Harga ${chainDisplay}`,
                        `✅ ${cexUpper}: ${priceMap.size} pair harga`
                    );
                }

            } catch(error) {
                console.error(`❌ [${cexUpper}] Gagal fetch harga:`, error.message);
                failedPriceFetchList.push(cexUpper);

                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateMessage(
                        `Fetch Harga ${chainDisplay}`,
                        `❌ ${cexUpper}: Gagal fetch harga`
                    );
                }
            }

            await sleep(100); // Delay antar CEX
        }

        // Warning jika SEBAGIAN CEX gagal fetch harga (tapi lanjut proses)
        if (failedPriceFetchList.length > 0) {
            const warningMsg = `⚠️ ${failedPriceFetchList.length} CEX gagal fetch harga\n\nGagal: ${failedPriceFetchList.join(', ')}\nBerhasil: ${activeCexList.length - failedPriceFetchList.length} CEX\n\nHarga untuk CEX yang gagal akan diset ke 0.`;

            if (typeof toast !== 'undefined' && toast.warning) {
                toast.warning(warningMsg, {
                    duration: 6000,
                    position: 'top-center'
                });
            }
        }

        console.log(`📊 [Fetch Harga] ${priceMapsByCex.size}/${activeCexList.length} CEX berhasil fetch harga`);

        // ========== PHASE 4: ASSIGN HARGA KE TOKEN ==========
        // Gunakan priceMap yang sudah di-fetch di PHASE 3
        const priceEligibleTokens = enrichedTokens.filter(token => {
            const base = String(token.symbol_in || '').trim();
            const cexName = String(token.cex || '').trim();
            return base && cexName;
        });

        if (priceEligibleTokens.length > 0) {
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.updateMessage(
                    `Assign Harga ${chainDisplay}`,
                    'Menetapkan harga ke token...'
                );
            }

            const tokensByCex = new Map();
            priceEligibleTokens.forEach(token => {
                const cexName = String(token.cex || '').toUpperCase();
                if (!tokensByCex.has(cexName)) tokensByCex.set(cexName, []);
                tokensByCex.get(cexName).push(token);
            });

            let processedPriceCount = 0;
            const totalPriceCount = priceEligibleTokens.length;

            for (const [cexName, tokenList] of tokensByCex.entries()) {
                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateMessage(
                        `Assign Harga ${chainDisplay}`,
                        `Menetapkan harga dari ${cexName}...`
                    );
                }

                // Ambil priceMap yang sudah di-fetch di PHASE 1
                const priceData = priceMapsByCex.get(cexName);

                if (!priceData || !priceData.map) {
                    // CEX ini gagal fetch harga di PHASE 1, skip
                    console.warn(`[${cexName}] No price data available (failed in PHASE 1), skipping price assignment`);

                    // Set semua token di CEX ini ke harga 0
                    tokenList.forEach(token => {
                        const cexUpper = String(cexName || '').toUpperCase();
                        const quoteSymbol = (cexUpper === 'INDODAX') ? 'IDR' : (String(token.symbol_out || '').trim() || 'USDT');

                        token.current_price = 0;
                        token.price_currency = quoteSymbol;
                        token.price_timestamp = Date.now();
                    });

                    continue;
                }

                const priceMap = priceData.map;
                const priceTimestamp = priceData.timestamp;

                // Assign harga ke setiap token (TIDAK ADA API REQUEST)
                // Use for loop untuk bisa yield control ke UI dengan setTimeout
                const assignPrices = async () => {
                    const CHUNK_SIZE = 100; // Process 100 tokens at a time

                    for (let i = 0; i < tokenList.length; i++) {
                        const token = tokenList[i];
                        processedPriceCount += 1;
                        const cexUpper = String(cexName || '').toUpperCase();

                        // Set quote symbol based on CEX - INDODAX always uses IDR
                        const quoteSymbol = (cexUpper === 'INDODAX') ? 'IDR' : (String(token.symbol_out || '').trim() || 'USDT');

                        // Update progress LEBIH SERING untuk banyak token
                        const updateInterval = totalPriceCount > 1000 ? 50 : 10;
                        if (window.SnapshotOverlay && processedPriceCount % updateInterval === 0) {
                            window.SnapshotOverlay.updateProgress(
                                processedPriceCount,
                                totalPriceCount,
                                `${cexName}: ${processedPriceCount}/${totalPriceCount}`
                            );
                        }

                        // Lookup harga dari priceMap (SUDAH DI MEMORY, CEPAT)
                        const price = resolvePriceFromMap(cexName, priceMap, token.symbol_in, quoteSymbol);

                        if (Number.isFinite(price) && price > 0) {
                            token.current_price = Number(price);
                            token.price_currency = quoteSymbol;
                        } else {
                            token.current_price = 0;
                            token.price_currency = quoteSymbol;
                        }
                        token.price_timestamp = priceTimestamp;

                        // Callback untuk update UI - DIBATASI untuk performa
                        if (typeof perTokenCallback === 'function' && i % 10 === 0) {
                            try {
                                token.__notified = true;
                                perTokenCallback({ ...token });
                            } catch(cbErr) {
                                // console.error('perTokenCallback failed:', cbErr);
                            }
                        }

                        // Yield control ke UI setiap CHUNK_SIZE tokens
                        if (i > 0 && i % CHUNK_SIZE === 0) {
                            await sleep(1); // Yield to browser UI thread
                        }
                    }
                };

                await assignPrices();

                console.log(`✅ [${cexName}] Assigned harga ke ${tokenList.length} token`);
            }

            // Final progress update
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.updateProgress(
                    totalPriceCount,
                    totalPriceCount,
                    `Selesai (${totalPriceCount} token)`
                );
            }

            // Callback untuk token yang belum di-notify
            if (typeof perTokenCallback === 'function') {
                enrichedTokens.forEach(token => {
                    if (token.__notified) return;
                    try {
                        token.__notified = true;
                        perTokenCallback({ ...token });
                    } catch(cbErr) {
                        // console.error('perTokenCallback failed:', cbErr);
                    }
                });
            }

            // Cleanup notification flag
            enrichedTokens.forEach(token => {
                if (token && token.__notified) {
                    try { delete token.__notified; } catch(_) {}
                }
            });
        }

            // ========== PHASE 5: UPDATE HARGA DI DATABASE ==========
            // Update database dengan harga yang sudah di-assign
            if (enrichedTokens.length > 0) {
                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateMessage(
                        `Update Database ${chainDisplay}`,
                        `Menyimpan ${enrichedTokens.length} koin ke database...`
                    );
                    window.SnapshotOverlay.updateProgress(
                        0,
                        100,
                        'Loading existing data...'
                    );
                }

                console.log(`📦 [Database] Loading existing tokens for ${chainKey}...`);

                // Load all existing tokens for this chain
                const snapshotMapFull = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
                const existingTokensFull = Array.isArray(snapshotMapFull[keyLower]) ? snapshotMapFull[keyLower] : [];

                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateProgress(
                        30,
                        100,
                        `Merging ${enrichedTokens.length} tokens...`
                    );
                }

                console.log(`📦 [Database] Existing tokens: ${existingTokensFull.length}, New tokens: ${enrichedTokens.length}`);

                // Create map by unique key: CEX + symbol_in + sc_in
                const tokenMap = new Map();
                existingTokensFull.forEach(token => {
                    const key = `${token.cex}_${token.symbol_in}_${token.sc_in || 'NOSC'}`;
                    tokenMap.set(key, token);
                });

                // Update tokens dengan harga terbaru
                enrichedTokens.forEach(token => {
                    const key = `${token.cex}_${token.symbol_in}_${token.sc_in || 'NOSC'}`;
                    tokenMap.set(key, token); // This will update existing with latest price
                });

                // Convert map back to array
                mergedTokens = Array.from(tokenMap.values());

                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateProgress(
                        60,
                        100,
                        `Saving ${mergedTokens.length} tokens...`
                    );
                }

                console.log(`📦 [Database] Saving ${mergedTokens.length} total tokens to IndexedDB...`);

                // Save merged data with updated prices
                await saveToSnapshot(chainKey, mergedTokens);

                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateProgress(
                        100,
                        100,
                        'Database updated!'
                    );
                }

                const summaryMsg = `Snapshot updated: ${enrichedTokens.length} tokens refreshed (Cache: ${cachedCount}, Web3: ${web3FetchCount}, Errors: ${errorCount}), total ${mergedTokens.length} tokens in database`;
                console.log(`✅ [Database] ${summaryMsg}`);

                // Small delay untuk memastikan save selesai
                await sleep(500);

                // Show success message
                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.showSuccess(
                        `${enrichedTokens.length} koin berhasil diperbarui dari ${selectedCex.join(', ')}`
                    );
                }
            }

            // Reload modal with fresh data
            if (typeof window.loadSyncTokensFromSnapshot === 'function') {
                const loaded = await window.loadSyncTokensFromSnapshot(chainKey, true);
                if (loaded) {
                    $('#sync-snapshot-status').text(`Updated: ${enrichedTokens.length} tokens from ${selectedCex.join(', ')}`);
                    // Enhanced success notification
                    if (typeof toast !== 'undefined' && toast.success) {
                        toast.success(`✅ Update koin selesai: ${enrichedTokens.length} koin diperbarui dari ${selectedCex.join(', ')}`);
                    }
                }
            }

            // Return success result
            return {
                success: true,
                totalTokens: enrichedTokens.length,
                totalInDatabase: mergedTokens.length,
                tokens: enrichedTokens,
                cexSources: selectedCex,
                statistics: {
                    cached: cachedCount,
                    web3: web3FetchCount,
                    errors: errorCount
                }
            };

        } catch(error) {
            // console.error('Snapshot process failed:', error);

            // Show error in overlay
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.showError(error.message || 'Unknown error');
            }

            if (typeof toast !== 'undefined' && toast.error) {
                toast.error(`❌ Update koin gagal: ${error.message || 'Unknown error'}`);
            }

            // Return error result
            return {
                success: false,
                error: error.message || 'Unknown error',
                totalTokens: 0,
                cexSources: selectedCex
            };
        } finally {
            // ========== SAVE WEB3 CACHE ==========
            // Save cache after all processing (success or error)
            try {
                if (web3Cache) {
                    await saveWeb3Cache(web3Cache);
                    console.log('[Web3 Cache] Saved cache with', Object.keys(web3Cache).length, 'entries');
                }
            } catch(e) {
                console.warn('[Web3 Cache] Failed to save cache:', e);
            }
            // =====================================

            // Re-enable all form inputs
            document.querySelectorAll(formElementsSelector).forEach(el => el.disabled = false);
        }
    }

    // ========================================
    // REMOVED: Incomplete NEW SYNCHRONIZATION CONCEPT
    // ========================================
    // processCexSelection() has been removed - use processSnapshotForCex() instead
    // This concept was incomplete (missing enrichTokenWithDecimals function)
    // and duplicated functionality already present in processSnapshotForCex()

    // ====================
    // EXPORT TO GLOBAL
    // ====================

    try {
        window.snapshotDbGet = snapshotDbGet;
        window.snapshotDbSet = snapshotDbSet;
    } catch(_) {}

    // ====================
    // LIGHTWEIGHT WALLET STATUS CHECK
    // ====================
    // For Update Wallet Exchanger - only check deposit/withdraw status without enrichment

    async function checkWalletStatusOnly(chainKey, selectedCex) {
        if (!selectedCex || selectedCex.length === 0) {
            return { success: false, error: 'No CEX selected', tokens: [] };
        }

        const chainConfig = CONFIG_CHAINS[chainKey];
        if (!chainConfig) {
            return { success: false, error: `No config for chain ${chainKey}`, tokens: [] };
        }

        try {
            // Get chain display name
            const chainDisplay = chainKey === 'multichain' ? 'MULTICHAIN' :
                                (chainConfig.Nama_Chain || chainKey).toUpperCase();
            const cexList = selectedCex.join(', ');

            // Show modern overlay
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.show(
                    `Cek Wallet ${chainDisplay}`,
                    `Memproses ${selectedCex.length} exchanger: ${cexList}`
                );
            }

            // Load existing snapshot for enrichment (decimals, SC, etc)
            const existingData = await snapshotDbGet(SNAPSHOT_DB_CONFIG.snapshotKey) || {};
            const keyLower = String(chainKey || '').toLowerCase();
            const existingTokens = Array.isArray(existingData[keyLower]) ? existingData[keyLower] : [];

            // Create lookup maps
            const existingLookup = new Map();
            existingTokens.forEach(token => {
                const key = `${String(token.cex || '').toUpperCase()}_${String(token.symbol_in || '').toUpperCase()}`;
                existingLookup.set(key, token);
            });

            let allTokens = [];
            let failedCexes = [];

            // Process each CEX - INDODAX terakhir untuk lookup TOKEN database
            const regularCex = selectedCex.filter(c => String(c).toUpperCase() !== 'INDODAX');
            const hasIndodax = selectedCex.some(c => String(c).toUpperCase() === 'INDODAX');
            const orderedCex = [...regularCex];
            if (hasIndodax) orderedCex.push('INDODAX');

            // Process each CEX
            for (let i = 0; i < orderedCex.length; i++) {
                const cex = orderedCex[i];
                const cexUpper = cex.toUpperCase();
                const isIndodax = cexUpper === 'INDODAX';

                // Update overlay with current CEX
                if (window.SnapshotOverlay) {
                    window.SnapshotOverlay.updateMessage(
                        `Cek Wallet ${chainDisplay}`,
                        `Mengambil data dari ${cexUpper}...`
                    );
                    window.SnapshotOverlay.updateProgress(
                        i + 1,
                        selectedCex.length,
                        `${cexUpper} (${i + 1}/${selectedCex.length})`
                    );
                }

                try {
                    // Fetch wallet status from services/cex.js
                    if (window.App?.Services?.CEX?.fetchWalletStatus) {
                        const walletData = await window.App.Services.CEX.fetchWalletStatus(cexUpper);

                        if (walletData && Array.isArray(walletData)) {
                            // Log chain filtering info
                            // console.log(`[${cexUpper}] Total tokens from API: ${walletData.length}`);
                            // console.log(`[${cexUpper}] Filtering for chain: ${chainKey}`);

                            // Filter by chain and convert to unified format
                            let cexTokens = walletData
                                .filter(item => {
                                    const matches = matchesCex(chainKey, item.chain);
                                    if (!matches && walletData.length < 20) {
                                        // Log mismatches for debugging (only if small dataset)
                                        // console.log(`[${cexUpper}] Skipping ${item.tokenName}: chain "${item.chain}" doesn't match "${chainKey}"`);
                                    }
                                    return matches;
                                })
                                .map(item => {
                                    const symbol = String(item.tokenName || '').toUpperCase();
                                    const lookupKey = `${cexUpper}_${symbol}`;
                                    const existing = existingLookup.get(lookupKey);

                                    // Extract contract address from CEX response
                                    let contractAddress = '';
                                    if (item.contractAddress) {
                                        contractAddress = String(item.contractAddress).trim();
                                    } else if (existing?.sc_in) {
                                        contractAddress = existing.sc_in;
                                    }

                                    // Build dataCexs format for compatibility with wallet-exchanger.js
                                    const dataCexs = {};
                                    dataCexs[cexUpper] = {
                                        withdrawToken: item.withdrawEnable || false,
                                        depositToken: item.depositEnable || false,
                                        withdrawPair: true, // Not available from wallet API
                                        depositPair: true   // Not available from wallet API
                                    };

                                    return {
                                        cex_source: cexUpper,
                                        cex: cexUpper,
                                        symbol_in: symbol,
                                        token_name: existing?.token_name || item.tokenName || symbol,
                                        sc_in: contractAddress, // Use contract address from CEX API
                                        des_in: existing?.des_in || existing?.decimals || '',
                                        decimals: existing?.des_in || existing?.decimals || '',
                                        deposit: item.depositEnable ? '1' : '0',
                                        withdraw: item.withdrawEnable ? '1' : '0',
                                        feeWD: parseFloat(item.feeWDs || 0),
                                        current_price: existing?.current_price || 0,
                                        dataCexs: dataCexs // Add dataCexs for compatibility
                                    };
                                });

                            // Special handling untuk INDODAX: lookup TOKEN database
                            if (isIndodax && cexTokens.length > 0) {
                                cexTokens = await enrichIndodaxFromTokenDatabase(chainKey, cexTokens);
                            }

                            allTokens = allTokens.concat(cexTokens);
                            // console.log(`✅ ${cexUpper}: Fetched ${cexTokens.length} tokens for chain ${chainKey}`);

                            // Update progress with success count
                            if (window.SnapshotOverlay) {
                                window.SnapshotOverlay.updateMessage(
                                    `Cek Wallet ${chainDisplay}`,
                                    `✅ ${cexUpper}: ${cexTokens.length} koin`
                                );
                            }
                        } else {
                            // console.warn(`${cexUpper}: No wallet data returned`);
                            failedCexes.push(cexUpper);

                            // Show warning in overlay
                            if (window.SnapshotOverlay) {
                                window.SnapshotOverlay.updateMessage(
                                    `Cek Wallet ${chainDisplay}`,
                                    `⚠️ ${cexUpper}: Tidak ada data`
                                );
                            }
                        }
                    } else {
                        throw new Error('fetchWalletStatus service not available');
                    }
                } catch(error) {
                    // console.error(`${cexUpper} wallet check failed:`, error);
                    failedCexes.push(cexUpper);

                    // Show error in overlay
                    if (window.SnapshotOverlay) {
                        window.SnapshotOverlay.updateMessage(
                            `Cek Wallet ${chainDisplay}`,
                            `❌ ${cexUpper}: Gagal mengambil data`
                        );
                    }
                }

                await sleep(200);
            }

            // Final summary in overlay
            const successCount = selectedCex.length - failedCexes.length;
            const summaryMsg = `${allTokens.length} koin dari ${successCount} CEX`;
            const detailMsg = failedCexes.length > 0 ?
                `Gagal: ${failedCexes.join(', ')}` :
                'Semua CEX berhasil';

            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.showSuccess(`${summaryMsg} | ${detailMsg}`, 1500);
            }

            return {
                success: allTokens.length > 0,
                tokens: allTokens,
                failedCexes: failedCexes,
                totalTokens: allTokens.length,
                cexSources: selectedCex
            };

        } catch(error) {
            // console.error('[checkWalletStatusOnly] Failed:', error);

            // Show error in overlay
            if (window.SnapshotOverlay) {
                window.SnapshotOverlay.showError(error.message || 'Unknown error', 2000);
            }

            return {
                success: false,
                error: error.message || 'Unknown error',
                tokens: [],
                failedCexes: selectedCex
            };
        }
    }

    window.SnapshotModule = {
        processSnapshotForCex,
        checkWalletStatusOnly,
        fetchCexData,
        validateTokenData,
        fetchWeb3TokenData,
        saveToSnapshot
    };

    // console.log('✅ Snapshot Module Loaded v2.0 (Refactored - Single Unified System)');

})();
