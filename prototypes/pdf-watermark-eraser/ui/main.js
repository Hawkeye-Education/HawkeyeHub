// PDF Watermark Eraser Plugin UI: plain DOM, no framework, no build step (ADR 0006 allows any or none).
const { hub } = window;
const $ = (id) => document.getElementById(id);

// --- i18n (ADR 0007): fixed for this open; exact tag or English ---
const t = (key, vars = {}) =>
  (STRINGS[hub.displayLanguage]?.[key] ?? STRINGS['en-HK'][key]).replace(/\{(\w+)\}/g, (_, k) => vars[k]);
for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
$('input').label = t('input');
$('output').label = t('output');

// --- Plugin Data (ADR 0008): web storage in the Plugin's persistent partition, migrated forward at open ---
const SETTINGS = 'settings';
const DEFAULTS = { v: 1, input: '', output: '', pattern: '', regex: false, ignoreCase: true };
let settings = DEFAULTS;
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') }; // v1 is the only version so far
} catch {}
const save = () => {
  settings = {
    v: 1,
    input: $('input').value,
    output: $('output').value,
    pattern: $('pattern').value,
    regex: $('regex').checked,
    ignoreCase: $('ignoreCase').checked,
  };
  localStorage.setItem(SETTINGS, JSON.stringify(settings));
};
$('input').value = settings.input;
$('output').value = settings.output;
$('pattern').value = settings.pattern;
$('regex').checked = settings.regex;
$('ignoreCase').checked = settings.ignoreCase;
for (const id of ['output', 'pattern', 'regex', 'ignoreCase']) $(id).addEventListener('change', save);

// Backend rejections carry a reason code; only the UI knows the Display Language.
const explain = (e) => {
  const data = e.code === 'backend-error' ? e.rpc?.data : undefined;
  return data?.reason && STRINGS['en-HK'][`error.${data.reason}`]
    ? t(`error.${data.reason}`, data)
    : t('error.unknown', { detail: e.message });
};

// --- Find the watermark text: Backend reads the PDF, UI copies with the native clipboard ---
async function listPdfs() {
  const select = $('file');
  select.replaceChildren();
  if (!settings.input) return;
  const { files } = await hub.backend.request('listPdfs', { folder: settings.input });
  select.append(...files.map((f) => new Option(f, f)));
  if (!files.length) select.append(new Option(t('noPdfs'), '', true, true));
}
$('input').addEventListener('change', () => {
  save();
  listPdfs().catch((e) => $('summary').textContent = explain(e));
});

let pageText = '';
$('show').addEventListener('click', async () => {
  try {
    const r = await hub.backend.request('pageText', {
      folder: settings.input,
      file: $('file').value,
      page: Number($('page').value) - 1,
    });
    pageText = r.lines.join('\n');
    $('text').textContent = pageText;
    $('repeated').textContent = r.repeated.length ? t('repeated', { lines: r.repeated.join(' · ') }) : '';
    $('copy').disabled = false;
  } catch (e) {
    $('text').textContent = explain(e);
  }
});
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(pageText);
  $('copy').textContent = t('copied');
  setTimeout(() => ($('copy').textContent = t('copy')), 1500);
});

// --- Run: request + progress notifications, wrapped in Busy (ADR 0003, 0009) ---
const log = $('log');
let lastDone = 0;
hub.backend.onNotification('progress', ({ done, total, file, result }) => {
  $('progress').value = done / total;
  log.append({
    tone: result.kind === 'cleaned' ? 'success' : 'danger',
    text: t(`result.${result.kind}`, { file, ...result }),
  });
  lastDone = done;
});

$('run').addEventListener('click', async () => {
  save();
  if (!settings.input || !settings.output) return ($('summary').textContent = t('error.pick-folders'));
  log.clear();
  lastDone = 0;
  $('progress').value = 0;
  $('summary').textContent = '';
  $('openOutput').hidden = true;
  $('run').disabled = true;
  $('cancel').hidden = false;
  await hub.busy.set(t('busy'));
  try {
    const r = await hub.backend.request('run', {
      input: settings.input,
      output: settings.output,
      pattern: settings.pattern,
      regex: settings.regex,
      ignoreCase: settings.ignoreCase,
    });
    $('summary').textContent = r.cancelled
      ? t('summaryCancelled', { done: lastDone, total: r.total })
      : t('summary', r);
    $('openOutput').hidden = r.cleaned === 0;
  } catch (e) {
    $('summary').textContent = explain(e);
  } finally {
    await hub.busy.clear();
    $('run').disabled = false;
    $('cancel').hidden = true;
  }
});
$('cancel').addEventListener('click', () => hub.backend.notify('cancel', {}));
$('openOutput').addEventListener('click', () => hub.files.openFolder(settings.output));

listPdfs().catch(() => {}); // a remembered input folder may be gone; staff will pick again
