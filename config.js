// Telegram config is now defined in secrets.js

const CONFIG_CEX = {
    GATE: {
        WARNA: "#D5006D",  // Pink tua
        LINKS: {
            tradeToken: ({ token }) => `https://www.gate.com/trade/${String(token||'').toUpperCase()}_USDT`,
            tradePair:  ({ pair })  => `https://www.gate.com/trade/${String(pair||'').toUpperCase()}_USDT`,
            withdraw:   ({ token }) => `https://www.gate.com/myaccount/withdraw/${String(token||'').toUpperCase()}`,
            deposit:    ({ pair })  => `https://www.gate.com/myaccount/deposit/${String(pair||'').toUpperCase()}`
        },
        ORDERBOOK: {
            urlTpl: ({ symbol }) => `https://api.gateio.ws/api/v4/spot/order_book?limit=5&currency_pair=${String(symbol||'')}_USDT`,
            parser: 'standard' // use standard orderbook parser
        }
    },
    BINANCE: {
        WARNA: "#e0a50c",  // Orange tua
        LINKS: {
            tradeToken: ({ token }) => `https://www.binance.com/en/trade/${String(token||'').toUpperCase()}_USDT`,
            tradePair:  ({ pair })  => `https://www.binance.com/en/trade/${String(pair||'').toUpperCase()}_USDT`,
            withdraw:   ({ token }) => `https://www.binance.com/en/my/wallet/account/main/withdrawal/crypto/${String(token||'').toUpperCase()}`,
            deposit:    ({ pair })  => `https://www.binance.com/en/my/wallet/account/main/deposit/crypto/${String(pair||'').toUpperCase()}`
        },
        ORDERBOOK: {
            urlTpl: ({ symbol }) => `https://api.binance.me/api/v3/depth?limit=5&symbol=${String(symbol||'')}USDT`,
            parser: 'standard'
        }
    },
    MEXC: {
        WARNA: "#1448ce",  // Biru muda
        LINKS: {
            tradeToken: ({ token }) => `https://www.mexc.com/exchange/${String(token||'').toUpperCase()}_USDT?_from=search`,
            tradePair:  ({ pair })  => `https://www.mexc.com/exchange/${String(pair||'').toUpperCase()}_USDT?_from=search`,
            withdraw:   ({ token }) => `https://www.mexc.com/assets/withdraw/${String(token||'').toUpperCase()}`,
            deposit:    ({ pair })  => `https://www.mexc.com/assets/deposit/${String(pair||'').toUpperCase()}`
        },
        ORDERBOOK: {
            urlTpl: ({ symbol }) => `https://api.mexc.com/api/v3/depth?symbol=${String(symbol||'')}USDT&limit=5`,
            parser: 'standard'
        }
    },
    KUCOIN: {
        WARNA: "#29b3af",
        LINKS: {
            tradeToken: ({ token }) => `https://www.kucoin.com/trade/${String(token||'').toUpperCase()}-USDT`,
            tradePair:  ({ pair })  => `https://www.kucoin.com/trade/${String(pair||'').toUpperCase()}-USDT`,
            withdraw:   ({ token }) => `https://www.kucoin.com/assets/withdraw?currency=${String(token||'').toUpperCase()}`,
            deposit:    ({ token }) => `https://www.kucoin.com/assets/deposit?currency=${String(token||'').toUpperCase()}`
        },
        ORDERBOOK: {
            // KuCoin returns { data: { bids:[[price, size]], asks:[[price, size]] } }
            urlTpl: ({ symbol }) => `https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${String(symbol||'').toUpperCase()}-USDT`,
            parser: 'kucoin'
        }
    },
    BITGET: {
        WARNA: "#1aaaba",
        LINKS: {
            tradeToken: ({ token }) => `https://www.bitget.com/spot/${String(token||'').toUpperCase()}USDT`,
            tradePair:  ({ pair })  => `https://www.bitget.com/spot/${String(pair||'').toUpperCase()}USDT`,
            withdraw:   ({ token }) => `https://www.bitget.com/asset/withdraw?coin=${String(token||'').toUpperCase()}`,
            deposit:    ({ token }) => `https://www.bitget.com/asset/deposit?coin=${String(token||'').toUpperCase()}`
        },
        ORDERBOOK: {
            // Bitget returns { data: { bids:[[price, size]], asks:[[price, size]] } }
            urlTpl: ({ symbol }) => `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${String(symbol||'').toUpperCase()}USDT&limit=5`,
            parser: 'bitget'
        }
    },
    BYBIT: {
        WARNA: "#f29900",
        LINKS: {
            tradeToken: ({ token }) => `https://www.bybit.com/trade/spot/${String(token||'').toUpperCase()}/USDT`,
            tradePair:  ({ pair })  => `https://www.bybit.com/trade/spot/${String(pair||'').toUpperCase()}/USDT`,
            withdraw:   ({ token }) => `https://www.bybit.com/user/assets/withdraw?coin=${String(token||'').toUpperCase()}`,
            deposit:    ({ token }) => `https://www.bybit.com/user/assets/deposit?coin=${String(token||'').toUpperCase()}`
        },
        ORDERBOOK: {
            // Bybit returns { result: { a:[[price, size]], b:[[price, size]] } }
            urlTpl: ({ symbol }) => `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${String(symbol||'').toUpperCase()}USDT&limit=5`,
            parser: 'bybit'
        }
    },
    INDODAX: {
        WARNA: "#1285b5",  
        LINKS: {
            tradeToken: ({ token }) => `https://indodax.com/market/${String(token||'').toUpperCase()}IDR`,
            tradePair:  ({ pair })  => `https://indodax.com/market/${String(pair||'').toUpperCase()}IDR`,
            withdraw:   ({ token }) => `https://indodax.com/finance/${String(token||'').toUpperCase()}#kirim`,
            deposit:    ({ token }) => `https://indodax.com/finance/${String(token||'').toUpperCase()}`
        },
        ORDERBOOK: {
            urlTpl: ({ symbol }) => `https://indodax.com/api/depth/${String(symbol||'').toLowerCase()}idr`,
            parser: 'indodax'
        }
    },   
};

