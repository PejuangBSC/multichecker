// =================================================================================
// WALLET EXCHANGER UI MODULE
// =================================================================================
/**
 * Module untuk mengelola UI Update Wallet Exchanger
 * - Render CEX cards dengan tabel koin
 * - Handle pemilihan CEX
 * - Integrate dengan fetchWalletStatus dari services/cex.js
 */
(function initWalletExchangerUI(global) {
    const root = global || (typeof window !== 'undefined' ? window : {});
    const App = root.App || (root.App = {});

    // State management
    let activeChain = null;
    let selectedCexList = [];

    /**
     * Apply the same filter rules used by scanner/management tables so wallet view stays in sync.
     */
    function filterTokensForWallet(tokens, mode) {
        if (!Array.isArray(tokens) || tokens.length === 0) return [];

        const CONFIG_CHAINS = root.CONFIG_CHAINS || {};

        if (mode.type === 'single' && mode.chain) {
            const chainKey = String(mode.chain).toLowerCase();
            const rawFilter = (typeof getFromLocalStorage === 'function')
                ? getFromLocalStorage(`FILTER_${String(chainKey).toUpperCase()}`, null)
                : null;
            const filterVals = (typeof getFilterChain === 'function') ? getFilterChain(chainKey) : { cex: [], pair: [], dex: [] };
            // First load (no saved filter) -> keep all chain tokens
            if (!rawFilter) {
                return tokens.filter(t => String(t.chain || '').toLowerCase() === chainKey);
            }

            const selCex = (filterVals.cex || []).map(x => String(x).toUpperCase());
            const selPair = (filterVals.pair || []).map(x => String(x).toUpperCase());
            const selDex = (filterVals.dex || []).map(x => String(x).toLowerCase());

            if (!(selCex.length && selPair.length && selDex.length)) {
                return [];
            }

            const chainCfg = CONFIG_CHAINS[chainKey] || {};
            const pairDefs = chainCfg.PAIRDEXS || {};

            return tokens.filter(token => {
                if (String(token.chain || '').toLowerCase() !== chainKey) return false;

                const tokenCexs = (token.selectedCexs || []).map(x => String(x).toUpperCase());
                const hasCex = tokenCexs.some(cx => selCex.includes(cx));
                if (!hasCex) return false;

                const symOut = String(token.symbol_out || '').toUpperCase();
                const pairKey = pairDefs[symOut] ? symOut : 'NON';
                if (!selPair.includes(pairKey)) return false;

                const tokenDex = (token.selectedDexs || []).map(x => String(x).toLowerCase());
                const hasDex = tokenDex.some(dx => selDex.includes(dx));
                return hasDex;
            });
        }

        // Multichain mode
        const rawFilter = (typeof getFromLocalStorage === 'function')
            ? getFromLocalStorage('FILTER_MULTICHAIN', null)
            : null;
        const fm = (typeof getFilterMulti === 'function') ? getFilterMulti() : { chains: [], cex: [], dex: [] };

        if (!rawFilter) {
            return tokens;
        }

        const chainsSel = (fm.chains || []).map(x => String(x).toLowerCase());
        const cexSel = (fm.cex || []).map(x => String(x).toUpperCase());
        const dexSel = (fm.dex || []).map(x => String(x).toLowerCase());

        if (!(chainsSel.length && cexSel.length && dexSel.length)) {
            return [];
        }

        return tokens.filter(token => {
            const chainLower = String(token.chain || '').toLowerCase();
            if (!chainsSel.includes(chainLower)) return false;

            const tokenCexs = (token.selectedCexs || []).map(x => String(x).toUpperCase());
            const hasCex = tokenCexs.some(cx => cexSel.includes(cx));
            if (!hasCex) return false;

            const tokenDex = (token.selectedDexs || []).map(x => String(x).toLowerCase());
            return tokenDex.some(dx => dexSel.includes(dx));
        });
    }

    /**
     * Load coins data from storage (localStorage or IndexedDB) and apply active filters.
     */
    function loadCoinsFromStorage() {
        try {
            const mode = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };
            let tokens = [];

            if (mode.type === 'single' && mode.chain) {
                tokens = (typeof getTokensChain === 'function') ? getTokensChain(mode.chain) : [];
                console.log(`[Wallet Exchanger] Loaded ${tokens.length} coins for chain ${mode.chain}`);
            } else {
                tokens = (typeof getFromLocalStorage === 'function') ? getFromLocalStorage('TOKEN_MULTICHAIN', []) : [];
                console.log(`[Wallet Exchanger] Loaded ${tokens.length} coins (multichain mode)`);
            }

            const filteredTokens = filterTokensForWallet(tokens, mode);
            console.log(`[Wallet Exchanger] Tokens after filter: ${filteredTokens.length}`);

            if (filteredTokens.length > 0) {
                const sampleCoin = filteredTokens[0];
                console.log('[Wallet Exchanger] Sample filtered coin:', {
                    symbol: sampleCoin.symbol_in,
                    chain: sampleCoin.chain,
                    hasCexData: !!sampleCoin.dataCexs,
                    cexCount: sampleCoin.dataCexs ? Object.keys(sampleCoin.dataCexs).length : 0
                });
            }

            return filteredTokens;
        } catch(err) {
            console.error('[Wallet Exchanger] Error loading coins from storage:', err);
            return [];
        }
    }

    /**
     * Merge wallet data hasil fetch dengan data existing
     * Update hanya dataCexs untuk CEX yang di-fetch
     */
    function mergeWalletData(existingCoins, newCoinsMap, updatedCexes) {
        const merged = [...existingCoins];

        // Update dataCexs untuk coins yang sudah ada
        Object.keys(newCoinsMap).forEach(coinKey => {
            const newCoin = newCoinsMap[coinKey];

            // Cari existing coin dengan matching symbol_in dan chain
            const existingIndex = merged.findIndex(c => {
                const symbolMatch = (c.symbol_in || c.tokenName) === (newCoin.symbol_in || newCoin.tokenName);
                const chainMatch = String(c.chain || '').toLowerCase() === String(newCoin.chain || '').toLowerCase();
                return symbolMatch && chainMatch;
            });

            if (existingIndex >= 0) {
                // Pastikan dataCexs ada
                merged[existingIndex].dataCexs = merged[existingIndex].dataCexs || {};

                // Loop melalui CEX yang diupdate dari newCoin
                Object.keys(newCoin.dataCexs).forEach(cexName => {
                    const newCexData = newCoin.dataCexs[cexName];
                    merged[existingIndex].dataCexs[cexName] = merged[existingIndex].dataCexs[cexName] || {};

                    // FIX: Update status WD/DP hanya untuk Token.
                    // Status untuk Pair (biasanya stablecoin) diasumsikan selalu OPEN (true).
                    merged[existingIndex].dataCexs[cexName].depositToken = newCexData.depositEnable || false;
                    merged[existingIndex].dataCexs[cexName].withdrawToken = newCexData.withdrawEnable || false;
                    merged[existingIndex].dataCexs[cexName].depositPair = true; // Asumsi Pair (USDT, dll) selalu OPEN
                    merged[existingIndex].dataCexs[cexName].withdrawPair = true; // Asumsi Pair (USDT, dll) selalu OPEN

                    // Update fee WD untuk Token (asumsi feeWDs dari API adalah untuk token utama)
                    merged[existingIndex].dataCexs[cexName].feeWDToken = newCexData.feeWDs;

                    // Update status trading
                    merged[existingIndex].dataCexs[cexName].tradingActive = newCexData.tradingActive;
                });

                // Update SC dan decimals jika ada data baru dari CEX
                if (newCoin.sc_in && newCoin.sc_in !== '-') {
                    merged[existingIndex].sc_in = newCoin.sc_in;
                }
                if (newCoin.des_in && newCoin.des_in !== '-') {
                    merged[existingIndex].des_in = newCoin.des_in;
                    merged[existingIndex].decimals = newCoin.des_in;
                }

                console.log(`[Merge] Updated existing coin: ${newCoin.symbol_in} on chain ${newCoin.chain} for CEXes: ${Object.keys(newCoin.dataCexs).join(', ')}`);
            } else {
                // Add new coin
                merged.push(newCoin);
                console.log(`[Merge] Added new coin: ${newCoin.symbol_in} on chain ${newCoin.chain}`);
            }
        });

        return merged;
    }

    /**
     * Save coins data to storage
     */
    function saveCoinsToStorage(coins) {
        try {
            const mode = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };

            if (mode.type === 'single' && mode.chain) {
                // Single chain mode - save to specific chain storage
                const storageKey = `TOKEN_${String(mode.chain).toUpperCase()}`;
                if (typeof saveToLocalStorage === 'function') {
                    saveToLocalStorage(storageKey, coins);
                }
            } else {
                // Multichain mode
                if (typeof saveToLocalStorage === 'function') {
                    saveToLocalStorage('TOKEN_MULTICHAIN', coins);
                }
            }

            console.log(`[Wallet Exchanger] Saved ${coins.length} coins to storage`);
        } catch(err) {
            console.error('[Wallet Exchanger] Error saving coins to storage:', err);
        }
    }

    /**
     * Show update result notification
     */
    function showUpdateResult(success, failedCexes) {
        const $result = $('#wallet-update-result');
        const $resultText = $result.find('p');

        if (success && (!failedCexes || failedCexes.length === 0)) {
            $result.removeClass('uk-alert-warning uk-alert-danger').addClass('uk-alert-success');
            $resultText.html('<strong>✅ Update Berhasil!</strong> Semua exchanger berhasil diperbarui. Data terbaru ditampilkan di bawah.');
        } else if (failedCexes && failedCexes.length > 0) {
            $result.removeClass('uk-alert-success uk-alert-danger').addClass('uk-alert-warning');
            const failedList = failedCexes.join(', ');
            $resultText.html(`<strong>⚠️ Update Sebagian Berhasil</strong><br>Exchanger yang gagal: ${failedList}`);
        } else {
            $result.removeClass('uk-alert-success uk-alert-warning').addClass('uk-alert-danger');
            $resultText.html('<strong>❌ Update Gagal</strong> Tidak ada exchanger yang berhasil diperbarui.');
        }

        $result.fadeIn(300);

        // Auto-hide after 10 seconds
        setTimeout(() => {
            $result.fadeOut(300);
        }, 10000);
    }

    /**
     * Render CEX cards grid sesuai dengan filter chain aktif
     * Menampilkan semua CEX yang ada di filter, dengan data koin dari storage
     */
    function renderCexCards() {
        const $grid = $('#wallet-cex-grid');
        if (!$grid.length) return;

        $grid.empty();

        // Get active mode and chain
        const mode = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };
        let availableCexes = [];

        if (mode.type === 'single') {
            const filterChain = (typeof getFilterChain === 'function') ? getFilterChain(mode.chain || '') : {};
            availableCexes = (filterChain?.cex || []).map(x => String(x).toUpperCase());
            activeChain = mode.chain;
        } else {
            const filterMulti = (typeof getFilterMulti === 'function') ? getFilterMulti() : {};
            availableCexes = (filterMulti?.cex || []).map(x => String(x).toUpperCase());
            activeChain = 'MULTICHAIN';
        }

        // Filter hanya CEX yang valid dari CONFIG_CEX
        const CONFIG_CEX = root.CONFIG_CEX || {};
        const CONFIG_CHAINS = root.CONFIG_CHAINS || {};
        availableCexes = availableCexes.filter(cx => !!CONFIG_CEX[cx]);

        // Update chain label
        try {
            const chainName = (activeChain === 'MULTICHAIN') ? 'MULTICHAIN' :
                              (CONFIG_CHAINS?.[String(activeChain).toLowerCase()]?.Nama_Chain || activeChain);
            $('#wallet-chain-label').text(String(chainName).toUpperCase());
        } catch(_) {}

        // Jika tidak ada CEX yang tersedia
        if (!availableCexes.length) {
            $grid.html(`
                <div class="uk-width-1-1">
                    <div class="uk-alert uk-alert-warning">
                        <p>Tidak ada exchanger yang tersedia pada filter chain aktif. Silakan pilih minimal 1 CEX pada filter.</p>
                    </div>
                </div>
            `);
            return;
        }

        // Get all coins from storage untuk chain aktif
        const allCoinsData = loadCoinsFromStorage();

        // Render each CEX card berdasarkan availableCexes (filter)
        availableCexes.forEach(cexName => {
            const cexConfig = CONFIG_CEX[cexName] || {};
            const cexColor = cexConfig.WARNA || '#333';

            // Filter coins untuk CEX ini: hanya yang bermasalah WD/Depo
            const cexCoins = allCoinsData.filter(coin => {
                // Check if coin has data for this CEX
                if (!coin.dataCexs || !coin.dataCexs[cexName]) return false;

                // For single chain mode, filter by chain
                if (mode.type === 'single') {
                    const coinChain = String(coin.chain || '').toLowerCase();
                    const targetChain = String(activeChain || '').toLowerCase();
                    if (coinChain !== targetChain) {
                        return false;
                    }
                }

                // FILTER: Hanya tampilkan yang bermasalah (WD atau Depo CLOSED)
                const dataCex = coin.dataCexs[cexName];
                const wdClosed = dataCex.withdrawEnable === false || dataCex.withdrawToken === false;
                const dpClosed = dataCex.depositEnable === false || dataCex.depositToken === false;

                return wdClosed || dpClosed;
            });

            console.log(`[${cexName}] Coins after filter (chain: ${activeChain}): ${cexCoins.length} dari total ${allCoinsData.length}`);

            // Jumlah koin bermasalah = jumlah total (karena sudah difilter)
            const problemCount = cexCoins.length;

            const isSelected = selectedCexList.includes(cexName);

            const cardHtml = `
                <div class="wallet-cex-card ${isSelected ? 'selected' : ''}" data-cex="${cexName}">
                    <div class="wallet-cex-header" data-cex="${cexName}">
                        <div class="wallet-cex-name" style="color: ${cexColor}">
                            <input type="checkbox" class="wallet-cex-checkbox" data-cex="${cexName}" ${isSelected ? 'checked' : ''}>
                            ${cexName}
                        </div>
                        <span class="uk-text-meta uk-text-small">
                            ${problemCount} koin bermasalah
                        </span>
                    </div>
                    <div class="wallet-cex-table-wrapper">
                        ${renderCexTable(cexName, cexCoins)}
                    </div>
                </div>
            `;

            $grid.append(cardHtml);
        });

        // Bind events untuk checkbox
        bindCexCardEvents();
        updateCekButton();
    }

    /**
     * Render tabel koin untuk CEX
     * Data koin akan di-fetch dari CEX saat user mengklik UPDATE WALLET EXCHANGER
     */
    function renderCexTable(cexName, coins) {
        if (!coins || coins.length === 0) {
            return `
                <div class="uk-text-center uk-padding-small uk-text-muted">
                    <p>Belum ada data wallet</p>
                    <p class="uk-text-small">Pilih CEX ini dan klik "UPDATE WALLET EXCHANGER" untuk fetch data</p>
                </div>
            `;
        }

        let tableHtml = `
            <table class="wallet-cex-table uk-table uk-table-divider uk-table-hover uk-table-small">
                <thead>
                    <tr>
                        <th style="width:30px">No</th>
                        <th style="width:70px">Symbol</th>
                        <th style="width:130px">SC</th>
                        <th style="width:60px">Decimals</th>
                        <th style="width:90px">Trade Status</th>
                        <th style="width:80px">Status WD</th>
                        <th style="width:80px">Status Depo</th>
                    </tr>
                </thead>
                <tbody>
        `;

        coins.forEach((coin, idx) => {
            const dataCex = (coin.dataCexs || {})[cexName] || {};

            // Symbol dan SC data
            const tokenSymbol = (coin.symbol_in || coin.tokenName || '?').toUpperCase();
            const tokenSc = coin.sc_in || coin.contractAddress || '-';

            // Decimals dari enrichment
            const decimals = coin.des_in || coin.decimals || '-';

            // Status WD (Withdraw) - gunakan withdrawEnable sebagai prioritas
            const wdToken = dataCex.withdrawEnable !== undefined
                ? dataCex.withdrawEnable
                : dataCex.withdrawToken;

            let statusWd = '';
            if (wdToken === true) {
                statusWd = '<span class="wallet-status-badge wallet-status-on">OPEN</span>';
            } else if (wdToken === false) {
                statusWd = '<span class="wallet-status-badge wallet-status-off">CLOSED</span>';
            } else {
                statusWd = '<span class="wallet-status-badge wallet-status-loading">UNKNOWN</span>';
            }

            // Status Depo (Deposit) - gunakan depositEnable sebagai prioritas
            const dpToken = dataCex.depositEnable !== undefined
                ? dataCex.depositEnable
                : dataCex.depositToken;

            let statusDepo = '';
            if (dpToken === true) {
                statusDepo = '<span class="wallet-status-badge wallet-status-on">OPEN</span>';
            } else if (dpToken === false) {
                statusDepo = '<span class="wallet-status-badge wallet-status-off">CLOSED</span>';
            } else {
                statusDepo = '<span class="wallet-status-badge wallet-status-loading">UNKNOWN</span>';
            }

            // Trade Status - status trading pair (misal BTC/USDT aktif atau tidak)
            const tradingActive = dataCex.tradingActive || dataCex.isSpotTradingAllowed;
            let tradeStatus = '';
            if (tradingActive === true) {
                tradeStatus = '<span class="wallet-status-badge wallet-status-on">ACTIVE</span>';
            } else if (tradingActive === false) {
                tradeStatus = '<span class="wallet-status-badge wallet-status-off">INACTIVE</span>';
            } else {
                // Fallback: jika WD dan Depo keduanya aktif, anggap trading aktif
                if (wdToken === true && dpToken === true) {
                    tradeStatus = '<span class="wallet-status-badge wallet-status-on">ACTIVE</span>';
                } else {
                    tradeStatus = '<span class="wallet-status-badge wallet-status-loading">UNKNOWN</span>';
                }
            }

            // Shorten smart contract addresses
            const shortenSc = (sc) => {
                if (!sc || sc === '-' || sc.length < 12) return sc;
                return `${sc.substring(0, 6)}...${sc.substring(sc.length - 4)}`;
            };

            tableHtml += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>
                        <span class="uk-text-bold uk-text-emphasis">${tokenSymbol}</span>
                    </td>
                    <td class="uk-text-truncate" title="${tokenSc}" style="max-width: 130px;">
                        <code class="uk-text-small">${shortenSc(tokenSc)}</code>
                    </td>
                    <td class="uk-text-center">
                        <span class="uk-text-small">${decimals}</span>
                    </td>
                    <td class="uk-text-center">
                        ${tradeStatus}
                    </td>
                    <td class="uk-text-center">
                        ${statusWd}
                    </td>
                    <td class="uk-text-center">
                        ${statusDepo}
                    </td>
                </tr>
            `;
        });

        tableHtml += `
                </tbody>
            </table>
        `;

        return tableHtml;
    }


    /**
     * Bind events untuk CEX cards checkbox
     */
    function bindCexCardEvents() {
        // Checkbox click
        $('.wallet-cex-checkbox').off('click').on('click', function(e) {
            e.stopPropagation();
            const cexName = $(this).data('cex');
            toggleCexSelection(cexName);
        });

        // Header click (toggle checkbox)
        $('.wallet-cex-header').off('click').on('click', function(e) {
            if ($(e.target).hasClass('wallet-cex-checkbox')) return;
            const cexName = $(this).data('cex');
            toggleCexSelection(cexName);
        });
    }

    /**
     * Toggle CEX selection
     */
    function toggleCexSelection(cexName) {
        const idx = selectedCexList.indexOf(cexName);

        if (idx >= 0) {
            // Remove from selection
            selectedCexList.splice(idx, 1);
            $(`.wallet-cex-card[data-cex="${cexName}"]`).removeClass('selected');
            $(`.wallet-cex-checkbox[data-cex="${cexName}"]`).prop('checked', false);
        } else {
            // Add to selection
            selectedCexList.push(cexName);
            $(`.wallet-cex-card[data-cex="${cexName}"]`).addClass('selected');
            $(`.wallet-cex-checkbox[data-cex="${cexName}"]`).prop('checked', true);
        }

        updateCekButton();
    }

    /**
     * Update button state berdasarkan selection
     */
    function updateCekButton() {
        const $btn = $('#btn-cek-wallet-exchanger');
        if (selectedCexList.length > 0) {
            $btn.prop('disabled', false).removeClass('uk-button-default').addClass('uk-button-primary');
        } else {
            $btn.prop('disabled', true).removeClass('uk-button-primary').addClass('uk-button-default');
        }
    }

    /**
     * Show progress overlay saat fetch CEX wallet (menggunakan AppOverlay)
     */
    function showFetchProgressOverlay(cexList) {
        // Create items array for progress tracking
        const items = cexList.map(cexName => ({
            name: cexName,
            status: 'waiting',
            text: 'Menunggu...'
        }));

        // Show overlay dengan AppOverlay
        const overlayId = AppOverlay.showItems({
            id: 'wallet-fetch-overlay',
            title: 'Fetching Wallet Data...',
            message: 'Mohon tunggu, aplikasi sedang melakukan fetch data wallet dari exchanger',
            items: items
        });

        return overlayId;
    }

    /**
     * Update progress untuk CEX tertentu (menggunakan AppOverlay)
     */
    function updateFetchProgress(cexName, status, message, tokenCount) {
        const text = tokenCount
            ? `${message || ''} - ${tokenCount} koin ditemukan`
            : (message || '');

        AppOverlay.updateItem('wallet-fetch-overlay', cexName, status, text);
    }

    /**
     * Hide progress overlay (menggunakan AppOverlay)
     */
    function hideFetchProgressOverlay() {
        setTimeout(() => {
            AppOverlay.hide('wallet-fetch-overlay');
        }, 1000);
    }

    /**
     * Handle CEK WALLET EXCHANGER button click
     * KONSEP: User pilih CEX dengan checkbox -> fetch wallet data -> update tabel
     */
    async function handleCekWallet() {
        // Validasi: harus ada CEX yang dipilih
        if (selectedCexList.length === 0) {
            try {
                if (typeof toast !== 'undefined' && toast.error) {
                    toast.error('Pilih minimal 1 CEX terlebih dahulu');
                }
            } catch(_) {}
            return;
        }

        if (!confirm(`Fetch data wallet dari ${selectedCexList.length} exchanger?\n\n${selectedCexList.join(', ')}\n\nProses ini akan memakan waktu beberapa saat.`)) {
            return;
        }

        // Get current app mode (single chain vs multichain)
        const mode = (typeof getAppMode === 'function') ? getAppMode() : { type: 'multi' };

        // Ensure scanner is stopped
        try {
            const st = (typeof getAppState === 'function') ? getAppState() : {};
            if (st && st.run === 'YES' && window.App?.Scanner?.stopScannerSoft) {
                window.App.Scanner.stopScannerSoft();
                await new Promise(r => setTimeout(r, 200));
            }
        } catch(_) {}

        // Show progress overlay (layar freeze)
        showFetchProgressOverlay(selectedCexList);

        // Storage untuk menyimpan hasil fetch per CEX
        const cexWalletData = {};
        const failedCexes = [];

        // Fetch wallet data dari setiap CEX secara sequential
        for (const cexName of selectedCexList) {
            try {
                // Update progress: fetching
                updateFetchProgress(cexName, 'fetching', `Connecting to ${cexName} API...`);

                // Fetch wallet status menggunakan services/cex.js
                if (typeof window.App?.Services?.CEX?.fetchWalletStatus === 'function') {
                    const walletData = await window.App.Services.CEX.fetchWalletStatus(cexName);

                    // Update progress: processing
                    updateFetchProgress(cexName, 'processing', 'Memproses data wallet...');

                    // Filter data berdasarkan chain aktif menggunakan CHAIN_SYNONYMS
                    let filteredData = walletData;
                    if (mode.type === 'single' && mode.chain) {
                        const targetChain = mode.chain.toLowerCase();

                        // Gunakan CHAIN_SYNONYMS dari config.js untuk matching
                        const chainSynonyms = window.CHAIN_SYNONYMS?.[targetChain] || [];

                        // Buat regex pattern dari synonyms
                        const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const pattern = chainSynonyms.length > 0
                            ? new RegExp(chainSynonyms.map(escapeRegex).join('|'), 'i')
                            : null;

                        filteredData = walletData.filter(item => {
                            const itemChain = String(item.chain || '');

                            // Match menggunakan regex pattern dari synonyms
                            if (pattern && pattern.test(itemChain)) {
                                return true;
                            }

                            // Fallback: exact match dengan chain key
                            return itemChain.toLowerCase() === targetChain;
                        });

                        console.log(`[${cexName}] Chain filter: ${targetChain} | Synonyms: [${chainSynonyms.join(', ')}] | Total: ${walletData.length} → Filtered: ${filteredData.length}`);
                    }

                    // Simpan data
                    cexWalletData[cexName] = filteredData;

                    // Update progress: success
                    updateFetchProgress(cexName, 'success', 'Berhasil', filteredData.length);

                } else {
                    throw new Error('fetchWalletStatus function not available');
                }

            } catch(err) {
                console.error(`[Wallet Exchanger] Error fetching ${cexName}:`, err);
                failedCexes.push(cexName);
                updateFetchProgress(cexName, 'error', err.message || 'Gagal fetch data');
            }

            // Delay antar CEX untuk menghindari rate limit
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Hide progress overlay
        hideFetchProgressOverlay();

        // Proses dan tampilkan hasil
        try {
            // Transform data ke format yang sesuai untuk renderCexTable
            const transformedCoins = {};

            Object.keys(cexWalletData).forEach(cexName => {
                const walletItems = cexWalletData[cexName] || [];

                walletItems.forEach(item => {
                    // Normalize chain - gunakan activeChain untuk single mode
                    const normalizedChain = mode.type === 'single' && mode.chain
                        ? mode.chain.toLowerCase()
                        : (item.chain || 'unknown').toLowerCase();

                    const key = `${item.tokenName}_${normalizedChain}`;

                    if (!transformedCoins[key]) {
                        transformedCoins[key] = {
                            symbol_in: item.tokenName,
                            tokenName: item.tokenName,
                            sc_in: item.contractAddress || '-',
                            contractAddress: item.contractAddress,
                            chain: normalizedChain, // Simpan normalized chain
                            decimals: item.decimals || '-',
                            des_in: item.decimals || '-',
                            dataCexs: {}
                        };
                    }

                    // Add CEX-specific data
                    transformedCoins[key].dataCexs[cexName] = {
                        withdrawEnable: item.withdrawEnable,
                        depositEnable: item.depositEnable,
                        withdrawToken: item.withdrawEnable,
                        depositToken: item.depositEnable,
                        feeWDs: item.feeWDs,
                        tradingActive: item.tradingActive !== false // default true if not specified
                    };
                });
            });

            console.log('[Wallet Exchanger] Transformed coins:', Object.keys(transformedCoins).length);

            // Merge dengan data existing di storage
            const existingCoins = loadCoinsFromStorage();
            console.log('[Wallet Exchanger] Existing coins in storage:', existingCoins.length);

            const mergedCoins = mergeWalletData(existingCoins, transformedCoins, selectedCexList);
            console.log('[Wallet Exchanger] Merged coins:', mergedCoins.length);

            // Debug: tampilkan sample data
            if (mergedCoins.length > 0) {
                console.log('[Wallet Exchanger] Sample merged coin:', mergedCoins[0]);
            }

            // Save merged data ke storage
            saveCoinsToStorage(mergedCoins);

            // Re-render cards dengan data terbaru
            renderCexCards();

            // Show notification
            if (failedCexes.length === 0) {
                showUpdateResult(true, []);
                if (typeof toast !== 'undefined' && toast.success) {
                    const totalCoins = Object.keys(transformedCoins).length;
                    toast.success(`✅ Berhasil fetch ${totalCoins} koin dari ${selectedCexList.length} CEX`);
                }
            } else {
                showUpdateResult(false, failedCexes);
                if (typeof toast !== 'undefined' && toast.warning) {
                    toast.warning(`⚠️ Berhasil: ${selectedCexList.length - failedCexes.length}, Gagal: ${failedCexes.length}`);
                }
            }

        } catch(err) {
            console.error('[Wallet Exchanger] Error processing results:', err);
            showUpdateResult(false, selectedCexList);
            if (typeof toast !== 'undefined' && toast.error) {
                toast.error('Gagal memproses hasil: ' + err.message);
            }
        }
    }

    /**
     * Show wallet exchanger section
     */
    function show() {
        // Hide other sections
        try {
            $('#tabel-monitoring, #scanner-config, #filter-card, #sinyal-container').hide();
            $('#token-management, #form-setting-app, #iframe-container').hide();
            if (window.SnapshotModule && typeof window.SnapshotModule.hide === 'function') {
                window.SnapshotModule.hide();
            }
        } catch(_) {}

        // Reset selection
        selectedCexList = [];

        // Render CEX cards dengan data dari storage
        renderCexCards();

        // Show section
        $('#update-wallet-section').fadeIn(300);
    }

    /**
     * Hide wallet exchanger section
     */
    function hide() {
        $('#update-wallet-section').fadeOut(300);

        // Show scanner elements
        try {
            $('#tabel-monitoring, #scanner-config, #filter-card, #sinyal-container').fadeIn(300);
        } catch(_) {}
    }

    /**
     * Initialize module
     */
    function init() {
        // Bind CEK WALLET button
        $('#btn-cek-wallet-exchanger').off('click').on('click', handleCekWallet);

        // Bind close button
        $('#btn-close-wallet-section').off('click').on('click', hide);

        console.log('[Wallet Exchanger UI] Module initialized');
    }

    // Register to App namespace
    if (typeof App.register === 'function') {
        App.register('WalletExchanger', {
            show,
            hide,
            renderCexCards,
            showUpdateResult,
            init
        });
    } else {
        // Fallback registration
        App.WalletExchanger = { show, hide, renderCexCards, showUpdateResult, init };
    }

    // Auto-init on DOM ready
    $(document).ready(function() {
        init();
    });

})(typeof window !== 'undefined' ? window : this);
