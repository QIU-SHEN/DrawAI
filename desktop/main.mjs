import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateFile, readDiagram, readOptional, writeDiagram, contentKey } from './file-format.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'drawai-app://editor';
const windows = new Map();
let theme = '#ec7fa4';
const themes = [['经典粉', '#ec7fa4'], ['天空蓝', '#7fa9ec'], ['薄荷绿', '#7fc5a4'], ['柔和紫', '#b397df'], ['暖杏橙', '#e8ad7d']];
function setTheme(color) {
  try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(path.join(app.getPath('userData'), 'theme.txt'), color); }
  catch (error) { dialog.showErrorBox('主题偏好无法保存', error.message); return; }
  theme = color;
  for (const { win } of windows.values()) win.webContents.send('drawai:command', { type: 'theme', id: color });
}
const run = promisify(execFile);
const testing = process.env.DRAWAI_DESKTOP_TEST === '1' && !app.isPackaged;
// Keep the portable build's runtime data beside the executable, not on the system disk.
if (app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  const profile = path.join(path.dirname(process.execPath), 'data');
  mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
  const temporary = path.join(profile, 'temp'); mkdirSync(temporary, { recursive: true });
  app.setPath('temp', temporary); process.env.TEMP = temporary; process.env.TMP = temporary;
  app.setAppLogsPath(path.join(profile, 'logs'));
}
if (testing && process.env.DRAWAI_TEST_PROFILE) app.setPath('userData', process.env.DRAWAI_TEST_PROFILE);
app.setName('DrawAI'); app.setAppUserModelId('DrawAI.Desktop');
protocol.registerSchemesAsPrivileged([{ scheme: 'drawai-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
const filters = [{ name: 'DrawAI 图表', extensions: ['drawai'] }];
const normalPath = filename => path.resolve(filename).toLowerCase();
function stateFor(event) {
  const state = windows.get(event.sender.id);
  if (!state || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw new Error('不允许的调用来源。');
  return state;
}
function entriesStatus(state) {
  return [...state.entries].map(([id, e]) => ({ id, path: e.path || null, dirty: contentKey(e.payload) !== e.savedKey }));
}
function title(state) {
  const e = state.entries.get(state.activeId) || state.entries.get('default');
  if (e) state.win.setTitle(`${contentKey(e.payload) !== e.savedKey ? '● ' : ''}${e.path ? path.basename(e.path) : e.payload.workspaceName} — DrawAI`);
}
function entry(value) {
  if (!value || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id)) throw new Error('无效的工作空间。');
  return { id: value.id, payload: validateFile(value.payload) };
}
function updateEntry(state, value) {
  const { id, payload } = entry(value);
  const existing = state.entries.get(id);
  if (!existing && state.entries.size >= 50) throw new Error('工作空间过多。');
  state.entries.set(id, existing ? { ...existing, payload } : { payload, savedKey: null, path: null });
  state.activeId = state.entries.has(value.activeId) ? value.activeId : id; title(state);
}
function errorMessage(error) { return error?.message || '文件操作失败，请重试。'; }
function guarded(fn) { return async (event, value) => { try { return await fn(stateFor(event), value); } catch (error) { return { error: errorMessage(error) }; } }; }
function exclusive(state, action) {
  const pending = state.queue.then(action); state.queue = pending.catch(() => {}); return pending;
}
function pathOwner(filename) {
  for (const state of windows.values()) for (const [id, e] of state.entries) if (e.path && normalPath(e.path) === normalPath(filename)) return { state, id };
}
async function saveEntry(state, id, saveAs = false, copy = false) {
  const e = state.entries.get(id); if (!e) throw new Error('找不到此工作空间。');
  const snapshot = structuredClone(e.payload);
  let filename = e.path, expected = e.expectedText;
  if (!filename || saveAs || copy) {
    const picked = await dialog.showSaveDialog(state.win, { title: copy ? '导出 DrawAI 文件' : '保存 DrawAI 图表', defaultPath: (!copy && filename) || snapshot.workspaceName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + (copy ? '-副本' : '') + '.drawai', filters });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    filename = picked.filePath;
    if (path.extname(filename).toLowerCase() !== '.drawai') filename += '.drawai';
    const owner = pathOwner(filename);
    if (owner && (copy || owner.state !== state || owner.id !== id)) throw new Error('此文件已在工作空间或窗口中打开，请使用其他文件名；更新原文件请使用保存。');
    // Native overwrite dialog covers the selected name; appended extensions need their own check.
    const current = await readOptional(filename);
    if (filename !== picked.filePath && current !== null) {
      const { response } = await dialog.showMessageBox(state.win, { type: 'question', message: '替换已有图表？', detail: filename, buttons: ['取消', '替换'], defaultId: 0, cancelId: 0 });
      if (response !== 1) return { canceled: true };
    }
    expected = filename === e.path ? e.expectedText : current;
  }
  const text = await writeDiagram(filename, snapshot, expected);
  // Edits can continue while the dialog/write is pending; only this snapshot is marked saved.
  if (!copy) Object.assign(state.entries.get(id), { path: filename, expectedText: text, savedKey: contentKey(snapshot) });
  title(state); return { entries: entriesStatus(state) };
}
async function closeWindow(state) {
  const dirty = [...state.entries].filter(([, e]) => contentKey(e.payload) !== e.savedKey);
  if (dirty.length) {
    const { response } = await dialog.showMessageBox(state.win, { type: 'question', message: '保存修改后关闭？', detail: dirty.map(([, e]) => e.payload.workspaceName).join('、'), buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2 });
    if (response === 2) return { canceled: true };
    if (response === 0) {
      for (const [id] of dirty) if ((await saveEntry(state, id)).canceled) return { canceled: true };
      if (entriesStatus(state).some(e => e.dirty)) return { error: '保存期间又有新修改，请再次保存后关闭。', entries: entriesStatus(state) };
    }
  }
  state.allowClose = true; state.win.close(); return {};
}
ipcMain.on('drawai:bootstrap', event => {
  try { event.returnValue = stateFor(event).initial; } catch { event.returnValue = null; }
});
ipcMain.handle('drawai:initialize', guarded(async (state, values) => {
  if (state.initialized || !Array.isArray(values) || values.length > 50) throw new Error('工作空间初始化无效。');
  for (const value of values) {
    const { id, payload } = entry(value);
    if (id === 'default' && state.initial.document) {
      updateEntry(state, value);
    } else state.entries.set(id, { payload, savedKey: contentKey(payload), path: null });
  }
  state.initialized = true; title(state); return { entries: entriesStatus(state) };
}));
ipcMain.handle('drawai:changed', guarded(async (state, value) => { updateEntry(state, value); return { entries: entriesStatus(state) }; }));
ipcMain.handle('drawai:save', guarded((state, value) => exclusive(state, () => saveEntry(state, value?.id, value?.saveAs === true))));
ipcMain.handle('drawai:export', guarded((state, value) => exclusive(state, () => saveEntry(state, value?.id, true, true))));
ipcMain.handle('drawai:open', guarded(async state => {
  const result = await dialog.showOpenDialog(state.win, { title: '打开 DrawAI 图表', filters, properties: ['openFile', 'multiSelections'] });
  if (!result.canceled) for (const filename of result.filePaths) await openWindow(filename);
  return { canceled: result.canceled };
}));
ipcMain.handle('drawai:close', guarded(state => exclusive(state, () => closeWindow(state))));
async function openWindow(filename) {
  let loaded;
  if (filename) {
    try {
      filename = await realpath(filename);
      const existing = pathOwner(filename);
      if (existing) { existing.state.win.restore(); existing.state.win.focus(); existing.state.win.webContents.send('drawai:command', { type: 'workspace', id: existing.id }); return; }
      loaded = await readDiagram(filename);
    } catch (error) { await dialog.showMessageBox({ type: 'error', message: '无法打开图表', detail: errorMessage(error) }); return; }
  }
  const win = new BrowserWindow({ width: 1450, height: 950, minWidth: 800, minHeight: 600, show: !testing, backgroundColor: '#f5f5f5', icon: path.join(root, 'desktop/icon.ico'), webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  const initial = { storageKey: 'drawai.desktop.' + randomUUID(), theme, ...(loaded?.payload || {}) };
  const state = { win, initial, entries: new Map(), activeId: 'default', queue: Promise.resolve(), initialized: false, allowClose: false };
  if (loaded) state.entries.set('default', { payload: loaded.payload, path: filename, expectedText: loaded.text, savedKey: contentKey(loaded.payload) });
  const webContentsId = win.webContents.id;
  windows.set(webContentsId, state);
  win.on('closed', () => windows.delete(webContentsId));
  win.on('close', event => { if (!state.allowClose && state.initialized) { event.preventDefault(); win.webContents.send('drawai:command', { type: 'close' }); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  await win.loadURL(origin + '/');
  return win;
}
function send(type) { BrowserWindow.getFocusedWindow()?.webContents.send('drawai:command', { type }); }
async function registerAssociation() {
  const win = BrowserWindow.getFocusedWindow();
  if (!app.isPackaged) { await dialog.showMessageBox(win, { message: '请在打包后的 DrawAI.exe 中设置文件关联。' }); return; }
  const { response } = await dialog.showMessageBox(win, { type: 'question', message: '用 DrawAI 打开 .drawai 图表？', detail: '仅为当前 Windows 用户登记文件类型，不需要管理员权限。请先把程序文件夹放在固定位置；移动后需要重新关联。', buttons: ['关联', '取消'], defaultId: 0, cancelId: 1 });
  if (response !== 0) return;
  try {
    const base = 'HKCU\\Software\\Classes', prog = base + '\\DrawAI.Diagram';
    const add = (key, args) => run('reg.exe', ['add', key, ...args, '/f'], { windowsHide: true });
    await add(prog, ['/ve', '/d', 'DrawAI 图表']);
    await add(prog + '\\DefaultIcon', ['/ve', '/d', '"' + path.join(path.dirname(process.execPath), 'resources/app/desktop/icon.ico') + '",0']);
    await add(prog + '\\shell\\open\\command', ['/ve', '/d', '"' + process.execPath + '" "%1"']);
    await add(base + '\\.drawai', ['/ve', '/d', 'DrawAI.Diagram']);
    await add(base + '\\.drawai\\OpenWithProgids', ['/v', 'DrawAI.Diagram', '/t', 'REG_NONE']);
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -Name DrawAIChange -Namespace Shell -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint e, uint f, System.IntPtr a, System.IntPtr b);'; [Shell.DrawAIChange]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)"], { windowsHide: true });
    await dialog.showMessageBox(win, { message: '文件类型已登记', detail: '现在可双击 .drawai 文件打开。如 Windows 显示“选择应用”，请选择此文件夹中的 DrawAI.exe，并勾选“始终使用”。' });
  } catch (error) { await dialog.showMessageBox(win, { type: 'error', message: '关联未完成', detail: errorMessage(error) + '\n也可以右键图表 → 打开方式 → 选择 DrawAI.exe。' }); }
}
const pathsFromArgs = args => args.filter(arg => typeof arg === 'string' && /\.drawai$/i.test(arg) && !arg.startsWith('--'));
app.on('second-instance', async (_event, argv, cwd) => {
  await app.whenReady();
  const files = pathsFromArgs(argv);
  if (files.length) for (const file of files) await openWindow(path.resolve(cwd, file));
  else { const win = BrowserWindow.getAllWindows()[0]; if (win) { win.restore(); win.focus(); } else await openWindow(); }
});
if (locked) app.whenReady().then(async () => {
  const allowed = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ...['app.js', 'model.js', 'scene.js', 'styles.css', 'portable.json'].map(f => ['/src/' + f, 'src/' + f])]);
  protocol.handle('drawai-app', async request => {
    const url = new URL(request.url), filename = allowed.get(url.pathname);
    if (url.host !== 'editor' || !filename || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.json') ? 'application/json' : 'text/html';
    return new Response(await readFile(path.join(root, filename)), { headers: { 'Content-Type': type + '; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'" } });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  try { const saved = readFileSync(path.join(app.getPath('userData'), 'theme.txt'), 'utf8').trim(); if (/^#[0-9a-f]{6}$/i.test(saved)) theme = saved; } catch { }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '新建窗口', accelerator: 'CmdOrCtrl+N', click: () => openWindow() },
      { label: '打开图表…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
      { type: 'separator' }, { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
      { type: 'separator' }, { label: '关联 .drawai 文件…', click: registerAssociation },
      { type: 'separator' }, { role: 'close', label: '关闭窗口' },
    ] },
    { label: '主题', submenu: themes.map(([label, color]) => ({ label, type: 'radio', checked: color === theme, click: () => setTheme(color) })) },
    { label: '编辑', submenu: [{ label: '撤销图表操作', click: () => send('undo') }, { label: '重做图表操作', click: () => send('redo') }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选文字' }] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '界面原始大小' }, { role: 'zoomIn', label: '放大界面' }, { role: 'zoomOut', label: '缩小界面' }, { role: 'togglefullscreen', label: '全屏' }] },
  ]));
  const files = pathsFromArgs(process.argv);
  if (files.length) { for (const file of files) await openWindow(path.resolve(file)); if (!windows.size) await openWindow(); }
  else await openWindow();
});
app.on('window-all-closed', () => app.quit());
