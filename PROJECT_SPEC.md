# PROJECT SPECIFICATION - MULTICHECKER ARBITRAGE SCANNER

## Tujuan

Aplikasi web-based arbitrage scanner yang memantau perbedaan harga antara Centralized Exchanges (CEX) dan Decentralized Exchanges (DEX) untuk menemukan peluang trading profit. Aplikasi ini dirancang untuk trader yang ingin mengidentifikasi dan memanfaatkan price discrepancies secara real-time.

### Fitur Utama
- **Multi-Exchange Scanning**: Mendukung 7 CEX (GATE, BINANCE, MEXC, KUCOIN, BITGET, BYBIT, INDODAX)
- **Multi-DEX Integration**: Integrasi dengan 6 DEX aggregator (Kyber, 1inch, Odos, 0x, OKX, LiFi)
- **Multi-Chain Support**: Operasi di 5 blockchain (Ethereum, BSC, Polygon, Arbitrum, Base)
- **Real-time Monitoring**: UI live update dengan progress tracking
- **Telegram Notifications**: Alert otomatis untuk peluang profit
- **Token Management**: CRUD interface untuk mengelola daftar token
- **Advanced Filtering**: Filter berdasarkan chain, CEX, DEX, dan pair
- **Data Persistence**: Backup/restore functionality dengan IndexedDB

## Arsitektur

### Arsitektur Aplikasi
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Presentation  │    │   Application   │    │     Service     │
│      Layer      │◄──►│      Layer      │◄──►│      Layer      │
│                 │    │                 │    │                 │
│ • HTML/CSS/JS   │    │ • Event-driven  │    │ • API Clients   │
│ • UIKit UI      │    │ • State Mgmt    │    │ • Telegram Bot  │
│ • Dark Mode     │    │ • Orchestration │    │ • Storage Abst. │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Data        │    │   External      │    │   Browser       │
│     Layer       │    │   APIs         │    │   Storage       │
│                 │    │                 │    │                 │
│ • IndexedDB     │    │ • CEX APIs      │    │ • localStorage  │
│ • In-memory     │    │ • DEX APIs      │    │ • Cache         │
│ • Backup/Restore│    │ • CORS Proxies  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Pola Arsitektur
- **Modular Architecture**: Kode terpisah per concern (UI, scanning, API, storage)
- **Event-driven**: Komunikasi antar modul melalui custom events
- **Client-side Storage**: Data persistence menggunakan IndexedDB dengan localStorage fallback
- **Service-oriented**: API integrations diisolasi dalam service modules

## Modul

### Core Modules

#### [`scanner.js`](scanner.js)
**Fungsi**: Logic utama scanning arbitrage
- Orchestrasi scanning process untuk multiple tokens
- Batch processing dengan jeda antar token
- Error handling dan timeout management
- Progress tracking dan UI updates
- **State Variables**:
  - `isScanRunning`: Status scanning aktif
  - `window._DEX_WATCHDOGS`: Map timeout handlers per DEX request
  - `window._DEX_TICKERS`: Map countdown timers
  - `window.__LOCKED_DEX_LIST`: DEX list terkunci selama scan

#### [`services/dex.js`](services/dex.js)
**Fungsi**: Integrasi DEX aggregator APIs
- Strategy pattern untuk berbagai DEX providers
- Request building dan response parsing
- Fallback mechanism (SWOOP service)
- Rate limiting dan error handling
- **Key Functions**:
  - `getPriceDEX()`: Main DEX price fetching
  - `getPriceSWOOP()`: Fallback service
  - `dexStrategies`: Map strategi per DEX

#### [`dom-renderer.js`](dom-renderer.js)
**Fungsi**: Rendering dan manipulasi DOM untuk monitoring table
- Dynamic table generation berdasarkan active DEX list
- Chunked rendering untuk performance
- Signal card management
- **Key Functions**:
  - `loadKointoTable()`: Main table renderer
  - `DisplayPNL()`: Result display dengan formatting
  - `InfoSinyal()`: Signal notification system

#### [`ui.js`](ui.js)
**Fungsi**: UI controls dan state management
- Form validation dan gating
- Theme switching (dark/light mode)
- Filter controls management
- **Key Functions**:
  - `applyControlsFor()`: UI state gating
  - `RenderCardSignal()`: Signal panel rendering
  - `form_off()`/`form_on()`: UI lockdown selama scan

