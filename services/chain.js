// Simple Chain registry facade over CONFIG_CHAINS
(function initChainRegistry(global){
  const root = global || (typeof window !== 'undefined' ? window : {});
  const Chains = {
    get(key){
      if (!key) return null;
      const k = String(key).toLowerCase();
      const cfg = (root.CONFIG_CHAINS || {})[k];
      if (!cfg) return null;
      return cfg;
    },
    list(){
      return Object.keys(root.CONFIG_CHAINS || {});
    },
    listDex(key){
      const c = this.get(key) || {};
      return (c.DEXS || []).map(String);
    },
    cexWallet(chainKey, cex){
      const c = this.get(chainKey) || {};
      const map = c.WALLET_CEX || {};
      const up = String(cex || '').toUpperCase();
      return map[up] || null;
    },
    code(key){
      const c = this.get(key) || {};
      return c.Kode_Chain || c.code || null;
    },
    explorer(key){
      const c = this.get(key) || {};
      const base = String(c.URL_Chain || '').replace(/\/$/, '');
      const links = (c.LINKS && c.LINKS.explorer) || {};
      const token = typeof links.token === 'function' ? links.token : (addr) => `${base}/token/${addr}`;
      const address = typeof links.address === 'function' ? links.address : (addr) => `${base}/address/${addr}`;
      const tx = typeof links.tx === 'function' ? links.tx : (hash) => `${base}/tx/${hash}`;
      return { token, address, tx };
    }
  };

  root.Chain = Chains;
})(this);
