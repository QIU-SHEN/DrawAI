import { validateDiagramFile as validateNativeFile } from '/src/model.js';

Object.defineProperty(window, '__drawaiValidate', { value: validateNativeFile });
const boot = window.__DRAWAI_WV_BOOTSTRAP__;
delete window.__DRAWAI_WV_BOOTSTRAP__;
let serial = 0;
const pending = new Map(), callbacks = new Set();
const invoke = (type, value) => new Promise(resolve => {
  const id = ++serial; pending.set(id, resolve);
  window.chrome.webview.postMessage({ id, type, value });
});
window.chrome.webview.addEventListener('message', event => {
  const value = event.data;
  if (value?.command) { for (const callback of callbacks) callback(value.command); }
  else if (pending.has(value?.id)) { pending.get(value.id)(value.result); pending.delete(value.id); }
});
try {
  const initial = { storageKey: boot.storageKey, theme: boot.theme, ...(boot.payload ? validateNativeFile(boot.payload) : {}) };
  Object.defineProperty(window, 'drawaiDesktop', { value: Object.freeze({
    initial, engine: 'webview2',
    initialize: entries => invoke('initialize', entries),
    changed: entry => invoke('changed', entry),
    save: (id, saveAs = false) => invoke('save', { id, saveAs }),
    exportFile: id => invoke('export', { id }),
    open: () => invoke('open'), close: () => invoke('close'),
    onCommand: callback => callbacks.add(callback),
  }) });
  if (boot.testing) Object.defineProperty(window, '__drawaiTest', { value: (action, data) => invoke('test', { action, data }) });
  await import('/src/app.js');
} catch (error) {
  document.body.textContent = '无法打开图表：' + error.message;
  await invoke('invalid', { message: error.message });
}
