// PROTOTYPE: a browser stand-in for the Hub preload, so ui/index.html opens by double-click.
// Fakes window.hub (ADR 0009), crude --hub-* tokens + native styles (ADR 0006), the two proposed
// Hub Kit v1 elements, and a canned Backend. Every Hub API call is printed in the traffic panel.
// ?lang=zh-HK switches the Display Language. ?theme=A|B|C&scheme=light|dark pick the Hawkeye Theme candidate
// (prototypes/hawkeye-theme, wayfinder #19); inside that prototype's Hub Chrome the parent page drives both.
(() => {
  if (window.hub) return;
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') ?? 'en-HK';
  const embedded = window.top !== window;
  document.documentElement.lang = lang;

  // --- traffic panel ---
  const lines = [];
  const trace = (...parts) => {
    lines.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
    if (embedded) return console.log('[fake-hub]', lines.at(-1));
    const pre = document.getElementById('__traffic');
    if (pre) (pre.textContent = lines.join('\n')), (pre.scrollTop = pre.scrollHeight);
  };
  addEventListener('DOMContentLoaded', () => {
    if (embedded) return console.log('[fake-hub] preload ready, traffic in console');
    document.body.insertAdjacentHTML('beforeend', `
      <details open style="position:fixed;inset:auto 0 0 0;background:#111;color:#9f9;font:12px monospace;max-height:35vh;z-index:9">
        <summary style="padding:4px 8px;color:#fff">FAKE HUB · Hub API traffic · lang=${lang} · <span id="__busy">not Busy</span></summary>
        <pre id="__traffic" style="margin:0;padding:8px;overflow:auto;max-height:30vh"></pre>
      </details>`);
    document.body.style.paddingBottom = '36vh';
    trace(`preload: displayLanguage=${lang}, backend present (manifest backend.kind=python), no identity`);
  });

  // --- tokens + native-element stylesheet: the Hawkeye Theme candidates from prototypes/hawkeye-theme ---
  const HUB_CSS = '../../hawkeye-theme/hub.css';
  const KIT_CSS = '../../hawkeye-theme/kit.css';
  const applyLook = ({ theme, scheme, font }) => Object.assign(document.documentElement.dataset, { theme, scheme, font });
  applyLook({
    theme: params.get('theme') ?? 'A',
    scheme: params.get('scheme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    font: params.get('font') ?? 'theme',
  });
  addEventListener('message', (e) => e.data?.type === 'hub-look' && applyLook(e.data)); // live, no reload (ADR 0006)
  document.head.insertAdjacentHTML('afterbegin', `<link rel="stylesheet" href="${HUB_CSS}">`);

  // --- Hub Kit v1 (proposed) ---
  customElements.define('hub-folder-field', class extends HTMLElement {
    #label = ''; #value = '';
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <link rel="stylesheet" href="${KIT_CSS}">
        <span class="label"></span><div class="row"><output></output><button type="button">${lang === 'zh-HK' ? '瀏覽…' : 'Browse…'}</button></div>`;
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
        <link rel="stylesheet" href="${KIT_CSS}">
        <ol role="log" data-empty="${lang === 'zh-HK' ? '結果會顯示在這裏' : 'Results appear here'}"></ol>`;
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
      // The real Hub calls Electron's dialog.showOpenDialog(hubWindow, {title, properties: ['openDirectory']})
      // in the main process: the OS folder picker, modal to the Hub window. This <dialog> only stands in for it.
      pickFolder: (title) => new Promise((resolve) => {
        const d = document.createElement('dialog');
        d.style.minWidth = '28rem';
        d.innerHTML = `
          <form method="dialog" style="display:flex;flex-direction:column;gap:12px">
            <strong>${title}</strong>
            <small>PROTOTYPE stand-in for the OS folder picker the Hub opens</small>
            <input name="path" value="C:\\Users\\staff\\Desktop\\papers" style="width:100%;box-sizing:border-box">
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${['C:\\Users\\staff\\Desktop\\papers', 'C:\\Users\\staff\\Desktop\\papers-clean', 'S:\\Shared\\DSE\\2025']
                .map((p) => `<button type="button" data-p="${p}">${p}</button>`).join('')}
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button value="cancel">Cancel</button>
              <button value="ok" data-variant="primary">Select folder</button>
            </div>
          </form>`;
        d.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => (d.querySelector('input').value = b.dataset.p)));
        d.onclose = () => {
          const path = d.querySelector('input').value.trim();
          const r = d.returnValue === 'ok' && path ? { kind: 'chosen', path } : { kind: 'cancelled' };
          trace('-> files.pickFolder', title, '=>', r);
          d.remove();
          resolve(r);
        };
        document.body.append(d);
        d.showModal();
      }),
      async openFolder(path) { trace('-> files.openFolder', path, '(Explorer/Finder opens)'); },
    }),
    busy: Object.freeze({
      async set(reason) {
        trace('-> busy.set', reason);
        if (embedded) return parent.postMessage({ type: 'hub-busy', reason }, '*'); // the Hub Chrome shows Busy
        document.getElementById('__busy').textContent = `Busy: ${reason}`;
      },
      async clear() {
        trace('-> busy.clear');
        if (embedded) return parent.postMessage({ type: 'hub-busy', reason: null }, '*');
        document.getElementById('__busy').textContent = 'not Busy';
      },
    }),
    // stores and ai exist in the real API; this plugin never calls them
  });
})();
