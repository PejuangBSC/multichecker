// Global toastr shim for consistent notifications across the app
(function(){
  const hasToastr = typeof window !== 'undefined' && window.toastr;
  // Sensible defaults
  try {
    if (hasToastr) {
      window.toastr.options = Object.assign({
        positionClass: 'toast-bottom-right',
        timeOut: 3500,
        extendedTimeOut: 1500,
        closeButton: true,
        progressBar: true,
        newestOnTop: true,
        preventDuplicates: false,
      }, window.toastr.options || {});
    }
  } catch(_) {}

  function toToastr(status){
    const s = String(status || '').toLowerCase();
    if (s === 'success') return 'success';
    if (s === 'warning' || s === 'warn') return 'warning';
    if (s === 'danger' || s === 'error' || s === 'fail') return 'error';
    return 'info';
  }

  const PENDING_KEY = '__PENDING_TOASTS__';

  function addPendingToast(entry){
    try {
      const arr = JSON.parse(sessionStorage.getItem(PENDING_KEY) || '[]');
      arr.push(entry);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(arr));
    } catch(_) {}
  }

  function drainPendingToasts(){
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_KEY);
      const arr = JSON.parse(raw || '[]');
      const now = Date.now();
      arr.forEach(item => {
        try {
          const ttl = Number(item.ttlMs) || 10000;
          if (now - Number(item.ts || 0) > ttl) return;
          const t = toToastr(item.type);
          if (hasToastr && window.toastr[t]) {
            window.toastr[t](String(item.message||''), item.title || undefined, item.opts || undefined);
          }
        } catch(_) {}
      });
    } catch(_) {}
  }

  // Public notify helper
  function notify(type, message, title, opts){
    try {
      const t = toToastr(type);
      const options = opts || {};
      // Optionally persist across reload
      if (options && (options.persist || options.afterReload)) {
        addPendingToast({ type: t, message, title, opts: options, ts: Date.now(), ttlMs: options.ttlMs || 12000 });
      }
      if (hasToastr && window.toastr[t]) {
        window.toastr[t](String(message||''), title || undefined, options);
      } else {
        // Fallback to alert for environments without toastr
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(String(message||''));
        }
        try { console[(t==='error'?'error':(t==='warning'?'warn':'log'))](message); } catch(_){}
      }
    } catch(e) { try { console.warn('notify failed:', e); } catch(_){} }
  }

  // Shim UIkit.notification(message|options, options?) → toastr
  try {
    const shimUikit = function(arg, opt){
      try {
        if (typeof arg === 'string') {
          const status = opt && opt.status ? opt.status : 'info';
          notify(status, arg);
          return;
        }
        const msg = (arg && (arg.message || arg.msg)) || '';
        const status = (arg && arg.status) || (opt && opt.status) || 'info';
        notify(status, msg);
      } catch(e) { try { console.warn('UIkit.notification shim error:', e); } catch(_){} }
    };
    // Define UIkit if not present
    if (typeof window !== 'undefined') {
      window.notify = notify; // expose helper
      // helper to enqueue toast for next load without showing now
      window.notifyAfterReload = function(type, message, title, opts){
        try { addPendingToast({ type: toToastr(type), message, title, opts, ts: Date.now(), ttlMs: (opts && opts.ttlMs) || 12000 }); } catch(_) {}
      };
      // helper to enqueue + reload (optional delay)
      window.reloadWithNotify = function(type, message, title, opts, delayMs){
        try { addPendingToast({ type: toToastr(type), message, title, opts, ts: Date.now(), ttlMs: (opts && opts.ttlMs) || 12000 }); } catch(_) {}
        const d = Number(delayMs);
        if (Number.isFinite(d) && d > 0) {
          try { if (hasToastr) { const t = toToastr(type); window.toastr[t](String(message||''), title || undefined, opts || undefined); } } catch(_) {}
          setTimeout(() => { try { window.location.reload(); } catch(_) {} }, d);
        } else {
          try { window.location.reload(); } catch(_) {}
        }
      };
      if (!window.UIkit) window.UIkit = {};
      window.UIkit.notification = shimUikit;
      // Redirect alert() to toastr.info for consistency
      const origAlert = window.alert ? window.alert.bind(window) : null;
      window.alert = function(msg){
        // Show now and also persist briefly in case a reload follows immediately
        try { addPendingToast({ type: 'info', message: String(msg||''), title: undefined, opts: undefined, ts: Date.now(), ttlMs: 10000 }); } catch(_) {}
        if (hasToastr) { try { toastr.info(String(msg||'')); return; } catch(_){} }
        if (origAlert) return origAlert(msg);
      };
      // Drain any pending toasts on load
      if (document && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', function(){ setTimeout(drainPendingToasts, 80); }, { once: true });
      } else {
        // Fallback
        try { setTimeout(drainPendingToasts, 120); } catch(_) {}
      }
    }
  } catch(_) {}
})();
