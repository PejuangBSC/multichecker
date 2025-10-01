const CONFIG_CEX = {
    GATE: {
        ApiKey: "1dbe3d4c92a42de270692e65952574d0",
        ApiSecret: "9436bfec02a8ed462bda4bd1a516ba82b4f322dd09e120a2bf7ea6b5f0930ef8",
        WARNA: "#D5006D",  // Pink tua
    },
    BINANCE: {
        ApiKey: "2U7YGMEUDri6tP3YEzmK3CcZWb9yQ5j3COp9s7pRRUv4vu8hJAlwH4NkbNK74hDU",
        ApiSecret: "XHjPVjLzbs741xoznV3xz1Wj5SFrcechNBjvezyXLcg8GLWF21VW32f0YhAsQ9pn",
        WARNA: "#e0a50c",  // Orange tua
    },
    MEXC: {
        ApiKey: "mx0vglBh22wwHBY0il", // Ganti dengan ApiKey asli
        ApiSecret: "429877e0b47c41b68dd77613cdfded64", // Ganti dengan ApiSecret asli
        WARNA: "#1448ce",  // Biru muda
    },
    KUCOIN: {
        ApiKey: "651e1c4379c8be0001bab637",
        ApiSecret: "a184c3c1-65f2-4042-a043-c5c23c6ba258",
        ApiPassphrase: "Arekpinter123",
        WARNA: "#096309",  // Hijau tua
    },
    BYBIT: {
        ApiKey: "G5GKWUmyKAFLGdzuh6",
        ApiSecret: "CA0NKA9NM4l4Zzt5L9id4UAeuaHvU3db8K0r",
        WARNA: "#17181f",  // Hitam pekat
    },
    BITGET: {
        ApiKey: "bg_5f46cf8f91f1bc0e2484e9eaa2924d89", // Ganti dengan ApiKey asli
        ApiSecret: "15efb783b9ef00a5123b890f54681e1c3b85f8dd614d8b804ac8a54b9cf9d227", // Ganti dengan ApiSecret asli
        ApiPassphrase: "Macpro2024",
        WARNA: "#",  // Biru muda
    },
    // BITMART: {
    //     ApiKey: "2765addadf3cffd41096be224d282c9f3d9f056a", // Ganti dengan ApiKey asli
    //     ApiSecret: "d3805f1fde6c9ed4b8faa490b57bc7e0ffda7ed8d622bd5d164b91f6fbb209dd", // Ganti dengan ApiSecret asli
    //     WARNA: "#e90b0b",  
    // },
    // INDODAX: {
    //     ApiKey: "xxx", // Ganti dengan ApiKey asli
    //     ApiSecret: "xxx", // Ganti dengan ApiSecret asli
    //     WARNA: "#1285b5",  
    // },
    // COINEX: {
    //     ApiKey: "xxx", // Ganti dengan ApiKey asli
    //     ApiSecret: "xxx", // Ganti dengan ApiSecret asli
    //     WARNA: "gray",  
    // },
    OKX: {
       ApiKey: "4d6226e8-c858-42b5-a32e-60b6ce8b4bdc", // Ganti dengan ApiKey asli
       ApiSecret: "3EB8717DE58187BAE45E282EB0045CE3", // Ganti dengan ApiSecret asli
       ApiPassphrase:"Macpro-2025",
       WARNA: "#17181f",  // Hitam pekat
   }, 
    // BINGX: {
    //     ApiKey: "SzIlW3vcRtb6Vi1y7oP3fWn6N6voH43nBzAtcLbGeutfM9INoXYhXvTMFyZgIL7jJh29gbVuYqvZTC9dVzWg", // Ganti dengan ApiKey asli
    //     ApiSecret: "vlnX8qRSsKiudu3rk1KXTQtFBcD32qOXxXgJont9Z1Ccz1ZFfuFhkirI31iKrN11NhXNcVqJvpSEOA5YhfyAQ", // Ganti dengan ApiSecret asli
    //     WARNA: "#2a55ff",  // Hitam pekat
    // }
};


