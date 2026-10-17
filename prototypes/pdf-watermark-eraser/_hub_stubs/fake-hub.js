// PROTOTYPE: a browser stand-in for the Hub preload, so ui/index.html opens by double-click.
// Fakes window.hub (ADR 0009), crude --hub-* tokens + native styles (ADR 0006), the two proposed
// Hub Kit v1 elements, and a canned Backend. Every Hub API call is printed in the traffic panel.
// ?lang=zh-HK switches the Display Language.
(() => {
  if (window.hub) return;
  const lang = new URLSearchParams(location.search).get('lang') ?? 'en-HK';
  document.documentElement.lang = lang;

  // --- traffic panel ---
  const lines = [];
  const trace = (...parts) => {
    lines.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
    const pre = document.getElementById('__traffic');
    if (pre) (pre.textContent = lines.join('\n')), (pre.scrollTop = pre.scrollHeight);
  };
  addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <details open style="position:fixed;inset:auto 0 0 0;background:#111;color:#9f9;font:12px monospace;max-height:35vh;z-index:9">
        <summary style="padding:4px 8px;color:#fff">FAKE HUB · Hub API traffic · lang=${lang} · <span id="__busy">not Busy</span></summary>
        <pre id="__traffic" style="margin:0;padding:8px;overflow:auto;max-height:30vh"></pre>
      </details>`);
    document.body.style.paddingBottom = '36vh';
    trace(`preload: displayLanguage=${lang}, backend present (manifest backend.kind=python), no identity`);
  });

  // --- tokens + native-element stylesheet (the real values come from the active Theme) ---
  document.head.insertAdjacentHTML('afterbegin', `<style>
    :root { --hub-space-1:4px; --hub-space-2:8px; --hub-space-3:12px; --hub-space-4:20px;
      --hub-color-bg:#fafaf7; --hub-color-fg:#1b1d22; --hub-color-muted:#666; --hub-color-accent:#0b5cad;
      --hub-color-line:#d6d6d0; --hub-color-success:#1d7a3a; --hub-color-danger:#b3261e; --hub-radius-2:6px;
      --hub-font-body: system-ui, "Microsoft JhengHei", "PingFang HK", sans-serif; color-scheme: light dark; }
    @media (prefers-color-scheme: dark) { :root { --hub-color-bg:#17181b; --hub-color-fg:#e8e8e3; --hub-color-muted:#9a9a95;
      --hub-color-line:#34363b; --hub-color-accent:#7fb3ff; --hub-color-success:#6fd08f; --hub-color-danger:#ff8a80; } }
    body { margin:0; background:var(--hub-color-bg); color:var(--hub-color-fg); font:14px/1.5 var(--hub-font-body); }
    input, select, button { font:inherit; color:inherit; background:transparent; border:1px solid var(--hub-color-line);
      border-radius:var(--hub-radius-2); padding:var(--hub-space-1) var(--hub-space-2); }
    button { background:var(--hub-color-accent); color:var(--hub-color-bg); border-color:transparent; cursor:pointer; }
    button:disabled { opacity:.5; cursor:default; }
    input[type=checkbox] { accent-color:var(--hub-color-accent); }
    pre { border:1px solid var(--hub-color-line); border-radius:var(--hub-radius-2); padding:var(--hub-space-2); margin:0; }
    summary { cursor:pointer; } p { margin:0; color:var(--hub-color-muted); }
  </style>`);

  // --- Hub Kit v1 (proposed) ---
  customElements.define('hub-folder-field', class extends HTMLElement {
    #label = ''; #value = '';
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <style>:host{display:flex;flex-direction:column;gap:4px} div{display:flex;gap:8px}
          output{flex:1;border:1px solid var(--hub-color-line);border-radius:var(--hub-radius-2);padding:4px 8px;
            min-height:1.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          output:empty::before{content:"—";color:var(--hub-color-muted)}
          button{font:inherit;background:var(--hub-color-accent);color:var(--hub-color-bg);border:0;
            border-radius:var(--hub-radius-2);padding:4px 12px;cursor:pointer}</style>
        <span></span><div><output></output><button type="button">${lang === 'zh-HK' ? '瀏覽…' : 'Browse…'}</button></div>`;
      this.shadowRoot.querySelector('button').onclick = async () => {
        const r = await window.hub.files.pickFolder(this.#label);
        if (r.kind === 'chosen') (this.value = r.path), this.dispatchEvent(new Event('change', { bubbles: true }));
      };
    }
    get label() { return this.#label; }
    set label(v) { this.#label = v; this.shadowRoot.querySelector('span').textContent = v; }
    get value() { return this.#value; }
    set value(v) { this.#value = v; this.shadowRoot.querySelector('output').textContent = v; }
  });
  customElements.define('hub-log', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <style>:host{display:block;overflow:auto;border:1px solid var(--hub-color-line);border-radius:var(--hub-radius-2);
          font:12px/1.6 ui-monospace,monospace} ol{list-style:none;margin:0;padding:8px}
          .success{color:var(--hub-color-success)} .danger{color:var(--hub-color-danger)}</style><ol role="log"></ol>`;
    }
    append({ tone, text }) {
      const li = Object.assign(document.createElement('li'), { className: tone, textContent: text });
      this.shadowRoot.querySelector('ol').append(li);
      this.scrollTop = this.scrollHeight;
    }
    clear() { this.shadowRoot.querySelector('ol').replaceChildren(); }
  });

  // --- canned Backend ---
  class HubError extends Error {
    constructor(code, message, rpc) { super(message); this.code = code; this.rpc = rpc; }
  }
  const rpcError = (reason, detail) =>
    new HubError('backend-error', reason, { code: -32602, message: reason, data: { reason, detail } });
  const FILES = ['clean.pdf', 'locked.pdf', 'marked.pdf', 'term2/marked2.pdf', 'term2/marked3.pdf'];
  const handlers = {};
  let cancelled = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const emit = (method, params) => (trace('  <- notify', method, params), handlers[method]?.(params));
  const methods = {
    listPdfs: async () => ({ files: FILES }),
    pageText: async ({ file, page }) => ({
      pageCount: 3,
      lines: [`Mock exam paper (${file}, page ${page + 1})`, 'Provided by dse.life', '1. Answer ALL questions.'],
      repeated: ['Provided by dse.life'],
    }),
    run: async ({ input, output, pattern, regex }) => {
      if (!pattern.trim()) throw rpcError('pattern-empty');
      if (input === output) throw rpcError('same-folder');
      if (regex) try { new RegExp(pattern); } catch (e) { throw rpcError('pattern-invalid', e.message); }
      cancelled = false;
      let cleaned = 0, done = 0;
      for (const file of FILES) {
        if (cancelled) break;
        await sleep(700);
        const result = file === 'clean.pdf' ? { kind: 'no-match' }
          : file === 'locked.pdf' ? { kind: 'password' } : { kind: 'cleaned', removed: 3 };
        if (result.kind === 'cleaned') cleaned++;
        emit('progress', { done: ++done, total: FILES.length, file, result });
      }
      return { cleaned, failed: done - cleaned, total: FILES.length, cancelled };
    },
  };

  window.hub = Object.freeze({
    displayLanguage: lang,
    backend: Object.freeze({
      async request(method, params) {
        trace('-> backend.request', method, params);
        try {
          const r = await methods[method](params);
          trace('<- result', method, r);
          return r;
        } catch (e) {
          trace('<- HubError', e.code, e.rpc ?? e.message);
          throw e;
        }
      },
      async notify(method, params) {
        trace('-> backend.notify', method, params);
        if (method === 'cancel') cancelled = true;
      },
      onNotification(method, handler) {
        trace('   backend.onNotification', method);
        handlers[method] = handler;
        return () => delete handlers[method];
      },
    }),
    files: Object.freeze({
      async pickFolder(title) {
        const path = prompt(`[native folder dialog] ${title}`, 'C:\\Users\\staff\\Desktop\\papers');
        const r = path ? { kind: 'chosen', path } : { kind: 'cancelled' };
        trace('-> files.pickFolder', title, '=>', r);
        return r;
      },
      async openFolder(path) { trace('-> files.openFolder', path, '(Explorer/Finder opens)'); },
    }),
    busy: Object.freeze({
      async set(reason) { trace('-> busy.set', reason); document.getElementById('__busy').textContent = `Busy: ${reason}`; },
      async clear() { trace('-> busy.clear'); document.getElementById('__busy').textContent = 'not Busy'; },
    }),
    // stores and ai exist in the real API; this plugin never calls them
  });
})();
