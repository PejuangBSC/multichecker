// =================================================================================
// RPC MANAGER - Centralized RPC Management System
// =================================================================================
// Purpose: Migrate and manage all RPC endpoints from CONFIG_CHAINS to SETTING_SCANNER
//
// Flow:
// 1. Extract default RPCs from CONFIG_CHAINS on first run
// 2. Store in SETTING_SCANNER.customRPCs
// 3. Provide utilities for RPC selection, fallback, and management
//
// =================================================================================

(function() {
    'use strict';

    // ====================
    // DEFAULT RPC EXTRACTION
    // ====================

    /**
     * Extract all default RPCs from CONFIG_CHAINS
     * @returns {Object} Map of chainKey -> RPC URL
     */
    function extractDefaultRPCs() {
        const rpcs = {};

        if (typeof CONFIG_CHAINS === 'undefined') {
            console.warn('[RPC Manager] CONFIG_CHAINS not available');
            return rpcs;
        }

        Object.keys(CONFIG_CHAINS).forEach(chainKey => {
            const chain = CONFIG_CHAINS[chainKey];
            if (chain && chain.RPC) {
                rpcs[chainKey.toLowerCase()] = chain.RPC;
            }
        });

        return rpcs;
    }

    // ====================
    // RPC FALLBACK LISTS
    // ====================

    /**
     * Fallback RPC lists per chain for redundancy
     * These will be used if primary RPC fails
     */
    const RPC_FALLBACKS = {
        bsc: [
            'https://bsc-dataseed1.binance.org',
            'https://bsc-dataseed2.binance.org',
            'https://bsc-dataseed.bnbchain.org',
            'https://public-bsc-mainnet.fastnode.io'
        ],
        polygon: [
            'https://polygon-rpc.com',
            'https://polygon-pokt.nodies.app',
            'https://rpc-mainnet.matic.network',
            'https://polygon-bor-rpc.publicnode.com'
        ],
        arbitrum: [
            'https://arb1.arbitrum.io/rpc',
            'https://arbitrum-one-rpc.publicnode.com',
            'https://arbitrum.llamarpc.com',
            'https://rpc.ankr.com/arbitrum'
        ],
        ethereum: [
            'https://eth.llamarpc.com',
            'https://ethereum-rpc.publicnode.com',
            'https://rpc.ankr.com/eth',
            'https://cloudflare-eth.com'
        ],
        base: [
            'https://base.llamarpc.com',
            'https://mainnet.base.org',
            'https://base-rpc.publicnode.com',
            'https://base.meowrpc.com'
        ],
        optimism: [
            'https://mainnet.optimism.io',
            'https://optimism.llamarpc.com',
            'https://optimism-rpc.publicnode.com',
            'https://rpc.ankr.com/optimism'
        ],
        avalanche: [
            'https://api.avax.network/ext/bc/C/rpc',
            'https://avalanche-c-chain-rpc.publicnode.com',
            'https://rpc.ankr.com/avalanche',
            'https://avax.meowrpc.com'
        ],
        fantom: [
            'https://rpc.ftm.tools',
            'https://rpcapi.fantom.network',
            'https://fantom-rpc.publicnode.com',
            'https://rpc.ankr.com/fantom'
        ]
    };

    // ====================
    // MIGRATION FUNCTION
    // ====================

    /**
     * Migrate RPC settings from CONFIG_CHAINS to SETTING_SCANNER
     * Compatible with existing format: customRPCs[chain] = "url" (string)
     * Also creates extended fallback config in customRPCsExtended
     */
    async function migrateRPCsToSettings() {
        try {
            // Load existing settings
            const settings = (typeof getFromLocalStorage === 'function')
                ? getFromLocalStorage('SETTING_SCANNER', {})
                : {};

            // Check if migration already done (customRPCs exists and has data)
            if (settings.customRPCs && Object.keys(settings.customRPCs).length > 0) {
                console.log('[RPC Manager] Custom RPCs already configured, checking for extended config...');

                // Create extended config if missing (for fallback support)
                if (!settings.customRPCsExtended || Object.keys(settings.customRPCsExtended).length === 0) {
                    settings.customRPCsExtended = {};
                    Object.keys(settings.customRPCs).forEach(chainKey => {
                        const primary = settings.customRPCs[chainKey];
                        settings.customRPCsExtended[chainKey] = {
                            primary,
                            fallbacks: RPC_FALLBACKS[chainKey] || [],
                            active: primary,
                            lastChecked: null,
                            status: 'unknown'
                        };
                    });

                    if (typeof saveToLocalStorage === 'function') {
                        await saveToLocalStorage('SETTING_SCANNER', settings);
                        console.log('[RPC Manager] ✅ Created extended RPC config for fallback support');
                    }
                }

                return settings.customRPCs;
            }

            // Extract default RPCs from CONFIG_CHAINS
            const defaultRPCs = extractDefaultRPCs();

            if (Object.keys(defaultRPCs).length === 0) {
                console.warn('[RPC Manager] No default RPCs found in CONFIG_CHAINS');
                return {};
            }

            // Create customRPCs object (simple string format for backward compatibility)
            const customRPCs = {};
            const customRPCsExtended = {};

            Object.keys(defaultRPCs).forEach(chainKey => {
                // Simple format for existing code compatibility
                customRPCs[chainKey] = defaultRPCs[chainKey];

                // Extended format for fallback support
                customRPCsExtended[chainKey] = {
                    primary: defaultRPCs[chainKey],
                    fallbacks: RPC_FALLBACKS[chainKey] || [],
                    active: defaultRPCs[chainKey],
                    lastChecked: null,
                    status: 'unknown'
                };
            });

            // Update settings
            settings.customRPCs = customRPCs;
            settings.customRPCsExtended = customRPCsExtended;

            // Save to storage
            if (typeof saveToLocalStorage === 'function') {
                await saveToLocalStorage('SETTING_SCANNER', settings);
                console.log('[RPC Manager] ✅ RPCs migrated to SETTING_SCANNER:', Object.keys(customRPCs).length, 'chains');
            } else if (typeof saveToLocalStorageAsync === 'function') {
                await saveToLocalStorageAsync('SETTING_SCANNER', settings);
                console.log('[RPC Manager] ✅ RPCs migrated to SETTING_SCANNER (async):', Object.keys(customRPCs).length, 'chains');
            }

            return customRPCs;

        } catch(error) {
            console.error('[RPC Manager] Migration failed:', error);
            return {};
        }
    }

    // ====================
    // RPC SELECTION & FALLBACK
    // ====================

    /**
     * Get active RPC for a chain with automatic fallback
     * Compatible with existing format: customRPCs[chain] = "url" (string)
     * Also supports extended format for fallback
     * @param {string} chainKey - Chain identifier (bsc, polygon, etc)
     * @returns {string|null} RPC URL or null if not found
     */
    function getRPC(chainKey) {
        try {
            const chainLower = String(chainKey || '').toLowerCase();

            // 1. Try to get from SETTING_SCANNER.customRPCs (simple string format)
            const settings = (typeof getFromLocalStorage === 'function')
                ? getFromLocalStorage('SETTING_SCANNER', {})
                : {};

            // Check simple format first (existing code compatibility)
            if (settings.customRPCs && settings.customRPCs[chainLower]) {
                const rpcValue = settings.customRPCs[chainLower];

                // If it's a string, return directly
                if (typeof rpcValue === 'string') {
                    return rpcValue;
                }

                // If it's an object (old format), extract value
                if (typeof rpcValue === 'object') {
                    if (rpcValue.active) return rpcValue.active;
                    if (rpcValue.primary) return rpcValue.primary;
                }
            }

            // 2. Try extended config (for fallback support)
            if (settings.customRPCsExtended && settings.customRPCsExtended[chainLower]) {
                const rpcConfig = settings.customRPCsExtended[chainLower];

                if (rpcConfig.active) return rpcConfig.active;
                if (rpcConfig.primary) return rpcConfig.primary;
                if (Array.isArray(rpcConfig.fallbacks) && rpcConfig.fallbacks.length > 0) {
                    return rpcConfig.fallbacks[0];
                }
            }

            // 3. Fallback to CONFIG_CHAINS (backward compatibility)
            if (typeof CONFIG_CHAINS !== 'undefined' && CONFIG_CHAINS[chainLower]) {
                const chainConfig = CONFIG_CHAINS[chainLower];
                if (chainConfig.RPC) {
                    console.warn(`[RPC Manager] Using fallback RPC from CONFIG_CHAINS for ${chainKey}`);
                    return chainConfig.RPC;
                }
            }

            // 4. Last resort: use RPC_FALLBACKS
            if (RPC_FALLBACKS[chainLower] && RPC_FALLBACKS[chainLower].length > 0) {
                console.warn(`[RPC Manager] Using hardcoded fallback RPC for ${chainKey}`);
                return RPC_FALLBACKS[chainLower][0];
            }

            console.error(`[RPC Manager] No RPC found for chain ${chainKey}`);
            return null;

        } catch(error) {
            console.error(`[RPC Manager] getRPC failed for ${chainKey}:`, error);
            return null;
        }
    }

    /**
     * Get all available RPCs for a chain (primary + fallbacks)
     * @param {string} chainKey - Chain identifier
     * @returns {Array<string>} Array of RPC URLs
     */
    function getAllRPCsForChain(chainKey) {
        const chainLower = String(chainKey || '').toLowerCase();
        const settings = (typeof getFromLocalStorage === 'function')
            ? getFromLocalStorage('SETTING_SCANNER', {})
            : {};

        const rpcs = [];

        if (settings.customRPCs && settings.customRPCs[chainLower]) {
            const config = settings.customRPCs[chainLower];

            if (config.primary) rpcs.push(config.primary);
            if (Array.isArray(config.fallbacks)) {
                rpcs.push(...config.fallbacks);
            }
        } else if (RPC_FALLBACKS[chainLower]) {
            rpcs.push(...RPC_FALLBACKS[chainLower]);
        }

        // Remove duplicates
        return [...new Set(rpcs)];
    }

    /**
     * Test RPC health and return latency
     * @param {string} rpcUrl - RPC endpoint URL
     * @returns {Promise<Object>} { healthy: boolean, latency: number, error: string }
     */
    async function testRPCHealth(rpcUrl) {
        const startTime = Date.now();

        try {
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_blockNumber',
                    params: [],
                    id: 1
                }),
                signal: AbortSignal.timeout(5000) // 5s timeout
            });

            const latency = Date.now() - startTime;

            if (!response.ok) {
                return {
                    healthy: false,
                    latency,
                    error: `HTTP ${response.status}`
                };
            }

            const data = await response.json();

            if (data.error) {
                return {
                    healthy: false,
                    latency,
                    error: data.error.message || 'RPC error'
                };
            }

            return {
                healthy: true,
                latency,
                error: null
            };

        } catch(error) {
            const latency = Date.now() - startTime;
            return {
                healthy: false,
                latency,
                error: error.message || 'Network error'
            };
        }
    }

    /**
     * Switch to next available RPC fallback
     * Updates both simple and extended config
     * @param {string} chainKey - Chain identifier
     * @returns {Promise<string|null>} New active RPC or null
     */
    async function switchToNextRPC(chainKey) {
        try {
            const chainLower = String(chainKey || '').toLowerCase();
            const settings = (typeof getFromLocalStorage === 'function')
                ? getFromLocalStorage('SETTING_SCANNER', {})
                : {};

            // Ensure extended config exists
            if (!settings.customRPCsExtended || !settings.customRPCsExtended[chainLower]) {
                console.error(`[RPC Manager] No extended RPC config for ${chainKey}`);
                return null;
            }

            const config = settings.customRPCsExtended[chainLower];
            const allRPCs = [config.primary, ...(config.fallbacks || [])].filter(Boolean);

            if (allRPCs.length === 0) {
                console.error(`[RPC Manager] No RPCs available for ${chainKey}`);
                return null;
            }

            // Find next RPC after current active
            const currentIndex = allRPCs.indexOf(config.active);
            const nextIndex = (currentIndex + 1) % allRPCs.length;
            const nextRPC = allRPCs[nextIndex];

            // Update extended config
            config.active = nextRPC;
            config.lastChecked = Date.now();

            // Update simple config (for backward compatibility)
            if (!settings.customRPCs) settings.customRPCs = {};
            settings.customRPCs[chainLower] = nextRPC;

            // Save settings
            if (typeof saveToLocalStorage === 'function') {
                await saveToLocalStorage('SETTING_SCANNER', settings);
            } else if (typeof saveToLocalStorageAsync === 'function') {
                await saveToLocalStorageAsync('SETTING_SCANNER', settings);
            }

            console.log(`[RPC Manager] Switched ${chainKey} RPC to: ${nextRPC}`);
            return nextRPC;

        } catch(error) {
            console.error(`[RPC Manager] switchToNextRPC failed for ${chainKey}:`, error);
            return null;
        }
    }

    // ====================
    // HELPER FUNCTIONS (For Existing Settings UI)
    // ====================

    /**
     * Sync simple customRPCs with extended config
     * Called from existing settings form (main.js line 476-518)
     */
    async function syncRPCFromSettingsForm() {
        try {
            const settings = (typeof getFromLocalStorage === 'function')
                ? getFromLocalStorage('SETTING_SCANNER', {})
                : {};

            if (!settings.customRPCs) return false;

            // Ensure extended config exists
            if (!settings.customRPCsExtended) {
                settings.customRPCsExtended = {};
            }

            // Sync each chain
            let updated = false;
            Object.keys(settings.customRPCs).forEach(chainKey => {
                const rpcUrl = settings.customRPCs[chainKey];

                if (!settings.customRPCsExtended[chainKey]) {
                    settings.customRPCsExtended[chainKey] = {
                        primary: rpcUrl,
                        fallbacks: RPC_FALLBACKS[chainKey] || [],
                        active: rpcUrl,
                        lastChecked: Date.now(),
                        status: 'unknown'
                    };
                    updated = true;
                } else if (settings.customRPCsExtended[chainKey].active !== rpcUrl) {
                    settings.customRPCsExtended[chainKey].active = rpcUrl;
                    settings.customRPCsExtended[chainKey].primary = rpcUrl;
                    settings.customRPCsExtended[chainKey].lastChecked = Date.now();
                    updated = true;
                }
            });

            if (updated) {
                if (typeof saveToLocalStorage === 'function') {
                    await saveToLocalStorage('SETTING_SCANNER', settings);
                } else if (typeof saveToLocalStorageAsync === 'function') {
                    await saveToLocalStorageAsync('SETTING_SCANNER', settings);
                }
                console.log('[RPC Manager] ✅ Synced customRPCs with extended config');
            }

            return true;
        } catch(error) {
            console.error('[RPC Manager] syncRPCFromSettingsForm failed:', error);
            return false;
        }
    }

    // ====================
    // AUTO-INITIALIZATION
    // ====================

    // Run migration on module load
    if (typeof window !== 'undefined') {
        // Wait for DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => migrateRPCsToSettings(), 1000);
            });
        } else {
            setTimeout(() => migrateRPCsToSettings(), 1000);
        }
    }

    // ====================
    // EXPORT TO GLOBAL
    // ====================

    if (typeof window !== 'undefined') {
        // Override existing getRPC function from utils.js (enhanced with fallback support)
        window.getRPC = getRPC;

        // Export utilities for advanced usage
        window.RPCManager = {
            // Core functions
            getRPC,
            getAllRPCsForChain,
            testRPCHealth,
            switchToNextRPC,
            migrateRPCsToSettings,
            syncRPCFromSettingsForm,

            // Fallback lists (reference)
            RPC_FALLBACKS
        };

        console.log('✅ RPC Manager Loaded - Enhanced getRPC() with Fallback Support');
    }

})();