#### [`main.js`](main.js)
**Fungsi**: Application orchestration dan initialization
- Bootstrap application
- Event binding dan routing
- Mode switching (single/multi-chain)
- **Key Functions**:
  - `bootApp()`: Application startup
  - `cekDataAwal()`: Initial data validation
  - `refreshTokensTable()`: Table refresh logic

#### [`api.js`](api.js)
**Fungsi**: Network operations dan external API integrations
- CEX orderbook fetching
- Gas fee monitoring
- Telegram notifications
- **Key Functions**:
  - `getPriceCEX()`: CEX price fetching
  - `feeGasGwei()`: Gas price monitoring
  - `MultisendMessage()`: Telegram alerts

#### [`storage.js`](storage.js)
**Fungsi**: Data persistence layer
- IndexedDB operations
- Backup/restore functionality
- Cross-tab synchronization
- **Key Functions**:
  - `getFromLocalStorage()`: Data retrieval
  - `saveToLocalStorage()`: Data persistence
  - `exportIDB()`/`restoreIDB()`: Backup operations

#### [`utils.js`](utils.js)
**Fungsi**: Utility functions dan helpers
- Data transformation (flattenDataKoin)
- Filter management
- URL generation dan validation
- **Key Functions**:
  - `flattenDataKoin()`: Token data flattening
  - `getFilterMulti()`/`setFilterMulti()`: Filter operations
  - `generateDexLink()`: DEX trading link generation

### Configuration Modules

#### [`config.js`](config.js)
**Fungsi**: Static configuration data
- CEX/DEX API endpoints dan settings
- Chain configurations
- UI constants
- **Key Data**:
  - `CONFIG_CEX`: CEX settings dan link builders
  - `CONFIG_CHAINS`: Blockchain configurations
  - `CONFIG_DEXS`: DEX provider settings

#### [`secrets.js`](secrets.js)
**Fungsi**: Sensitive configuration
- API keys untuk CEX access
- Telegram bot credentials
- OKX DEX key pool
- **Key Data**:
  - `CEX_SECRETS`: API keys per exchange
  - `CONFIG_TELEGRAM`: Bot configuration
  - `apiKeysOKXDEX`: OKX DEX key rotation pool

## State

### Global State Variables
- `window.SavedSettingData`: Application configuration settings
- `window.CURRENT_CHAINS`: Active blockchain list for scanning
- `window.RUN_STATES`: Per-chain/per-mode run status cache
- `window.singleChainTokensCurrent`: Current token list (single-chain mode)
- `window.currentListOrderMulti`: Current token list (multi-chain mode)
- `window.scanCandidateTokens`: Tokens queued for scanning
- `window.__LOCKED_DEX_LIST`: DEX selection locked during scan
- `window._DEX_WATCHDOGS`: Active timeout handlers map
- `window._DEX_TICKERS`: Active countdown timers map

### Storage Keys
- `SETTING_SCANNER`: Application settings (nickname, wallet, delays, etc.)
- `TOKEN_MULTICHAIN`: Token data for multi-chain mode
- `TOKEN_<CHAIN>`: Token data per-chain (e.g., `TOKEN_BSC`)
- `FILTER_MULTICHAIN`: Filter settings for multi-chain mode
- `FILTER_<CHAIN>`: Filter settings per-chain (e.g., `FILTER_BSC`)
- `PRICE_RATE_USDT`: Cached USDT/IDR exchange rate
- `ALL_GAS_FEES`: Cached gas fee data per chain
- `MULTICHECKER_BACKUP_*`: Backup snapshots with timestamps
- `HISTORY_LOG`: Application activity log
- `SCAN_LOG_ENABLED`: Console logging toggle

## Batasan

### Technical Limitations
1. **Browser-based Operation**: Terbatas oleh browser capabilities dan security policies
2. **Client-side Storage**: Data persistence bergantung pada browser storage
3. **Network Dependent**: Membutuhkan koneksi internet stabil untuk API calls
4. **Single User**: Tidak ada multi-user support atau server-side persistence
5. **Manual Execution**: Tidak ada automated trading, hanya monitoring
6. **API Rate Limits**: Terbatas oleh rate limits dari CEX/DEX providers
7. **No Real-time Updates**: Scanning berbasis polling, bukan websocket streaming
8. **Browser Security**: CORS restrictions dan CSP policies membatasi API access