const CONFIG_CHAINS = {
    
    polygon: { 
        Kode_Chain: 137, 
        Nama_Chain: "polygon", 
        URL_Chain: "https://polygonscan.com", 
        ICON: "https://s2.coinmarketcap.com/static/img/coins/200x200/3890.png",
        WARNA:"#a05df6",
        DATAJSON: 'https://multichecker.vercel.app/V3/poly.json',
        BaseFEEDEX : "POLUSDT",
        DEXS: [
            "1inch",
            "odos",
            "kyberswap",
            "0x",
            "magpie",
            //"paraswap",
           // "lifi",
           // "bebop",
            "okx"
        ],
        WALLET_CEX: {
           GATE: {
               address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
               address2 : '#',
               chainCEX : 'MATIC',
           },
           BINANCE: {
               address : '0x290275e3db66394C52272398959845170E4DCb88',
               address2 : '0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245',
               chainCEX : 'MATIC',
           },
           KUCOIN: {
               address : '0x9AC5637d295FEA4f51E086C329d791cC157B1C84',
               address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c',
               chainCEX : 'Polygon POS',
           }, 
           BITGET: {
               address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206',
               address2 : '0x51971c86b04516062c1e708CDC048CB04fbe959f',
               address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673',
               chainCEX : 'Polygon',
           }, 
        //    BITMART: {
        //     address : '0x2982bB64bcd07Ac3315C32Cb2BB7e5E8a2De7d67',
        //     address2 : '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d',
        //     chainCEX : 'POLYGON',
        //    }, 
           BYBIT: {
               address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
               address2 : '#',
               chainCEX : 'Polygon PoS',
           },
           MEXC: {
            address : '0x51E3D44172868Acc60D68ca99591Ce4230bc75E0',
            address2 : '#',
            chainCEX : 'MATIC',
          },
        //   BINGX: {
        //     address : '0x',
        //     address2 : '#',
        //     chainCEX : 'POLYGON',
        //   },
        //    OKX: {
        //         address : '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B',
        //         address2 : '#',
        //         chainCEX : 'Polygon',
        //     },   
            // INDODAX: {
            //     address : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6',
            //     address2 : '0x91Dca37856240E5e1906222ec79278b16420Dc92',                
            //     chainCEX : 'POLYGON',
            //    },   
        },
        PAIRDEXS: {
           "USDT": {
                symbolPair: 'USDT',
                scAddressPair: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
                desPair: '6',
             },
             "POL": {
                symbolPair: 'POL',
                scAddressPair: '0x0000000000000000000000000000000000001010',
                desPair: '18',
             },
            "NON": {
                symbolPair: "NON",
                scAddressPair: "0x",
                desPair: "18"
            }
        }
    },
    arbitrum: { 
        Kode_Chain: 42161, 
        Nama_Chain: "arbitrum", 
        URL_Chain: "https://arbiscan.io" ,
        WARNA:"#a6b0c3",
        ICON:"https://wiki.dextrac.com:3443/images/1/11/Arbitrum_Logo.png",
        DATAJSON: 'https://multichecker.vercel.app/V3/arb.json',
        BaseFEEDEX : "ETHUSDT",
        DEXS: [
            "1inch",
            "odos",
            "kyberswap",
            "0x",
            "magpie",
            //"paraswap",
            //"lifi",
            "okx"
        ],
        WALLET_CEX: {
            GATE: {
                address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
                address2 : '#',
                chainCEX : 'ARBEVM',
            },
            BINANCE: {
                address : '0x290275e3db66394C52272398959845170E4DCb88',
                address2 : '0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245',
                chainCEX : 'ARBITRUM',
            },
            KUCOIN: {
                address : '0x03E6FA590CAdcf15A38e86158E9b3D06FF3399Ba',
                address2 : '#',
                chainCEX : 'ARBITRUM',
            }, 
            BITGET: {
                address : '0x5bdf85216ec1e38d6458c870992a69e38e03f7ef',
                 address2 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673',
                address2 : '#',
                chainCEX : 'ArbitrumOne',
            }, 
            // BITMART: {
            //     address : '0x2982bB64bcd07Ac3315C32Cb2BB7e5E8a2De7d67',
            //     address2 : '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d',
            //     chainCEX : 'Arbitrum',
            //    }, 
            BYBIT: {
                address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
                address2 : '#',
                chainCEX : 'Arbitrum One',
            },
            MEXC: {
                address : '0x4982085C9e2F89F2eCb8131Eca71aFAD896e89CB',
                address2 : '#',
                chainCEX : 'ARB',
            },
            // BINGX: {
            //     address : '0x',
            //     address2 : '#',
            //     chainCEX : 'ARBITRUM',
            //   },
    
            //  OKX: {
            //     address : '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b',
            //     address2 : '#',
            //     chainCEX : 'Arbitrum One',
            // }, 
        },    
        PAIRDEXS: {  
                "ETH":{
                    symbolPair: 'ETH',
                    scAddressPair: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
                    desPair: '18',
                },
                "USDT":{
                    symbolPair: 'USDT',
                    scAddressPair: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
                    desPair: '6',
                },
                "NON": {
                    symbolPair: "NON",
                    scAddressPair: "0x",
                    desPair: "18"
                }
            },           
    }, 
    ethereum: { 
        Kode_Chain: 1, 
        Nama_Chain: "ethereum", 
        URL_Chain: "https://etherscan.io" ,
        WARNA:"#8098ee",
        ICON:"https://icons.iconarchive.com/icons/cjdowner/cryptocurrency-flat/256/Ethereum-ETH-icon.png",
        DATAJSON: 'https://multichecker.vercel.app/V3/erc.json',
        BaseFEEDEX : "ETHUSDT",
        DEXS: [
            "1inch",
            "odos",
            "kyberswap",
            "0x",
            "magpie",
            //"paraswap",
            //"lifi",
            "okx",
          //  "bebop"
        ],
          WALLET_CEX: {
            GATE: {
                address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
                address2 : '#',
                chainCEX : 'ETH',
            },
            BINANCE: {
                address : '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d',
                address2 : '0x28C6c06298d514Db089934071355E5743bf21d60',
                address3 : '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549',
                chainCEX : 'ETH',
            },
            KUCOIN: {
                address : '0x58edF78281334335EfFa23101bBe3371b6a36A51',
                address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c',
                chainCEX : 'ERC20',
            }, 
            BITGET: {
                address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206',
                address2 : '0x51971c86b04516062c1e708CDC048CB04fbe959f',
                address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673',
                chainCEX : 'ERC20',
            }, 
            // INDODAX: {
            //     address : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6',
            //     address2 : '0x91Dca37856240E5e1906222ec79278b16420Dc92',                
            //     chainCEX : 'ETH',
            //    }, 
            // COINEX: {
            //     address : '0x20145C5e27408B5C1CF2239d0115EE3BBc27CbD7',
            //     chainCEX : 'ETH',
            //    }, 
            BYBIT: {
                address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
                address2 : '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
                chainCEX : 'Ethereum',
            },
            MEXC: {
                address : '0x75e89d5979E4f6Fba9F97c104c2F0AFB3F1dcB88',
                address2 : '0x9642b23Ed1E01Df1092B92641051881a322F5D4E',
                chainCEX : 'ETH',
            },
            // OKX: {
            //     address : '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b',
            //     address2 : '#',
            //     chainCEX : 'ERC20',
            // }, 
            // BITMART: {
            //     address : '0x2982bB64bcd07Ac3315C32Cb2BB7e5E8a2De7d67',
            //     address2 : '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d',
            //     chainCEX : 'ETH',
            // }, 
            // BINGX: {
            //     address : '0x',
            //     address2 : '#',
            //     chainCEX : 'ERC20',
            // }, 
          },
        PAIRDEXS: {  
            "ETH":{
                symbolPair: 'ETH',
                scAddressPair: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
                desPair: '18',
            },
            "USDT":{
                symbolPair: 'USDT',
                scAddressPair: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                desPair: '6',
            },
            "BNT":{
                symbolPair: 'BNT',
                scAddressPair: '0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C',
                desPair: '18',
            },
            "USDC":{
                symbolPair: 'USDC',
                scAddressPair: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                desPair: '6',
            },
            "NON": {
                symbolPair: "NON",
                scAddressPair: "0x",
                desPair: "18"
            }
        } 
    }, 
    bsc: { 
        Kode_Chain: 56, 
        Nama_Chain: "bsc", 
        URL_Chain: "https://bscscan.com" , 
        WARNA:"#f0af18",
        ICON:"https://bridge.umbria.network/assets/images/svg/bsc.svg",
        DATAJSON: 'https://multichecker.vercel.app/V3/bsc.json',
        BaseFEEDEX : "BNBUSDT",
        DEXS: [
            "1inch",
            "odos",
            "kyberswap",
            "0x",
            "magpie",
            //"paraswap",
            //"lifi",
           // "bebop",
            "okx"
        ],
        WALLET_CEX: {
            GATE: {
                address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
                address2 : '#',
                chainCEX : 'BSC',
            },
            BINANCE: {
                address : '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3',
                address2 : '0xe2fc31F816A9b94326492132018C3aEcC4a93aE1',
                chainCEX : 'BSC',
            },
            KUCOIN: {
                address : '0x58edF78281334335EfFa23101bBe3371b6a36A51',
                address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c',
                chainCEX : 'BEP20',
            }, 
            BITGET: {
                address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206',
                address3 : '0x51971c86b04516062c1e708CDC048CB04fbe959f',
                address2 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673',
                chainCEX : 'BEP20',
            }, 
            // BITMART: {
            //     address : '0x2982bB64bcd07Ac3315C32Cb2BB7e5E8a2De7d67',
            //     address2 : '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d',
            //     chainCEX : 'BSC_BNB',
            //    }, 
            // COINEX: {
            //     address : '0xC9d23ED2ADB0f551369946BD377f8644cE1ca5c4',
            //     chainCEX : 'BSC',
            //    }, 
            BYBIT: {
                address : '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
                address2 : '#',
                chainCEX : 'BNB Smart Chain',
            },  
            MEXC: {
                address : '0x4982085C9e2F89F2eCb8131Eca71aFAD896e89CB',
                address2 : '#',
                chainCEX : 'BSC',
            }, 
            // OKX: {
            //     address : '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b',
            //     address2 : '#',
            //     chainCEX : 'BSC',
            // }, 
//             INDODAX: {
//                 address : '0xaBa3002AB1597433bA79aBc48eeAd54DC10A45F2',
//                 address2 : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6',
//                 address : '0x91Dca37856240E5e1906222ec79278b16420Dc92',  
//                 chainCEX : 'BSC',
//                }, 
            // BINGX: {
            //     address : '0x',
            //     address2 : '#',
            //     chainCEX : 'BEP20',
            // },    
        },
        PAIRDEXS: {
            "BNB": {
                symbolPair: "BNB",
                scAddressPair: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
                desPair: "18"
            },
            "USDT": {
                symbolPair: "USDT",
                scAddressPair: "0x55d398326f99059fF775485246999027B3197955",
                desPair: "18"
            },
            "USDC": {
                symbolPair: "USDC",
                scAddressPair: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
                desPair: "18"
            },
            // "BTC": {
            //     symbolPair: "BTC",
            //     scAddressPair: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
            //     desPair: "18"
            // },
            // "ETH": {
            //     symbolPair: "ETH",
            //     scAddressPair: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
            //     desPair: "18"
            // },
            "NON": {
                symbolPair: "NON",
                scAddressPair: "0x",
                desPair: "18"
            }
        }        
    },
    /*
    solana: { 
        Kode_Chain: 501, 
        Nama_Chain: "solana", 
        URL_Chain: "https://solscan.io/" , 
        WARNA:"#d483f4",
        ICON:"https://cdn.iconscout.com/icon/premium/png-256-thumb/solana-sol-7152167-5795323.png",
        DATAJSON: 'https://multichecker.vercel.app/V3/sol.json',
        BaseFEEDEX : "SOLUSDT",
        DEXS: [
            "okx",
            "0x",
            "jupiter",
        ],
        
          WALLET_CEX: { 
            GATE: {
                address : 'HiRpdAZifEsZGdzQ5Xo5wcnaH3D2Jj9SoNsUzcYNK78J',
                address2 : 'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w',
                chainCEX : 'SOL',
            },
            BINANCE: {
                address : '28nYGHJyUVcVdxZtzKByBXEj127XnrUkrE3VaGuWj1ZU',
                address2 : '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
                chainCEX : 'SOL',
            },
            KUCOIN: {
                address : 'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6',
                address2 : 'EkUy8BB574iEVAQE9dywEiMhp9f2mFBuFu6TBKAkQxFY',
                chainCEX : 'SOL',
            }, 
            BITGET: {
                address : 'A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR',
                address2 : '#',
                chainCEX : 'SOL',
            }, 
            // BITMART: {
            //     address : 'xxx',
            //     chainCEX : 'SOL',
            //    }, 
            BYBIT: {
                address : 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2',
                address2 : '42brAgAVNzMBP7aaktPvAmBSPEkehnFQejiZc53EpJFd',
                chainCEX : 'SOL',
            },  
            MEXC: {
                address : 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2',
                address2 : '42brAgAVNzMBP7aaktPvAmBSPEkehnFQejiZc53EpJFd',
                chainCEX : 'SOL',
            }, 
            // BINGX: {
            //     address : '0x',
            //     address2 : '#',
            //     chainCEX : 'SOL',
            // },
            // OKX: {
            //     address : 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2',
            //     address2 : '42brAgAVNzMBP7aaktPvAmBSPEkehnFQejiZc53EpJFd',
            //     chainCEX : 'Solana',
            // }, 
            // INDODAX: {
            //     address : 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2',
            //     chainCEX : 'SOL',
            // },      
         }, 
         PAIRDEXS: {
            "SOL": {
                 symbolPair: 'SOL',
                 scAddressPair: 'So11111111111111111111111111111111111111112',
                 desPair: '9',
             },
             "USDT":{
                 symbolPair: 'USDT',
                 scAddressPair: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
                 desPair: '6',
             },
             "NON": {
                 symbolPair: "NON",
                 scAddressPair: "0x",
                 desPair: "18"
             }
         }  
    },
    
    avax: { 
        Kode_Chain: 43114, 
        Nama_Chain: "avax", 
        URL_Chain: "https://snowtrace.io" , 
        WARNA:"#f28d8e",
        ICON:"https://cryptologos.cc/logos/avalanche-avax-logo.png",
        DATAJSON: 'https://multichecker.vercel.app/JSON/avax_multi.json',
        BaseFEEDEX : "AVAXUSDT",
        DEXS: [
            //"1inch",
            "odos",
            "kyberswap",
            "0x",
            "magpie",
            "okx"
        ],
        WALLET_CEX: {
            GATE: {
                address : '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
                address2 : '#',
                chainCEX : 'AVAX_C',
            },
            BINANCE: {
                address : '0x6D8bE5cdf0d7DEE1f04E25FD70B001AE3B907824',
                address2 : '0xe2fc31F816A9b94326492132018C3aEcC4a93aE1',
                chainCEX : 'AVAXC',
            },
            KUCOIN: {
                address : '0x58edF78281334335EfFa23101bBe3371b6a36A51',
                address2 : '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c',
                chainCEX : 'AVAX C-Chain',
            }, 
            BITGET: {
                address : '0x0639556F03714A74a5fEEaF5736a4A64fF70D206',
                address2 : '0x51971c86b04516062c1e708CDC048CB04fbe959f',
                address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673',
                chainCEX : 'AVAXC-Chain',
            }, 
            BITMART: {
                address : '0x2982bB64bcd07Ac3315C32Cb2BB7e5E8a2De7d67',
                address2 : '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d',
                chainCEX : 'AVAX-C',
               },  
            BYBIT: {
                address : '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
                address2 : '#',
                chainCEX : 'CAVAX',
            },  
            MEXC: {
                address : '0xffB3118124cdaEbD9095fA9a479895042018cac2',
                address2 : '#',
                chainCEX : 'AVAX_CCHAIN',
            }, 
            OKX: {
                address : '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b',
                address2 : '#',
                chainCEX : 'Avalanche C-Chain',
            }, 
        },
        PAIRDEXS: {
            "USDT":{
                symbolPair: 'USDT',
                scAddressPair: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
                desPair: '6',
            },
            "AVAX":{
                symbolPair: 'AVAX',
                scAddressPair: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                desPair: '18',
            }
        }
    }, 
    */
    base: { 
        Kode_Chain: 8453, 
        Nama_Chain: "base", 
        URL_Chain: "https://basescan.org/", 
        WARNA:"#1e46f9",
        ICON:"https://avatars.githubusercontent.com/u/108554348?v=4",
        DATAJSON: 'https://multichecker.vercel.app/V3/base.json',
        BaseFEEDEX : "ETHUSDT",
        DEXS: [
            "1inch",
            "odos",
            "kyberswap",
            "0x",
            //"paraswap",
            "magpie",
            "okx"          
        ],
        WALLET_CEX: {
            GATE: {
                address: '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
                chainCEX: 'BASEEVM',
            },
            BINANCE: {
                address: '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d',
                address2: '0x28C6c06298d514Db089934071355E5743bf21d60',
                chainCEX: 'BASE',
            },
            KUCOIN: {
                address: '0x58edF78281334335EfFa23101bBe3371b6a36A51',
                address2: '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c',
                chainCEX: 'Base',
            },
            BYBIT: {
                address: '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
                address2: '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
                chainCEX: 'Base Mainnet',
            },
            BITGET: {
                address: '0x0639556F03714A74a5fEEaF5736a4A64fF70D206',
                address2: '0x51971c86b04516062c1e708CDC048CB04fbe959f',
                address3 : '0xBDf5bAfEE1291EEc45Ae3aadAc89BE8152D4E673',
                chainCEX: 'BASE',
            }, 
            // BITMART: {
            //     address : '0x2982bB64bcd07Ac3315C32Cb2BB7e5E8a2De7d67',
            //     address2 : '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d',
            //     chainCEX : 'BASE-ETH',
            //    }, 
            MEXC: {
                address : '0x4e3ae00E8323558fA5Cac04b152238924AA31B60',
                address2 : '#',
                chainCEX : 'BASE',
            },
            // OKX: {
            //     address : '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b',
            //     address2 : '#',
            //     chainCEX : 'Base',
            // },
            // INDODAX: {
            //     address : '0x3C02290922a3618A4646E3BbCa65853eA45FE7C6',
            //     address2 : '0x91Dca37856240E5e1906222ec79278b16420Dc92',                
            //     chainCEX : 'POLYGON',
            //    },   
            // BINGX: {
            //     address : '0x',
            //     address2 : '#',
            //     chainCEX : 'BASE',
            // },        

        },        
        PAIRDEXS: {
           "ETH": {
                symbolPair: 'ETH',
                scAddressPair: '0x4200000000000000000000000000000000000006',
                desPair: '18',
            },
            "USDC":{
                symbolPair: 'USDC',
                scAddressPair: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                desPair: '6',
            },
            "NON": {
                symbolPair: "NON",
                scAddressPair: "0x",
                desPair: "18"
            }
        }        
    },     
};