// Merge secrets into CONFIG_CEX (legacy secrets.js)
if (typeof CEX_SECRETS !== 'undefined') {
    for (const cex in CONFIG_CEX) {
        if (CEX_SECRETS[cex]) {
            CONFIG_CEX[cex].ApiKey = CEX_SECRETS[cex].ApiKey;
            CONFIG_CEX[cex].ApiSecret = CEX_SECRETS[cex].ApiSecret;
        }
    }
}


const CONFIG_CHAINS = {   
    polygon: { 
        Kode_Chain: 137, 
        Nama_Chain: "polygon", 
        Nama_Pendek: "poly", 
        URL_Chain: "https://polygonscan.com", 
        ICON: "https://s2.coinmarketcap.com/static/img/coins/200x200/3890.png",
        WARNA:"#a05df6",
        DATAJSON: 'https://multichecker.vercel.app/DATAJSON/poly.json',
        BaseFEEDEX : "MATICUSDT", // Corrected from POLUSDT
        RPC: 'https://polygon-pokt.nodies.app',
        GASLIMIT: 80000,
        DEXS: ["1inch", "odos", "kyberswap", "0x", "okx", "lifi"],
        LINKS: {
            explorer: {
                token: (address) => `https://polygonscan.com/token/${address}`,
                address: (address) => `https://polygonscan.com/address/${address}`,
                tx: (hash) => `https://polygonscan.com/tx/${hash}`
            }
        },
        WALLET_CEX: {
           GATE: { address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chainCEX : 'MATIC' },
           BINANCE: { address : '0x290275e3db66394C52272398959845170E4DCb88', address2 : '0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245', chainCEX : 'MATIC' },          
           MEXC: { address : '0x51E3D44172868Acc60D68ca99591Ce4230bc75E0', chainCEX : 'MATIC' },
           KUCOIN: { address : '0x9AC5637d295FEA4f51E086C329d791cC157B1C84', address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c', chainCEX : 'Polygon POS' },
           BITGET: { address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206', address2 : '0x51971c86b04516062c1e708CDC048CB04fbe959f', address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673', chainCEX : 'Polygon' },
           BYBIT: { address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40', chainCEX : 'Polygon PoS' },
          // INDODAX: { address : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6', address2 : '0x91Dca37856240E5e1906222ec79278b16420Dc92', chainCEX : 'POLYGON' },   
        },
        PAIRDEXS: {
           "USDT": { symbolPair: 'USDT', scAddressPair: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', desPair: '6' },
           "USDC": { symbolPair: 'USDC', scAddressPair: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', desPair: '6' },
           "POL": { symbolPair: 'POL', scAddressPair: '0x0000000000000000000000000000000000001010', desPair: '18' },
           "NON": { symbolPair: "NON", scAddressPair: "0x", desPair: "18" }
        }
    },
    // Other chains remain the same...
    arbitrum: { 
        Kode_Chain: 42161, Nama_Chain: "arbitrum", Nama_Pendek: "arb", URL_Chain: "https://arbiscan.io", WARNA:"#a6b0c3", ICON:"https://wiki.dextrac.com:3443/images/1/11/Arbitrum_Logo.png", DATAJSON: 'https://multichecker.vercel.app/DATAJSON/arb.json', BaseFEEDEX : "ETHUSDT", RPC: 'https://arbitrum-one-rpc.publicnode.com', GASLIMIT: 100000,
        LINKS: {
            explorer: {
                token: (address) => `https://arbiscan.io/token/${address}`,
                address: (address) => `https://arbiscan.io/address/${address}`,
                tx: (hash) => `https://arbiscan.io/tx/${hash}`
            }
        },
        DEXS: ["1inch", "odos", "kyberswap", "0x", "okx", "lifi"],
        WALLET_CEX: {
            GATE: { address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chainCEX : 'ARBITRUM' },
            BINANCE: { address : '0x290275e3db66394C52272398959845170E4DCb88', address2 : '0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245', chainCEX : 'ARBITRUM' },
            MEXC: { address : '0x4982085C9e2F89F2eCb8131Eca71aFAD896e89CB', chainCEX : 'ARB' },
            KUCOIN: { address : '0x03E6FA590CAdcf15A38e86158E9b3D06FF3399Ba', chainCEX : 'ARBITRUM' },
            BITGET: { address : '0x5bdf85216ec1e38d6458c870992a69e38e03f7ef', chainCEX : 'ArbitrumOne' },
            BYBIT: { address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40', chainCEX : 'Arbitrum One' },
        },    
        PAIRDEXS: {  
            "ETH":{ symbolPair: 'ETH', scAddressPair: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', desPair: '18' },
            "USDT":{ symbolPair: 'USDT', scAddressPair: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', desPair: '6' },
            "NON": { symbolPair: "NON", scAddressPair: "0x", desPair: "18" }
        },           
    }, 
    ethereum: { 
        Kode_Chain: 1, Nama_Chain: "ethereum", Nama_Pendek: "erc", URL_Chain: "https://etherscan.io", WARNA:"#8098ee", ICON:"https://icons.iconarchive.com/icons/cjdowner/cryptocurrency-flat/256/Ethereum-ETH-icon.png", DATAJSON: 'https://multichecker.vercel.app/DATAJSON/erc.json', BaseFEEDEX : "ETHUSDT", RPC: 'https://eth.llamarpc.com', GASLIMIT: 250000,
        LINKS: {
            explorer: {
                token: (address) => `https://etherscan.io/token/${address}`,
                address: (address) => `https://etherscan.io/address/${address}`,
                tx: (hash) => `https://etherscan.io/tx/${hash}`
            }
        },
        DEXS: ["1inch", "odos", "kyberswap", "0x", "okx", "lifi"],
        WALLET_CEX: {
            GATE: { address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chainCEX : 'ETH' },
            BINANCE: { address : '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', address2 : '0x28C6c06298d514Db089934071355E5743bf21d60', address3 : '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', chainCEX : 'ETH' },
            INDODAX: { address : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6', address2 : '0x91Dca37856240E5e1906222ec79278b16420Dc92', chainCEX : 'ETH' }, 
            MEXC: { address : '0x75e89d5979E4f6Fba9F97c104c2F0AFB3F1dcB88', address2 : '0x9642b23Ed1E01Df1092B92641051881a322F5D4E', chainCEX : 'ETH' },
            KUCOIN: { address : '0x58edF78281334335EfFa23101bBe3371b6a36A51', address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c', chainCEX : 'ERC20' },
            BITGET: { address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206', address2 : '0x51971c86b04516062c1e708CDC048CB04fbe959f', address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673', chainCEX : 'ERC20' },
            BYBIT: { address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40', address2 : '0xf89d7b9c864f589bbF53a82105107622B35EaA40', chainCEX : 'Ethereum' },
        },
        PAIRDEXS: {  
            "ETH":{ symbolPair: 'ETH', scAddressPair: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', desPair: '18' },
            "USDT":{ symbolPair: 'USDT', scAddressPair: '0xdAC17F958D2ee523a2206206994597C13D831ec7', desPair: '6' },
            "BNT":{ symbolPair: 'BNT', scAddressPair: '0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C', desPair: '18' },
            "NON": { symbolPair: "NON", scAddressPair: "0x", desPair: "18" }
        } 
    }, 
    bsc: { 
        Kode_Chain: 56, Nama_Chain: "bsc", Nama_Pendek: "bsc", URL_Chain: "https://bscscan.com", WARNA:"#f0af18", ICON:"https://bridge.umbria.network/assets/images/svg/bsc.svg", DATAJSON: 'https://multichecker.vercel.app/DATAJSON/bsc.json', BaseFEEDEX : "BNBUSDT", RPC: 'https://bsc-dataseed.binance.org/', GASLIMIT: 80000,
        LINKS: {
            explorer: {
                token: (address) => `https://bscscan.com/token/${address}`,
                address: (address) => `https://bscscan.com/address/${address}`,
                tx: (hash) => `https://bscscan.com/tx/${hash}`
            }
        },
        DEXS: ["1inch", "odos", "kyberswap", "0x", "lifi", "okx"],
        WALLET_CEX: {
            GATE: { address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chainCEX : 'BSC' },
            BINANCE: { address : '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3', address2 : '0xe2fc31F816A9b94326492132018C3aEcC4a93aE1', chainCEX : 'BSC' },
            MEXC: { address : '0x4982085C9e2F89F2eCb8131Eca71aFAD896e89CB', chainCEX : 'BSC' }, 
            INDODAX: { address : '0xaBa3002AB1597433bA79aBc48eeAd54DC10A45F2', address2 : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6', chainCEX : 'BSC' },
            KUCOIN: { address : '0x58edF78281334335EfFa23101bBe3371b6a36A51', address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c', chainCEX : 'BEP20' },
            BITGET: { address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206', address2 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673', address3 : '0x51971c86b04516062c1e708CDC048CB04fbe959f', chainCEX : 'BEP20' },
            BYBIT: { address : '0xf89d7b9c864f589bbf53a82105107622b35eaa40', chainCEX : 'BSC' },
        },
        PAIRDEXS: {
            "BNB": { symbolPair: "BNB", scAddressPair: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", desPair: "18" },
            "USDT": { symbolPair: "USDT", scAddressPair: "0x55d398326f99059fF775485246999027B3197955", desPair: "18" },
            "ETH": { symbolPair: "ETH", scAddressPair: "0x2170ed0880ac9a755fd29b2688956bd959f933f8", desPair: "18" },
            "NON": { symbolPair: "NON", scAddressPair: "0x", desPair: "18" }
        }        
    },
    base: { 
        Kode_Chain: 8453, Nama_Chain: "base", Nama_Pendek: "base", URL_Chain: "https://basescan.org/", WARNA:"#1e46f9", ICON:"https://avatars.githubusercontent.com/u/108554348?v=4", DATAJSON: 'https://multichecker.vercel.app/DATAJSON/base.json', BaseFEEDEX : "ETHUSDT", RPC: 'https://base.llamarpc.com', GASLIMIT: 100000,
        LINKS: {
            explorer: {
                token: (address) => `https://basescan.org/token/${address}`,
                address: (address) => `https://basescan.org/address/${address}`,
                tx: (hash) => `https://basescan.org/tx/${hash}`
            }
        },
        DEXS: ["1inch", "odos", "kyberswap", "0x", "okx", "lifi"],
        WALLET_CEX: {
            GATE: { address: '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chainCEX: 'BASE' },
            BINANCE: { address: '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', address2: '0x28C6c06298d514Db089934071355E5743bf21d60', chainCEX: 'BASE' },
            MEXC: { address : '0x4e3ae00E8323558fA5Cac04b152238924AA31B60', chainCEX : 'BASE' },
            INDODAX: { address : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6', address2 : '0x91Dca37856240E5e1906222ec79278b16420Dc92', chainCEX : 'POLYGON' },   
            KUCOIN: { address: '0x58edF78281334335EfFa23101bBe3371b6a36A51', address2: '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c', chainCEX: 'Base' },
            BITGET: { address: '0x0639556F03714A74a5fEEaF5736a4A64fF70D206', address2: '0x51971c86b04516062c1e708CDC048CB04fbe959f', address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673', chainCEX: 'BASE' },
            BYBIT: { address: '0xf89d7b9c864f589bbF53a82105107622B35EaA40', address2: '0xf89d7b9c864f589bbF53a82105107622B35EaA40', chainCEX: 'Base Mainnet' },
        },        
        PAIRDEXS: {
           "ETH": { symbolPair: 'ETH', scAddressPair: '0x4200000000000000000000000000000000000006', desPair: '18' },
           "USDC":{ symbolPair: 'USDC', scAddressPair: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', desPair: '6' },
           "NON": { symbolPair: "NON", scAddressPair: "0x", desPair: "18" }
        }        
    }       
};

const CONFIG_DEXS = {
    kyberswap: {
        STRATEGY: 'kyberswap',
        builder: ({ chainName, tokenAddress, pairAddress }) => `https://kyberswap.com/swap/${chainName}/${tokenAddress}-to-${pairAddress}`,
        allowFallback: false,
    },
    '0x': {
        STRATEGY: '0x',
        builder: ({ chainName, tokenAddress, pairAddress, chainCode }) => `https://matcha.xyz/tokens/${chainName}/${tokenAddress.toLowerCase()}?buyChain=${chainCode}&buyAddress=${pairAddress.toLowerCase()}`,
        allowFallback: false,
    },
    odos: {
        STRATEGY: 'odos',
        builder: () => `https://app.odos.xyz`,
        allowFallback: true,
    },
    okx: {
        STRATEGY: 'okx',
        builder: ({ chainCode, tokenAddress, pairAddress }) => `https://www.okx.com/web3/dex-swap?inputChain=${chainCode}&inputCurrency=${tokenAddress}&outputChain=501&outputCurrency=${pairAddress}`,
        allowFallback: false,
    },
    '1inch': {
        STRATEGY: '1inch',
        builder: ({ chainCode, tokenAddress, pairAddress }) => `https://app.1inch.io/advanced/swap?network=${chainCode}&src=${tokenAddress}&dst=${pairAddress}`,
        //allowFallback: true,
    },
    lifi: {
        STRATEGY: 'lifi',
        builder: ({ chainCode, tokenAddress, pairAddress }) => `https://jumper.exchange/?fromChain=${chainCode}&fromToken=${tokenAddress}&toChain=${chainCode}&toToken=${pairAddress}`,
       // allowFallback: true,
    },
};
     
// Expose globals for runtime consumers (registry/services)
window.CONFIG_CEX = window.CONFIG_CEX || CONFIG_CEX;
window.CONFIG_CHAINS = window.CONFIG_CHAINS || CONFIG_CHAINS;

// Centralized chain synonyms mapping used to normalize CEX network labels
const CHAIN_SYNONYMS = {
    ethereum: ['ETH','ERC20','ETHEREUM'],
    bsc: ['BSC','BEP20','BINANCE SMART CHAIN','BNB SMART CHAIN','BEP-20'],
    polygon: ['POLYGON','MATIC','POLYGON POS','POLYGON (MATIC)','POL'],
    arbitrum: ['ARBITRUM','ARB','ARBITRUM ONE','ARBEVM','ARBITRUMONE','ARB-ETH'],
    base: ['BASE','BASE MAINNET','BASEEVM']
};

try { if (typeof window !== 'undefined') { window.CHAIN_SYNONYMS = window.CHAIN_SYNONYMS || CHAIN_SYNONYMS; } } catch(_){}