### Functional Limitations
1. **Limited DEX Support**: Hanya mendukung DEX aggregator tertentu
2. **No Position Management**: Tidak ada portfolio tracking atau position sizing
3. **No Risk Management**: Tidak ada stop-loss atau automated risk controls
4. **Manual Token Management**: Token list management memerlukan input manual
5. **No Historical Analysis**: Tidak ada charting atau historical price analysis
6. **Fixed UI Layout**: Table layout statis tanpa customization options

### Performance Limitations
1. **UI Blocking**: Scanning besar dapat block UI interaction
2. **Memory Usage**: Large token lists dapat consume significant memory
3. **Browser Tab Limits**: Heavy scanning dapat crash browser tab
4. **Storage Quota**: IndexedDB storage terbatas oleh browser quota
5. **Concurrent Requests**: Limited by browser's concurrent connection limits

## Alur Data

### Main Data Flow
```
User Input → Token Management → Data Storage → Scan Trigger → API Calls → Processing → UI Update → Notifications
```

### Detailed Flow

#### 1. Initialization Flow
```
Browser Load → config.js → secrets.js → storage.js → main.js → bootApp()
    ↓
Load Settings → Load Tokens → Validate Data → Setup UI → Bind Events
```

#### 2. Token Management Flow
```
User Input → Form Validation → Data Sanitization → Storage (IndexedDB)
    ↓
Flatten Data → Apply Filters → Render Table → Update UI State
```

#### 3. Scanning Flow
```
Start Scan → Load Active Tokens → Filter by Chains/DEX → Batch Processing
    ↓
For Each Token:
    Fetch CEX Price → Query DEX APIs → Calculate PNL → Update UI Cell
    ↓
Check Profit Threshold → Send Telegram Alert → Log to History
```

#### 4. API Integration Flow
```
DEX Request → Strategy Selection → Build Request → Apply Proxy → Send HTTP
    ↓
Parse Response → Validate Data → Calculate Fees → Return Result
    ↓
Error Handling → Fallback Service → Timeout Management
```

#### 5. UI Update Flow
```
Scan Results → Queue Updates → Process Queue → Update DOM Cells
    ↓
Highlight Profitable → Update Progress → Refresh Signals → Animate Changes
```

#### 6. Persistence Flow
```
Data Changes → Validate Input → IndexedDB Transaction → Update Cache
    ↓
Cross-tab Sync → Backup Triggers → History Logging → State Persistence
```

## Risiko

### Technical Risks
1. **API Failures**: CEX/DEX API downtime atau rate limiting
2. **Network Issues**: Unstable connection, CORS blocks, DNS failures
3. **Browser Crashes**: Memory leaks, infinite loops, tab crashes
4. **Storage Corruption**: IndexedDB corruption, quota exceeded
5. **Security Vulnerabilities**: XSS, API key exposure, insecure storage

### Operational Risks
1. **Data Loss**: Browser storage deletion, no server backup
2. **API Key Issues**: Keys expired, revoked, atau compromised
3. **Performance Degradation**: Slow scanning, UI freezing, memory issues
4. **Dependency Failures**: External service outages (proxies, Telegram)
5. **Browser Compatibility**: Inconsistent behavior across browsers

### Business Risks
1. **Rate Limiting**: IP blocks dari excessive API calls
2. **API Terms Violation**: Breach of service terms dari CEX/DEX
3. **Legal Compliance**: Automated trading restrictions, regulatory changes
4. **Market Volatility**: Price slippage, arbitrage windows closing
5. **Smart Contract Risks**: DEX integration vulnerabilities

### Development Risks
1. **Technical Debt**: Mixed sync/async code, global state pollution
2. **Maintenance Issues**: Hard-coded configs, lack of error boundaries
3. **Scalability Limits**: No horizontal scaling, single-user design
4. **Testing Gaps**: No automated testing, manual verification only
5. **Documentation Gaps**: Limited code documentation, tribal knowledge

### Mitigation Strategies
1. **Error Handling**: Comprehensive try/catch blocks dan fallback mechanisms
2. **Rate Limiting**: Built-in delays dan request throttling
3. **Data Backup**: Regular export functionality dan restore capabilities
4. **Monitoring**: Console logging dan history tracking
5. **Security**: API key rotation dan secure storage practices
6. **Performance**: Chunked processing dan UI optimization
7. **Recovery**: Graceful error recovery dan state restoration