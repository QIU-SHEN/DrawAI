import { STORAGE_KEY, createTable, getDiagramObject, updateDiagramObject, kinds, shapes, clone, uid, blankDocument, removeNode, removeLayer, addEdge, validateDocument, validateDiagramFile, History } from './model.js';
import { renderScene, wrapAngle, canEditPlane, unprojectDelta, unprojectPoint, layerZ, planeMarkup, perspectiveDistance, elementScreenPoint, project, nodeSize, portPoint, freePort, escapeHtml as esc } from './scene.js';
import { mountAIPanel } from './ai-panel.js';

const $ = id => document.getElementById(id);
const svg = $('scene');
const desktop = window.drawaiDesktop;
let aiPanel = null;
const initialFile = desktop?.initial?.document ? desktop.initial : window.__DRAWAI_FILE__;
const desktopState = { ready: false, entries: new Map(), pending: Promise.resolve() };
function applyTheme(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
  const rgb = color.slice(1).match(/../g).map(v => parseInt(v, 16));
  const mix = (target, amount) => '#' + rgb.map(v => Math.round(v + (target - v) * amount).toString(16).padStart(2, '0')).join('');
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries({ '--accent': color, '--accent-text': mix(0, .52), '--accent-soft': mix(255, .82), '--accent-hover': color + '66', '--accent-marquee': color + '1a' })) style.setProperty(name, value);
}
applyTheme(desktop?.initial?.theme || '#ec7fa4');
let history = new History();
let doc = initialFile ? validateDocument(initialFile.document) : blankDocument();
let selection = null;
let pointerTool = 'select';
let connectSource = null;
let showRelations = true;
let fitBounds = null;
let toastTimeout;
let saveTimeout;
let drag = null;
let lastDragAt = 0;
let lastNodePress = null;
let lastObjectPress = null;
let storageAvailable = true;
let activeLayerId = 'flow';
let paletteDrag = null;
let inspectorNodeId = null;
let inlineEdit = null;
const originalFile = { handle: null, timer: null, writing: false, pending: false, error: null, expectedText: null };
const camera = { mode: 'flat', tilt: 55, yaw: -30, gap: 640, zoom: 1, panX: 0, panY: 0 };

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  const fileRevision = window.__DRAWAI_FILE__?.revision;
  if (raw && (!fileRevision || localStorage.getItem(STORAGE_KEY + '.file-revision') === fileRevision)) {
    try {
      const parsed = JSON.parse(raw);
      doc = validateDocument(parsed);
      if (parsed.version < 3 && !localStorage.getItem(STORAGE_KEY + '.before-tables')) localStorage.setItem(STORAGE_KEY + '.before-tables', raw);
      if (parsed.version === 1 && !localStorage.getItem(STORAGE_KEY + '.before-layers')) localStorage.setItem(STORAGE_KEY + '.before-layers', raw);
    }
    catch {
      localStorage.setItem(`${STORAGE_KEY}.recovery-${Date.now()}`, raw);
      setTimeout(() => toast('原存档无法读取，已保留恢复副本；当前打开空白图层。'), 200);
    }
  }
} catch { storageAvailable = false; }
activeLayerId = doc.layers[0].id;
const workspaceIndexKey = STORAGE_KEY + '.workspaces';
let workspaceCatalog = [{ id: 'default', name: typeof initialFile?.workspaceName === 'string' ? initialFile.workspaceName.slice(0, 60) : '工作空间 1' }];
let activeWorkspaceId = 'default';
const workspaceSessions = new Map([['default', { doc, history, view: { mode: 'flat' } }]]);
function workspaceStorageKey(id = activeWorkspaceId) { return id === 'default' ? STORAGE_KEY : STORAGE_KEY + '.workspace.' + id; }
function originalWorkspace() { return !!window.__DRAWAI_FILE__ && activeWorkspaceId === 'default'; }
try {
  const raw = localStorage.getItem(workspaceIndexKey);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.items) || !saved.items.length || saved.items.length > 50 ||
        !saved.items.some(w => w.id === 'default') || new Set(saved.items.map(w => w.id)).size !== saved.items.length ||
        saved.items.some(w => typeof w.id !== 'string' || !/^[\w-]{1,80}$/.test(w.id) || typeof w.name !== 'string' || !w.name.trim() || w.name.length > 60)) throw new Error('Invalid workspace catalog');
      workspaceCatalog = saved.items.map(({ id, name, view }) => ({ id, name, view }));
      const id = window.__DRAWAI_FILE__ ? 'default' : saved.activeId;
      if (id !== 'default' && workspaceCatalog.some(w => w.id === id)) {
        try {
          doc = validateDocument(JSON.parse(localStorage.getItem(workspaceStorageKey(id))));
          activeWorkspaceId = id; history = new History();
          workspaceSessions.set(id, { doc, history, view: workspaceCatalog.find(w => w.id === id).view });
        } catch { setTimeout(() => toast('上次工作空间无法读取，已保留存档并打开默认空间。'), 200); }
      }
    } catch {
      localStorage.setItem(workspaceIndexKey + '.recovery-' + Date.now(), raw);
      setTimeout(() => toast('工作空间列表无法读取，已保留恢复副本。'), 200);
    }
  }
} catch { storageAvailable = false; }
activeLayerId = doc.layers[0].id;

function captureWorkspace() {
  const view = portableView();
  workspaceCatalog.find(w => w.id === activeWorkspaceId).view = view;
  workspaceSessions.set(activeWorkspaceId, { doc, history, view });
}
function renderWorkspaces() {
  aiPanel?.refresh();
  const current = workspaceCatalog.find(w => w.id === activeWorkspaceId);
  $('workspace-list').innerHTML = workspaceCatalog.map(w => `<div class="workspace-row${w.id === activeWorkspaceId ? ' active' : ''}"><button class="workspace-item${w.id === activeWorkspaceId ? ' active' : ''}" data-workspace="${esc(w.id)}" aria-pressed="${w.id === activeWorkspaceId}" title="${esc(w.name)}"><span>◇</span><b>${esc(w.name)}</b></button><button class="workspace-rename" data-rename-workspace="${esc(w.id)}" aria-label="重命名 ${esc(w.name)}" title="重命名">✎</button></div>`).join('');
  $('workspace-count').textContent = String(workspaceCatalog.length).padStart(2, '0');
  $('add-workspace').disabled = workspaceCatalog.length >= 50;
  document.querySelector('.project-heading strong').textContent = current.name;
  $('workspace-breadcrumb').textContent = current.name;
  if (window.__DRAWAI_FILE__) {
    document.querySelector('.project-heading span').textContent = originalWorkspace() ? '离线图表' : '本机工作空间';
    $('save-original').hidden = !originalWorkspace();
    document.querySelector('.sidebar-bottom p').textContent = !originalWorkspace() ? '此空间保存在当前浏览器。导出 .drawai 文件可单独保存和分享。' :
      typeof window.showOpenFilePicker !== 'function' ? '此浏览器不支持原文件自动保存。请用桌面版 Chrome / Edge 打开，或导出 .drawai 文件保存修改。' :
      originalFile.handle ? '编辑完成后自动保存到原 HTML。每次重新打开，请选择原文件并授权。' : '点击「启用文件自动保存」，选择当前 HTML 并授权后，编辑自动回写原文件。';
  }
  if (desktop) {
    document.querySelector('.project-heading span').textContent = desktop.engine === 'webview2' ? 'WebView2 试验版 · .drawai 图表' : '桌面版 · .drawai 图表';
    document.querySelector('.sidebar-bottom p').textContent = 'Ctrl+S 保存当前空间为 .drawai 文件。首次使用可在「文件」菜单关联后缀。';
    desktopStatus();
  }
}
function restoreWorkspaceView(view = {}) {
  view = view && typeof view === 'object' ? view : {};
  activeLayerId = doc.layers.some(l => l.id === view.activeLayerId) ? view.activeLayerId : doc.layers[0].id;
  showRelations = view.showRelations !== false; $('show-relations').checked = showRelations;
  Object.assign(camera, { tilt: 55, yaw: -30, gap: 640, zoom: 1, panX: 0, panY: 0 });
  for (const [key, min, max] of [['tilt', 0, 360], ['yaw', -180, 180], ['gap', 250, 1000]]) if (Number.isFinite(view[key])) camera[key] = Math.max(min, Math.min(max, view[key]));
  syncCameraInputs(); switchView(view.mode === 'flat' ? 'flat' : 'spatial');
}
function switchWorkspace(id) {
  if (id === activeWorkspaceId || !workspaceCatalog.some(w => w.id === id)) return;
  let session = workspaceSessions.get(id);
  if (!session) {
    try { session = { doc: validateDocument(JSON.parse(localStorage.getItem(workspaceStorageKey(id)))), history: new History(), view: workspaceCatalog.find(w => w.id === id).view }; }
    catch { toast('此工作空间无法读取，当前画布保持不变。'); return; }
  }
  cancelCanvasDrag(); clearPaletteDrag(); finishInlineEdit(true); persist();
  activeWorkspaceId = id; doc = session.doc; history = session.history;
  selection = null; connectSource = null; inspectorNodeId = null; fitBounds = null; lastObjectPress = null; lastNodePress = null;
  restoreWorkspaceView(session.view || workspaceCatalog.find(w => w.id === id).view);
  persist();
}
let renameWorkspaceId = null;
function openWorkspaceDialog(id = null) {
  finishInlineEdit(true); renameWorkspaceId = id;
  $('workspace-dialog-title').textContent = id ? '重命名工作空间' : '新增工作空间';
  $('workspace-dialog-hint').textContent = id ? '修改此工作空间的名称。' : '创建独立的空白画布，原工作空间会保留。';
  $('workspace-name').value = id ? workspaceCatalog.find(w => w.id === id).name : '工作空间 ' + (workspaceCatalog.length + 1);
  $('workspace-dialog').showModal(); $('workspace-name').focus(); $('workspace-name').select();
}
$('add-workspace').onclick = () => openWorkspaceDialog();
$('workspace-cancel').onclick = () => $('workspace-dialog').close();
$('workspace-list').onclick = event => {
  const rename = event.target.closest('[data-rename-workspace]'), item = event.target.closest('[data-workspace]');
  if (rename) openWorkspaceDialog(rename.dataset.renameWorkspace); else if (item) switchWorkspace(item.dataset.workspace);
};
$('workspace-form').onsubmit = event => {
  event.preventDefault();
  const name = $('workspace-name').value.trim(); if (!name) { $('workspace-name').focus(); return; }
  if (renameWorkspaceId) {
    workspaceCatalog.find(w => w.id === renameWorkspaceId).name = name;
    persist(); desktopSync(renameWorkspaceId); renderWorkspaces();
  } else {
    if (workspaceCatalog.length >= 50) return;
    const id = uid('workspace');
    workspaceCatalog.push({ id, name });
    workspaceSessions.set(id, { doc: blankDocument(), history: new History(), view: { mode: 'flat' } });
    switchWorkspace(id);
  }
  $('workspace-dialog').close();
  if (!storageAvailable) toast('浏览器存储不可用，请导出当前空间备份。');
};

function toast(message) {
  clearTimeout(toastTimeout); $('toast').textContent = message; $('toast').hidden = false;
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

function persist() {
  clearTimeout(saveTimeout);
  captureWorkspace();
  try {
    if (!desktop) {
      localStorage.setItem(workspaceStorageKey(), JSON.stringify(doc));
      localStorage.setItem(workspaceIndexKey, JSON.stringify({ version: 1, activeId: activeWorkspaceId, items: workspaceCatalog }));
    }
    storageAvailable = true;
    if (originalWorkspace() && window.__DRAWAI_FILE__?.revision) localStorage.setItem(STORAGE_KEY + '.file-revision', window.__DRAWAI_FILE__.revision);
    $('save-status').textContent = '已保存到本机';
  } catch {
    storageAvailable = false;
    $('save-status').textContent = '自动保存不可用，请导出备份';
  }
  $('undo').disabled = !history.past.length;
  $('redo').disabled = !history.future.length;
  queueOriginalSave();
  originalFileStatus();
  desktopSync();
}
function scheduleSave() {
  $('save-status').textContent = '正在保存…'; clearTimeout(saveTimeout); saveTimeout = setTimeout(persist, 180);
}
window.addEventListener('pagehide', () => { finishInlineEdit(true); if (saveTimeout) persist(); });

function mutate(fn, options = {}) {
  finishInlineEdit(true);
  history.push(doc); fn();
  if (!doc.layers.some(layer => layer.id === activeLayerId)) activeLayerId = doc.layers[0].id;
  if (selection?.type === 'node' && !doc.nodes.some(n => n.id === selection.id)) selection = null;
  if (selection?.type === 'edge' && !doc.edges.some(e => e.id === selection.id)) selection = null;
  if (connectSource && !getDiagramObject(doc, connectSource)) connectSource = null;
  if (selection?.type === 'table' && !doc.tables.some(t => t.id === selection.id)) selection = null;
  if (selection?.type === 'layer' && !doc.layers.some(layer => layer.id === selection.id)) selection = null;
  persist(); render(options);
}

function viewBox() {
  if (!fitBounds) return;
  const rect = svg.getBoundingClientRect();
  const ratio = rect.width / Math.max(rect.height, 1);
  let w = fitBounds.right - fitBounds.left, h = fitBounds.bottom - fitBounds.top;
  if (w / h < ratio) w = h * ratio; else h = w / ratio;
  w /= camera.zoom; h /= camera.zoom;
  const cx = (fitBounds.left + fitBounds.right) / 2 + camera.panX;
  const cy = (fitBounds.top + fitBounds.bottom) / 2 + camera.panY;
  svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
  $('zoom-label').textContent = `${Math.round(camera.zoom * 100)}%`;
  renderEdgeHandles();
}

function scene(refit = false) {
  finishInlineEdit(true);
  if (selection?.type === 'multi') setObjectSelection(selection.ids.filter(id => {
    const object = getDiagramObject(doc, id);
    return object && (camera.mode !== 'flat' || object.layerId === activeLayerId);
  }));
  if (selection?.type === 'edge') {
    const edge = doc.edges.find(e => e.id === selection.id);
    if (!edge || (!showRelations && edge.style === 'dashed') || (camera.mode === 'flat' && [edge.source, edge.target].some(id => getDiagramObject(doc, id)?.layerId !== activeLayerId))) selection = null;
  }
  if (!fitBounds || refit) camera.distance = perspectiveDistance(doc, camera);
  const bounds = renderScene(svg, doc, camera, selection, showRelations, connectSource, activeLayerId);
  svg.classList.toggle('multi-selection', selection?.type === 'multi');
  svg.dataset.tool = pointerTool;
  if (!fitBounds || refit) fitBounds = bounds;
  viewBox();
  $('connect-banner').hidden = !connectSource;
  $('flow-count').textContent = `${doc.nodes.filter(n => n.layerId === activeLayerId).length}`;
  $('node-actions').hidden = selection?.type !== 'node' || !doc.nodes.some(n => n.id === selection.id);
  $('relation-actions').hidden = selection?.type !== 'edge';
  $('table-actions').hidden = selection?.type !== 'table';
  $('multi-actions').hidden = selection?.type !== 'multi';
  $('selection-count').textContent = selection?.type === 'multi' ? `已选 ${selection.ids.length} 项` : '';
  updateToolHint();
}

function selectedObjectIds() { return selection?.type === 'multi' ? [...selection.ids] : ['node', 'table'].includes(selection?.type) ? [selection.id] : []; }
function setObjectSelection(ids) {
  ids = [...new Set(ids)].filter(id => getDiagramObject(doc, id));
  selection = ids.length > 1 ? { type: 'multi', ids } : ids.length ? { type: getDiagramObject(doc, ids[0]).kind === 'table' ? 'table' : 'node', id: ids[0] } : null;
}
function updateToolHint() {
  $('interaction-hint').textContent = pointerTool === 'select' ? '空白拖动框选 · Shift / Ctrl 点击多选 · 拖动所选一起移动' : camera.mode === 'flat' ? '点击选中 · 拖动图形移动 · 空白拖动平移' : '点击选中 · 拖动图形跨层移动 · 空白拖动旋转';
}
function setPointerTool(tool) {
  cancelCanvasDrag(); finishInlineEdit(true); connectSource = null; pointerTool = tool;
  for (const name of ['select', 'drag']) { $('tool-' + name).classList.toggle('active', name === tool); $('tool-' + name).setAttribute('aria-pressed', String(name === tool)); }
  scene();
}
$('tool-select').onclick = () => setPointerTool('select');
$('tool-drag').onclick = () => setPointerTool('drag');
function deleteSelected() {
  const ids = selectedObjectIds();
  if (ids.length) mutate(() => { ids.forEach(id => removeNode(doc, id)); selection = null; });
}
$('delete-selected').onclick = deleteSelected;
function objectScreenBounds(element) {
  return element.querySelector('.node-back,.table-body').getBoundingClientRect();
}
function marqueeIds(action, event) {
  const left = Math.min(action.clientX, event.clientX), right = Math.max(action.clientX, event.clientX);
  const top = Math.min(action.clientY, event.clientY), bottom = Math.max(action.clientY, event.clientY);
  return [...svg.querySelectorAll('[data-object]')].filter(el => {
    const box = objectScreenBounds(el);
    if (!box.width || !box.height || box.left < left || box.right > right || box.top < top || box.bottom > bottom) return false;
    // Do not select content hidden behind another layer. Test several interior
    // points so a label/edge or a partially covered object can still be selected.
    return [.25,.5,.75].some(x => [.25,.5,.75].some(y => hitNode({ clientX: box.left + box.width*x, clientY: box.top + box.height*y }) === el.dataset.object));
  }).map(el => el.dataset.object);
}
function updateMarquee(event) {
  const p = worldPoint(event);
  setObjectSelection([...drag.baseIds, ...marqueeIds(drag, event)]);
  scene(); nodeList();
  const box = document.createElementNS(svg.namespaceURI, 'rect'); box.setAttribute('class', 'selection-marquee');
  box.setAttribute('x', Math.min(p.x, drag.start.x)); box.setAttribute('y', Math.min(p.y, drag.start.y));
  box.setAttribute('width', Math.abs(p.x - drag.start.x)); box.setAttribute('height', Math.abs(p.y - drag.start.y));
  svg.append(box);
}

function nodeList() {
  $('node-list').innerHTML = [...doc.nodes, ...doc.tables.map(t => getDiagramObject(doc, t.id))].filter(n => n.layerId === activeLayerId).map(n => `<button data-list-node="${esc(n.id)}" class="${n.kind === 'agent' ? 'agent-item' : ''} ${selectedObjectIds().includes(n.id) ? 'active' : ''}" title="${esc(n.title)}"><i>${{ shape: '◇', agent: '◈', input: '▧', decision: '◇', result: '○', table: '▦' }[n.kind]}</i><span>${esc(n.title)}</span></button>`).join('');
}

function render({ refit = false, inspector = true, table = true } = {}) {
  scene(refit); nodeList(); renderLayers(); renderWorkspaces();
  if (inspector) renderInspector();
  $('undo').disabled = !history.past.length; $('redo').disabled = !history.future.length;
}

function selectNode(id) {
  finishInlineEdit(true);
  if (inspectorNodeId !== id) inspectorNodeId = null;
  const node = getDiagramObject(doc, id);
  if (!node) return;
  const type = node.kind === 'table' ? 'table' : 'node';
  const layerChanged = node.layerId !== activeLayerId;
  activeLayerId = node.layerId;
  if (connectSource) {
    if (doc.edges.length >= 1000) { toast('原型最多支持 1000 条流程连线'); return; }
    if (connectSource === id) { toast('请选择另一个节点作为连线目标'); return; }
    if (doc.edges.some(e => e.source === connectSource && e.target === id && e.style !== 'dashed')) { toast('这两个节点之间已有同方向连线'); return; }
    mutate(() => { addEdge(doc, connectSource, id); connectSource = null; selection = { type, id }; });
    toast('已建立流程连线，可双击连线编辑说明');
  } else { selection = { type, id }; render({ table: false, refit: layerChanged && camera.mode === 'flat' }); }
}

function beginInlineEdit(id) {
  if (inlineEdit?.type === 'node' && inlineEdit.id === id) return;
  finishInlineEdit(true);
  selectNode(id);
  inspectorNodeId = null; renderInspector(); viewBox();
  const node = doc.nodes.find(n => n.id === id);
  const group = svg.querySelector('[data-node="' + id + '"]');
  if (!node || !group) return;
  const editor = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  editor.setAttribute('class', 'node-inline-editor');
  editor.setAttribute('x', '-100'); editor.setAttribute('y', '-56');
  editor.setAttribute('width', '200'); editor.setAttribute('height', '112');
  editor.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml" class="inline-text-fields"><input id="inline-node-title" maxlength="60" aria-label="图形名称" placeholder="图形名称" autocomplete="off"/><textarea id="inline-node-description" maxlength="240" aria-label="图形说明" placeholder="输入说明…" spellcheck="false"></textarea></div>';
  inlineEdit = { type: 'node', id, editor };
  group.classList.add('editing-text');
  group.append(editor);
  const title = editor.querySelector('input'), description = editor.querySelector('textarea');
  title.value = node.title; description.value = node.description;
  bindInlineEditor(editor);
  title.focus(); title.select();
}

function bindInlineEditor(editor) {
  editor.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
  editor.addEventListener('pointerdown', event => event.stopPropagation());
  editor.addEventListener('click', event => event.stopPropagation());
  editor.addEventListener('dblclick', event => event.stopPropagation());
  editor.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); finishInlineEdit(false); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finishInlineEdit(true); }
  });
  editor.addEventListener('focusout', event => {
    if (editor.contains(event.relatedTarget)) return;
    setTimeout(() => {
      if (inlineEdit?.editor === editor && !editor.contains(document.activeElement)) finishInlineEdit(true);
    }, 0);
  });
}

function beginEdgeEdit(id, type = 'edge') {
  if (inlineEdit?.type === type && inlineEdit.id === id) return;
  finishInlineEdit(true);
  const edge = doc.edges.find(e => e.id === id);
  if (!edge) return;
  selection = { type, id }; inspectorNodeId = null; connectSource = null;
  render({ table: false }); viewBox();
  const group = svg.querySelector('[data-edge="' + id + '"]');
  if (!group) return;
  const editor = document.createElementNS(svg.namespaceURI, 'foreignObject');
  editor.setAttribute('class', 'edge-inline-editor');
  editor.setAttribute('x', Number(group.dataset.labelX) - 155);
  editor.setAttribute('y', Number(group.dataset.labelY) - 33);
  editor.setAttribute('width', '310'); editor.setAttribute('height', '52');
  if (group.dataset.labelTransform) editor.setAttribute('transform', group.dataset.labelTransform);
  editor.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml"><input id="inline-edge-label" maxlength="60" aria-label="分支文字" placeholder="输入分支文字…" autocomplete="off"/></div>';
  inlineEdit = { type, id, editor };
  group.classList.add('editing-text'); group.append(editor); bindInlineEditor(editor);
  const input = editor.querySelector('input'); input.value = edge.label; input.focus(); input.select();
}

function beginTableEdit(id = selection?.id) {
  if (inlineEdit?.type === 'table' && inlineEdit.id === id) return;
  finishInlineEdit(true);
  const table = doc.tables.find(t => t.id === id);
  if (!table) return;
  selectNode(id); inspectorNodeId = null; connectSource = null;
  render({ table: false }); viewBox();
  const group = svg.querySelector('[data-table="' + id + '"]');
  if (!group) return;
  const editor = document.createElementNS(svg.namespaceURI, 'foreignObject');
  editor.setAttribute('class', 'table-inline-editor');
  editor.setAttribute('x', '0'); editor.setAttribute('y', '0');
  editor.setAttribute('width', Math.max(780, table.width)); editor.setAttribute('height', Math.max(400, Math.min(620, table.height + 130)));
  inlineEdit = { type: 'table', id, editor, draft: { title: table.title, columns: [...table.columns], cells: table.cells.map(row => [...row]) } };
  group.classList.add('editing-text'); group.append(editor); group.parentElement.append(group); bindInlineEditor(editor);
  renderInlineTable(); editor.querySelector('[data-table-title]').focus();
}

function renderInlineTable() {
  const { editor, draft } = inlineEdit;
  editor.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml" class="inline-table generic-table"><div class="inline-table-heading"><input data-table-title maxlength="100" aria-label="表格标题" placeholder="表格标题" value="' + esc(draft.title) + '"/><button data-table-save>完成</button></div><div class="inline-table-tools"><span>Enter 保存 · Shift+Enter 换行 · Esc 取消</span><button data-table-add>＋ 行</button><button data-table-add-column>＋ 列</button></div><div class="inline-table-scroll"><table style="min-width:' + (draft.columns.length * 180 + 50) + 'px"><thead><tr>' + draft.columns.map((c, i) => '<th><div class="column-edit"><input data-column="' + i + '" maxlength="100" aria-label="第 ' + (i + 1) + ' 列名称" placeholder="列名" value="' + esc(c) + '"/><button data-delete-column="' + i + '" aria-label="删除第 ' + (i + 1) + ' 列"' + (draft.columns.length === 1 ? ' disabled' : '') + '>×</button></div></th>').join('') + '<th class="row-actions"></th></tr></thead><tbody>' + draft.cells.map((row, r) => '<tr data-table-row="' + r + '">' + row.map((cell, c) => '<td><textarea data-cell="' + r + ',' + c + '" aria-label="第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 列" maxlength="1000" placeholder="内容">' + esc(cell) + '</textarea></td>').join('') + '<td class="row-actions"><button data-delete-row="' + r + '" aria-label="删除第 ' + (r + 1) + ' 行">×</button></td></tr>').join('') + '</tbody></table>' + (!draft.cells.length ? '<p class="inline-table-empty">点击「＋ 行」填写内容</p>' : '') + '</div></div>';
  editor.querySelector('[data-table-title]').oninput = event => { draft.title = event.target.value; };
  editor.querySelectorAll('[data-column]').forEach(input => { input.oninput = () => { draft.columns[Number(input.dataset.column)] = input.value; }; });
  editor.querySelectorAll('[data-cell]').forEach(input => { input.oninput = () => { const [r, c] = input.dataset.cell.split(',').map(Number); draft.cells[r][c] = input.value; }; });
  const rerender = selector => { renderInlineTable(); editor.querySelector(selector)?.focus(); };
  editor.querySelectorAll('[data-delete-row]').forEach(button => { button.onclick = () => { draft.cells.splice(Number(button.dataset.deleteRow), 1); rerender('[data-table-add]'); }; });
  editor.querySelectorAll('[data-delete-column]').forEach(button => { button.onclick = () => { if (draft.columns.length <= 1) return; const c = Number(button.dataset.deleteColumn); draft.columns.splice(c, 1); draft.cells.forEach(row => row.splice(c, 1)); rerender('[data-table-add-column]'); }; });
  const canGrow = (rows, cols) => doc.tables.filter(t => t.id !== inlineEdit.id).reduce((n, t) => n + t.columns.length * t.cells.length, rows * cols) <= 10000;
  editor.querySelector('[data-table-add]').onclick = () => {
    if (draft.cells.length >= 500 || !canGrow(draft.cells.length + 1, draft.columns.length)) { toast('已达到表格行数或单元格上限'); return; }
    draft.cells.push(draft.columns.map(() => '')); rerender('tbody tr:last-child textarea');
  };
  editor.querySelector('[data-table-add-column]').onclick = () => {
    if (draft.columns.length >= 20 || !canGrow(draft.cells.length, draft.columns.length + 1)) { toast('已达到表格列数或单元格上限'); return; }
    draft.columns.push(''); draft.cells.forEach(row => row.push('')); rerender('[data-column="' + (draft.columns.length - 1) + '"]');
  };
  editor.querySelector('[data-table-save]').onclick = () => finishInlineEdit(true);
}

function editSelection() {
  if (selection?.type === 'node') beginInlineEdit(selection.id);
  else if (selection?.type === 'edge') beginEdgeEdit(selection.id, selection.type);
  else if (selection?.type === 'table') beginTableEdit();
}

function finishInlineEdit(save) {
  if (!inlineEdit) return;
  const { type, id, editor, draft } = inlineEdit;
  if (['edge', 'table'].includes(type)) {
    const edge = type === 'edge' ? doc.edges.find(e => e.id === id) : null;
    const label = type !== 'table' ? editor.querySelector('input').value : '';
    inlineEdit = null;
    editor.closest('[data-edge],[data-table],[data-relation-link]')?.classList.remove('editing-text');
    editor.remove();
    if (save && type === 'edge' && edge && edge.label !== label) mutate(() => { edge.label = label; });
    const table = doc.tables.find(t => t.id === id);
    if (save && type === 'table' && table && JSON.stringify({ title: table.title, columns: table.columns, cells: table.cells }) !== JSON.stringify(draft)) mutate(() => { Object.assign(table, draft); });
    return;
  }
  const node = doc.nodes.find(n => n.id === id);
  const title = editor.querySelector('input').value.trim() || '未命名节点';
  const description = editor.querySelector('textarea').value;
  inlineEdit = null;
  editor.closest('[data-node]')?.classList.remove('editing-text');
  editor.remove();
  if (save && node && (node.title !== title || node.description !== description)) {
    mutate(() => { node.title = title; node.description = description; });
  }
}

document.addEventListener('pointerdown', event => {
  if (inlineEdit && !inlineEdit.editor.contains(event.target)) finishInlineEdit(true);
}, true);
$('edit-relation-text').onclick = () => { if (selection?.type === 'edge') beginEdgeEdit(selection.id); };
$('delete-relation').onclick = () => {
  if (selection?.type === 'edge') mutate(() => { doc.edges = doc.edges.filter(e => e.id !== selection.id); });
};
$('edit-table-content').onclick = () => beginTableEdit();
$('delete-table').onclick = () => { if (selection?.type === 'table') mutate(() => removeNode(doc, selection.id)); };
$('edit-node-text').onclick = () => { if (selection?.type === 'node') beginInlineEdit(selection.id); };
$('node-properties').onclick = () => {
  if (selection?.type !== 'node') return;
  finishInlineEdit(true); inspectorNodeId = selection.id; renderInspector();
};
$('link-selected-node').onclick = () => {
  if (selection?.type !== 'node') return;
  finishInlineEdit(true); connectSource = selection.id; scene();
};

function bindText(element, setter, { table = false } = {}) {
  let recorded = false;
  element.addEventListener('focus', () => { recorded = false; });
  element.addEventListener('input', () => {
    if (!recorded) { history.push(doc); recorded = true; }
    setter(element.value); scheduleSave(); scene(); nodeList(); renderLayers();
    $('undo').disabled = !history.past.length; $('redo').disabled = !history.future.length;
  });
  element.addEventListener('change', () => { persist(); if (table) renderInspector(); });
}

function renderInspector() {
  const panel = $('inspector');
  const n = selection?.type === 'node' && inspectorNodeId === selection.id ? doc.nodes.find(n => n.id === selection.id) : null;

  const layer = selection?.type === 'layer' ? doc.layers.find(layer => layer.id === selection.id) : null;
  panel.hidden = !n && !layer;
  if (panel.hidden) { panel.innerHTML = ''; requestAnimationFrame(viewBox); return; }
  const head = label => `<div class="inspector-header"><div><span class="eyebrow">PROPERTIES</span><h2>${label}</h2></div><button id="close-inspector" aria-label="关闭属性面板">×</button></div>`;
  if (n) {
    const edges = doc.edges.filter(e => e.source === n.id || e.target === n.id);
    panel.innerHTML = head('节点属性') + `<label class="field">节点名称<input id="node-title" maxlength="60" value="${esc(n.title)}"></label><label class="field">图形<select id="node-shape">${Object.entries(shapes).map(([value, title]) => `<option value="${value}" ${n.shape === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label><label class="field">所属图层<select id="node-layer">${layerOptions(n.layerId)}</select></label><label class="field">说明<textarea id="node-description" maxlength="240">${esc(n.description)}</textarea></label><p class="inspector-note">在平面或三维视图中拖动节点，位置会保持同步。</p><div class="inspector-section"><h3>流程连线 · ${edges.length}</h3>${edges.map(e => `<div class="edge-list-item"><span>${e.source === n.id ? '→' : '←'} ${esc(getDiagramObject(doc, e.source === n.id ? e.target : e.source)?.title || '')}</span><button data-edit-edge="${esc(e.id)}" title="编辑连线">↗</button></div>`).join('')}<button id="connect-node" class="button quiet full-button">＋ 从此节点连线</button></div><div class="inspector-section"><button id="delete-node" class="button danger full-button">删除节点</button><p class="inspector-note">相关连线和表格关联会一起移除，可撤销。</p></div>`;
    bindText($('node-title'), value => { n.title = value.trim() || '未命名节点'; });
    bindText($('node-description'), value => { n.description = value; });
    $('node-shape').onchange = event => mutate(() => { n.shape = event.target.value; });
    $('node-layer').onchange = event => mutate(() => { n.layerId = event.target.value; activeLayerId = n.layerId; camera.panX = 0; camera.panY = 0; }, { refit: true });
    $('connect-node').onclick = () => { connectSource = n.id; scene(); toast('现在点击目标节点；按 Esc 取消'); };
    $('delete-node').onclick = () => { mutate(() => removeNode(doc, n.id)); toast('节点已删除，可撤销'); };
    panel.querySelectorAll('[data-edit-edge]').forEach(button => { button.onclick = () => { beginEdgeEdit(button.dataset.editEdge); }; });
  }
  if (layer) {
    panel.innerHTML = head('图层设置') + '<label class="field">图层名称<input id="layer-name" maxlength="60" value="' + esc(layer.name) + '"></label><p class="inspector-note">平面视图一次只显示当前图层；三维视图显示所有图层。将图形拖到画布，即可放入当前图层。</p><div class="inspector-section"><button id="delete-layer" class="button danger full-button"' + (doc.layers.length <= 1 ? ' disabled' : '') + '>删除此图层</button><p class="inspector-note">删除时会移除本层节点及相关连线，可撤销。至少保留一个图层。</p></div>';
    bindText($('layer-name'), value => { layer.name = value.trim() || '未命名图层'; });
    $('delete-layer').onclick = () => deleteLayer(layer.id);
  }
  $('close-inspector').onclick = () => { inspectorNodeId = null; if (selection?.type !== 'node') selection = null; connectSource = null; render(); };
  requestAnimationFrame(viewBox);
}



const templates = [
  { id: 'rounded', svg: '<rect x="6" y="9" width="48" height="30" rx="7"/>' },
  { id: 'rectangle', svg: '<rect x="6" y="9" width="48" height="30"/>' },
  { id: 'diamond', svg: '<path d="M30 3L57 24L30 45L3 24Z"/>' },
  { id: 'ellipse', svg: '<ellipse cx="30" cy="24" rx="25" ry="17"/>' },
  { id: 'parallelogram', svg: '<path d="M13 9H56L47 39H4Z"/>' },
  { id: 'triangle', svg: '<path d="M30 5L55 42H5Z"/>' },
  { id: 'trapezoid', svg: '<path d="M16 8H44L56 40H4Z"/>' },
  { id: 'pentagon', svg: '<path d="M30 3L56 19L46 43H14L4 19Z"/>' },
  { id: 'hexagon', svg: '<path d="M17 7H43L57 24L43 41H17L3 24Z"/>' },
  { id: 'octagon', svg: '<path d="M17 5H43L55 16V32L43 43H17L5 32V16Z"/>' },
  { id: 'chevron', svg: '<path d="M5 8H42L57 24L42 40H5L20 24Z"/>' },
  { id: 'cylinder', svg: '<path d="M10 11A20 7 0 0 1 50 11V37A20 7 0 0 1 10 37Z"/><path d="M10 11A20 7 0 0 0 50 11" fill="none"/>' },
  { id: 'actor', svg: '<circle cx="30" cy="9" r="6"/><path d="M30 15V31M16 23H44M17 45L30 31L43 45" fill="none"/>' },
  { id: 'text', svg: '<text x="30" y="31" text-anchor="middle" stroke="none" fill="currentColor" font-size="24">T</text>' },
  { id: 'table', label: '表格', svg: '<rect x="5" y="7" width="50" height="34" rx="2"/><path d="M5 18H55M5 29H55M22 18V41"/>' },
].map(t => ({ ...t, kind: 'shape', shape: t.id, title: shapes[t.id], label: t.label || shapes[t.id] }));
$('shape-palette').innerHTML = templates.map(t => '<button class="palette-item" data-template="' + t.id + '" title="拖入' + t.label + '；双击或按 Enter 快速添加" aria-label="拖入' + t.label + '"><svg viewBox="0 0 60 48" aria-hidden="true">' + t.svg + '</svg><span>' + t.label + '</span></button>').join('');

function layerOptions(selectedId) { return doc.layers.map(layer => '<option value="' + esc(layer.id) + '"' + (layer.id === selectedId ? ' selected' : '') + '>' + esc(layer.name) + '</option>').join(''); }
function renderLayers() {
  $('layer-list').innerHTML = doc.layers.map((layer, index) => {
    const hasTable = doc.tables.some(t => t.layerId === layer.id), count = doc.nodes.filter(n => n.layerId === layer.id).length;
    return '<div class="layer-row' + (layer.id === activeLayerId ? ' active' : '') + '"><button class="layer-item' + (layer.id === activeLayerId ? ' active' : '') + '" data-select-layer="' + esc(layer.id) + '"><span class="layer-icon ' + (hasTable ? 'teal' : 'blue') + '">' + (hasTable ? '▦' : '▱') + '</span><span class="layer-name-wrap"><b>' + esc(layer.name) + '</b><small>' + count + ' 个节点' + (hasTable ? ' · ' + doc.tables.filter(t => t.layerId === layer.id).length + ' 张表格' : '') + '</small></span><span class="layer-number">' + String(index + 1).padStart(2, '0') + '</span></button><div class="layer-order"><button data-move-layer="' + esc(layer.id) + '" data-offset="-1" title="图层上移" aria-label="上移 ' + esc(layer.name) + '"' + (index === 0 ? ' disabled' : '') + '>↑</button><button data-move-layer="' + esc(layer.id) + '" data-offset="1" title="图层下移" aria-label="下移 ' + esc(layer.name) + '"' + (index === doc.layers.length - 1 ? ' disabled' : '') + '>↓</button></div><button class="layer-menu" data-manage-layer="' + esc(layer.id) + '" aria-label="设置 ' + esc(layer.name) + '">⋯</button></div>';
  }).join('');
  document.querySelector('[data-template="table"]').disabled = doc.tables.length >= 50;
}
function activateLayer(id, settings = false) {
  if (!doc.layers.some(layer => layer.id === id)) return;
  activeLayerId = id;
  selection = settings ? { type: 'layer', id } : null;
  // Retain a pending source so layers can be switched when creating a cross-layer edge.
  camera.panX = 0; camera.panY = 0; camera.zoom = 1;
  render({ refit: true });
}
function moveLayer(id, offset) {
  const from = doc.layers.findIndex(layer => layer.id === id), to = from + offset;
  if (from < 0 || to < 0 || to >= doc.layers.length) return;
  mutate(() => { const [layer] = doc.layers.splice(from, 1); doc.layers.splice(to, 0, layer); }, { refit: true });
}
function newLayer() {
  if (doc.layers.length >= 20) { toast('原型最多支持 20 个图层'); return; }
  const id = uid('layer');
  mutate(() => {
    let number = doc.layers.length + 1;
    while (doc.layers.some(layer => layer.name === '图层 ' + number)) number++;
    doc.layers.push({ id, name: '图层 ' + number });
    activeLayerId = id; selection = { type: 'layer', id }; connectSource = null;
    camera.panX = 0; camera.panY = 0; camera.zoom = 1;
  }, { refit: true });
  $('layer-name')?.focus(); $('layer-name')?.select();
}
function deleteLayer(id) {
  if (doc.layers.length <= 1) { toast('至少保留一个图层'); return; }
  const layer = doc.layers.find(layer => layer.id === id);
  const count = doc.nodes.filter(n => n.layerId === id).length;
  const tables = doc.tables.filter(t => t.layerId === id);
  confirm('删除「' + layer.name + '」？', '将移除本层 ' + count + ' 个节点及相关连线' + (tables.length ? '，以及 ' + tables.length + ' 张表格' : '') + '。删除后可以撤销恢复。', () => {
    mutate(() => { removeLayer(doc, id); selection = null; connectSource = null; }, { refit: true });
    toast('图层已删除，可撤销恢复');
  });
}
$('add-layer').onclick = newLayer;
$('sidebar-toggle').onclick = () => {
  const open = document.querySelector('.sidebar').classList.toggle('open');
  $('sidebar-toggle').setAttribute('aria-expanded', String(open));
};
$('layer-list').onclick = event => {
  const move = event.target.closest('[data-move-layer]'), manage = event.target.closest('[data-manage-layer]'), select = event.target.closest('[data-select-layer]');
  if (move) moveLayer(move.dataset.moveLayer, Number(move.dataset.offset));
  else if (manage) activateLayer(manage.dataset.manageLayer, true);
  else if (select) activateLayer(select.dataset.selectLayer);
};
$('node-list').onclick = event => { const button = event.target.closest('[data-list-node]'); if (button) selectNode(button.dataset.listNode); };

function newNode(templateId, position = null) {
  const template = templates.find(t => t.id === templateId);
  if (!template) return;
  if (template.id !== 'table' && doc.nodes.length >= 200) { toast('原型最多支持 200 个节点'); return; }
  if (template.id === 'table' && (doc.tables.length >= 50 || doc.tables.reduce((n, t) => n + t.columns.length * t.cells.length, 9) > 10000)) { toast('已达到表格或单元格数量上限'); return; }
  const drop = !!position;
  let { x, y } = position || { x: 0, y: 0 };
  if (!drop) while ([...doc.nodes, ...doc.tables.map(t => getDiagramObject(doc, t.id))].some(n => n.layerId === activeLayerId && Math.abs(n.x - x) < (template.id === 'table' ? 750 : 220) && Math.abs(n.y - y) < (template.id === 'table' ? 300 : 150))) { x += 240; if (x > 650) { x = -650; y += 180; } }
  x = Math.max(-8500, Math.min(8500, Math.round(x / 10) * 10));
  y = Math.max(-8500, Math.min(8500, Math.round(y / 10) * 10));
  mutate(() => {
    if (template.id === 'table') {
      const table = createTable(activeLayerId, x - 360, y - 140);
      doc.tables.push(table); selection = { type: 'table', id: table.id };
    } else {
      const id = uid('node');
      doc.nodes.push({ id, kind: template.kind, shape: template.shape, layerId: activeLayerId, title: template.title, description: '', x, y });
      selection = { type: 'node', id };
    }
  }, { refit: !drop, inspector: !drop });
  if (drop) {
    // Keep the canvas size stable so the object stays at the release position.
    if (!$('inspector').hidden) renderInspector();
    toast('已放入「' + doc.layers.find(layer => layer.id === activeLayerId).name + '」');
  } else if (template.id !== 'table') { beginInlineEdit(selection.id); } else { beginTableEdit(selection.id); }
}
function dropPoint(event) {
  if (!canEditPlane(camera, layerZ(doc, activeLayerId, camera))) return null;
  const rect = svg.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
  const p = worldPoint(event);
  return unprojectPoint(p.x, p.y, layerZ(doc, activeLayerId, camera), camera);
}
function clearPaletteDrag() {
  paletteDrag = null; $('palette-ghost').hidden = true; svg.querySelector('.drop-preview')?.remove();
  $('stage').classList.remove('drop-active');
}
$('shape-palette').addEventListener('pointerdown', event => {
  const item = event.target.closest('[data-template]');
  if (!item || event.button !== 0) return;
  const template = templates.find(t => t.id === item.dataset.template);
  paletteDrag = { template, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  item.setPointerCapture(event.pointerId);
  event.preventDefault();
});
document.addEventListener('pointermove', event => {
  if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
  if (Math.hypot(event.clientX - paletteDrag.x, event.clientY - paletteDrag.y) < 4 && !paletteDrag.moved) return;
  paletteDrag.moved = true;
  const ghost = $('palette-ghost'), position = dropPoint(event);
  ghost.hidden = false; ghost.style.left = (event.clientX + 16) + 'px'; ghost.style.top = (event.clientY + 16) + 'px';
  ghost.textContent = position ? '放入 ' + doc.layers.find(layer => layer.id === activeLayerId).name : paletteDrag.template.label + ' · 拖到画布';
  $('stage').classList.toggle('drop-active', !!position);
  svg.querySelector('.drop-preview')?.remove();
  if (position) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'drop-preview');
    group.innerHTML = planeMarkup('<rect x="' + (position.x - 100) + '" y="' + (position.y - 56) + '" width="200" height="112" rx="10"/><path d="M' + (position.x - 15) + ' ' + position.y + 'h30M' + position.x + ' ' + (position.y - 15) + 'v30"/>', layerZ(doc, activeLayerId, camera), camera);
    svg.append(group);
  }
});
document.addEventListener('pointerup', event => {
  if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
  const { template, moved } = paletteDrag, position = dropPoint(event);
  clearPaletteDrag();
  if (position && moved) newNode(template.id, position);
});
document.addEventListener('pointercancel', clearPaletteDrag);
$('shape-palette').addEventListener('dblclick', event => { const item = event.target.closest('[data-template]'); if (item) newNode(item.dataset.template); });
$('shape-palette').addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  const item = event.target.closest('[data-template]');
  if (item) { event.preventDefault(); newNode(item.dataset.template); }
});

function switchView(mode) {
  camera.mode = mode; camera.panX = 0; camera.panY = 0; camera.zoom = 1;
  for (const name of ['flat', 'spatial']) { $(`view-${name}`).classList.toggle('active', name === mode); $(`view-${name}`).setAttribute('aria-pressed', String(name === mode)); }
  document.querySelector('.orientation span').textContent = mode === 'flat' ? '平面视图' : '空间视图';
  $('interaction-hint').textContent = mode === 'flat' ? '拖动节点 · 拖动空白平移 · 滚轮缩放' : '拖动图形跨层移动 · 空白拖动旋转 · 滚轮缩放';
  if (mode === 'flat') { $('camera-panel').hidden = true; $('camera-toggle').setAttribute('aria-expanded', 'false'); }
  if (selection?.type === 'node' && doc.nodes.find(n => n.id === selection.id)?.layerId !== activeLayerId) selection = null;
  render({ refit: true });
}
$('view-flat').onclick = () => switchView('flat'); $('view-spatial').onclick = () => switchView('spatial');
$('show-relations').onchange = event => { showRelations = event.target.checked; scene(); };
$('camera-toggle').onclick = () => {
  if (camera.mode === 'flat') { toast('切换到三维视图后可调整空间角度'); return; }
  $('camera-panel').hidden = !$('camera-panel').hidden; $('camera-toggle').setAttribute('aria-expanded', String(!$('camera-panel').hidden));
};
$('camera-close').onclick = () => { $('camera-panel').hidden = true; $('camera-toggle').setAttribute('aria-expanded', 'false'); };
function syncCameraInputs() { for (const key of ['tilt', 'yaw', 'gap']) { $(key).value = camera[key]; $(`${key}-value`).textContent = `${Math.round(camera[key])}${key === 'gap' ? '' : '°'}`; } }
for (const key of ['tilt', 'yaw', 'gap']) $(key).oninput = event => { camera[key] = Number(event.target.value); syncCameraInputs(); scene(true); };

function fit() { Object.assign(camera, { tilt: 55, yaw: -30, gap: 640, zoom: 1, panX: 0, panY: 0 }); syncCameraInputs(); scene(true); }
$('fit').onclick = fit;
function zoom(factor) { camera.zoom = Math.max(.4, Math.min(3, camera.zoom * factor)); viewBox(); }
$('zoom-in').onclick = () => zoom(1.2); $('zoom-out').onclick = () => zoom(1 / 1.2);
svg.addEventListener('wheel', event => { event.preventDefault(); zoom(Math.exp(-event.deltaY * .001)); }, { passive: false });
function worldPoint(event) { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }

function hitNode(event) {
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (!svg.contains(element)) return null;
    if (element.closest('.edge-endpoint,.connection-preview,.anchor-preview')) continue;
    const object = element.closest('[data-object]');
    if (object) return editableObject(object.dataset.object) ? object.dataset.object : null;
    // Do not connect through an occluding upper plane.
    if (element.closest('[data-scene-layer]')) return null;
  }
  return null;
}
function editableObject(id) {
  const object = getDiagramObject(doc, id);
  return object && canEditPlane(camera, layerZ(doc, object.layerId, camera));
}
function edgeEndPoint(id, end) {
  const path = svg.querySelector('[data-edge="' + id + '"] .edge-line');
  if (!path) return null;
  const point = path.getPointAtLength(end === 'source' ? 0 : path.getTotalLength());
  return elementScreenPoint(path, point).matrixTransform(svg.getScreenCTM().inverse());
}
function renderEdgeHandles() {
  svg.querySelectorAll('.edge-endpoint').forEach(el => el.remove());
  if (selection?.type !== 'edge') return;
  const edge = doc.edges.find(e => e.id === selection.id);
  if (!edge) return;
  const radius = 6 * svg.viewBox.baseVal.width / Math.max(svg.getBoundingClientRect().width, 1);
  for (const end of ['source', 'target']) {
    const p = edgeEndPoint(edge.id, end), object = getDiagramObject(doc, edge[end]);
    if (!p || !object || !editableObject(object.id)) continue;
    const screen = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM());
    const stacks = [...svg.querySelectorAll('[data-layer-stack]')].map(el => el.dataset.layerStack);
    const surface = document.elementsFromPoint(screen.x, screen.y).find(el => !el.closest('.flow-edge,.edge-endpoint,.anchor-preview') && el.closest('[data-layer-content],[data-scene-layer]'));
    const visibleLayer = surface?.closest('[data-layer-content]')?.dataset.layerContent || surface?.closest('[data-scene-layer]')?.dataset.sceneLayer;
    if (visibleLayer && stacks.indexOf(visibleLayer) > stacks.indexOf(object.layerId)) continue;
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('class', 'edge-endpoint'); group.dataset.edgeEndpoint = end; group.dataset.edgeId = edge.id;
    group.setAttribute('transform', `translate(${p.x},${p.y})`);
    group.innerHTML = `<title>拖动${end === 'source' ? '起点' : '终点'}：沿边缘自由放置，靠近中点吸附</title><circle class="endpoint-hit" r="${radius + 5}"/><circle class="endpoint-dot" r="${radius}"/>`;
    // Keep visible handles above their own crossing edge, without exposing hidden layers.
    svg.append(group);
  }
}
function anchorAtEvent(object, event) {
  const p = worldPoint(event), z = layerZ(doc, object.layerId, camera);
  const local = unprojectPoint(p.x, p.y, z, camera), free = freePort(object, local);
  const candidate = portPoint(object, free), c = project(candidate.x, candidate.y, z, camera);
  const screen = point => new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM());
  const a = screen(c);
  let closest = null, distance = 10;
  for (const port of ['n', 'e', 's', 'w']) {
    const q = portPoint(object, port), b = screen(project(q.x, q.y, z, camera)), d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= distance) { distance = d; closest = port; }
  }
  return closest || free;
}
function anchorPreview(point, snapped) {
  const circle = document.createElementNS(svg.namespaceURI, 'circle');
  circle.setAttribute('class', 'anchor-preview' + (snapped ? ' snapped' : ''));
  circle.setAttribute('cx', point.x); circle.setAttribute('cy', point.y);
  circle.setAttribute('r', 6 * svg.viewBox.baseVal.width / Math.max(svg.getBoundingClientRect().width, 1));
  svg.append(circle);
}
function hitLayer(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!element || !svg.contains(element)) return null;
  // Interactive lines may be above a plane; use the first actual plane underneath for a drop.
  for (const target of document.elementsFromPoint(event.clientX, event.clientY)) {
    const layer = target.closest('[data-layer-content]')?.dataset.layerContent || target.closest('[data-scene-layer]')?.dataset.sceneLayer;
    if (layer) return layer;
  }
  return null;
}
function clearDragPreview() {
  svg.querySelectorAll('.drag-preview,.connection-preview,.anchor-preview,.selection-marquee').forEach(el => el.remove());
  svg.querySelectorAll('.drop-plane,.connection-target,.dragging-node').forEach(el => el.classList.remove('drop-plane', 'connection-target', 'dragging-node'));
  $('palette-ghost').hidden = true;
}
function cancelCanvasDrag() {
  if (drag?.moved && ['node', 'resize', 'group'].includes(drag.kind)) {
    doc = drag.before; history.past.pop(); history.future = drag.future; persist();
  }
  if (drag?.kind === 'marquee') selection = drag.previousSelection;
  drag = null; clearDragPreview();
}
function updateSpatialDrag(event) {
  const node = getDiagramObject(doc, drag.id);
  svg.querySelector('[data-object="' + drag.id + '"]')?.classList.add('dragging-node');
  svg.querySelector('.drag-preview')?.remove();
  const layerId = hitLayer(event);
  drag.targetLayer = layerId;
  svg.querySelectorAll('.drop-plane').forEach(el => el.classList.remove('drop-plane'));
  const targetLayer = layerId || node.layerId;
  const p = worldPoint(event);
  const grabbed = unprojectPoint(drag.start.x, drag.start.y, layerZ(doc, node.layerId, camera), camera);
  const local = unprojectPoint(p.x, p.y, layerZ(doc, targetLayer, camera), camera);
  drag.position = { x: Math.max(-9000, Math.min(9000, Math.round(node.x + local.x - grabbed.x))), y: Math.max(-9000, Math.min(9000, Math.round(node.y + local.y - grabbed.y))) };
  const wrapper = document.createElementNS(svg.namespaceURI, 'g');
  wrapper.setAttribute('class', 'drag-preview');
  const ghost = svg.querySelector('[data-object="' + drag.id + '"]').cloneNode(true);
  ghost.removeAttribute('data-node'); ghost.removeAttribute('data-object'); ghost.removeAttribute('data-table'); ghost.removeAttribute('tabindex'); ghost.classList.remove('dragging-node');
  ghost.setAttribute('transform', 'translate(' + (drag.position.x - (node.kind === 'table' ? node.width / 2 : 0)) + ',' + (drag.position.y - (node.kind === 'table' ? node.height / 2 : 0)) + ')');
  ghost.querySelectorAll('.resize-controls,.connection-controls').forEach(el => el.remove());
  wrapper.innerHTML = planeMarkup(ghost.outerHTML, layerZ(doc, targetLayer, camera), camera); svg.append(wrapper);
  if (layerId) svg.querySelector('[data-plane-layer="' + layerId + '"]').classList.add('drop-plane');
  const tip = $('palette-ghost'); tip.hidden = false;
  tip.style.left = (event.clientX + 18) + 'px'; tip.style.top = (event.clientY + 18) + 'px';
  tip.textContent = layerId ? '松手放入「' + doc.layers.find(l => l.id === layerId).name + '」' : '移到目标图层上，Esc 取消';
}
function updateConnectionDrag(event) {
  svg.querySelectorAll('.connection-preview,.anchor-preview').forEach(el => el.remove());
  svg.querySelectorAll('.connection-target').forEach(el => el.classList.remove('connection-target'));
  const editing = drag.kind === 'endpoint', source = getDiagramObject(doc, editing ? drag.otherId : drag.id);
  const targetId = hitNode(event);
  const target = targetId !== source.id ? getDiagramObject(doc, targetId) : null;
  drag.target = target?.id || null;
  const start = editing ? null : portPoint(source, drag.port);
  const a = editing ? drag.fixedPoint : project(start.x, start.y, layerZ(doc, source.layerId, camera), camera);
  let b = worldPoint(event);
  if (target) {
    drag.targetPort = anchorAtEvent(target, event);
    const end = portPoint(target, drag.targetPort);
    b = project(end.x, end.y, layerZ(doc, target.layerId, camera), camera);
    svg.querySelector('[data-object="' + target.id + '"]').classList.add('connection-target');
    anchorPreview(b, typeof drag.targetPort === 'string');
  }
  if (!editing) anchorPreview(a, typeof drag.port === 'string');
  const preview = document.createElementNS(svg.namespaceURI, 'path');
  preview.setAttribute('class', 'connection-preview');
  preview.setAttribute('d', editing && drag.end === 'source' ? `M${b.x} ${b.y}L${a.x} ${a.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`);
  preview.setAttribute('marker-end', 'url(#data-arrow)'); svg.append(preview);
}
svg.addEventListener('pointerdown', event => {
  if (event.target.closest('.node-inline-editor,.edge-inline-editor,.table-inline-editor')) return;
  if (event.button !== 0 && event.button !== 1) return;
  const candidate = event.target.closest('[data-object]');
  const node = candidate && editableObject(candidate.dataset.object) ? candidate : null;
  const resize = event.target.closest('[data-resize]')?.dataset.resize;
  const freeBoundary = node && event.target.closest('[data-free-port]');
  const port = event.target.closest('[data-port]')?.dataset.port || (freeBoundary ? anchorAtEvent(getDiagramObject(doc, node.dataset.object), event) : null);
  const endpoint = event.target.closest('[data-edge-endpoint]');
  const object = event.target.closest('[data-edge],[data-relation-link]');
  if (event.button === 1) {
    const box = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
    drag = { kind: camera.mode === 'spatial' && !event.shiftKey && event.button === 0 ? 'rotate' : 'pan', clientX: event.clientX, clientY: event.clientY, panX: camera.panX, panY: camera.panY, yaw: camera.yaw, tilt: camera.tilt, scaleX: box.width / rect.width, scaleY: box.height / rect.height, moved: false };
    lastNodePress = null; lastObjectPress = null;
  } else if (node && (event.shiftKey || event.ctrlKey || event.metaKey) && !connectSource) {
    const id = node.dataset.object, ids = selectedObjectIds();
    setObjectSelection(ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]);
    inspectorNodeId = null; render(); lastNodePress = null; lastObjectPress = null; event.preventDefault(); return;
  } else if (node && selection?.type === 'multi' && selection.ids.includes(node.dataset.object) && !connectSource) {
    drag = { kind: 'group', ids: [...selection.ids], before: clone(doc), future: clone(history.future), start: worldPoint(event), moved: false, clientX: event.clientX, clientY: event.clientY };
    lastNodePress = null; lastObjectPress = null;
  } else if (endpoint && event.button === 0) {
    const edge = doc.edges.find(e => e.id === endpoint.dataset.edgeId), end = endpoint.dataset.edgeEndpoint;
    const other = end === 'source' ? 'target' : 'source';
    drag = { kind: 'endpoint', edgeId: edge.id, end, otherId: edge[other], fixedPoint: edgeEndPoint(edge.id, other), clientX: event.clientX, clientY: event.clientY, moved: false };
    lastNodePress = null; lastObjectPress = null;
  } else if (node && event.button === 0) {
    const id = node.dataset.object;
    const doublePress = !resize && !port && lastNodePress?.id === id && performance.now() - lastNodePress.time < (getDiagramObject(doc, id).kind === 'table' ? 650 : 450);
    lastNodePress = { id, time: performance.now() };
    if (connectSource && !resize && !port) { selectNode(id); return; }
    connectSource = null; selectNode(id);
    const n = getDiagramObject(doc, id), size = nodeSize(n);
    viewBox();
    drag = { kind: resize ? 'resize' : port ? 'connection' : camera.mode === 'spatial' ? 'spatial-node' : 'node', id, handle: resize, port, width: size.w * 2, height: size.h * 2, start: worldPoint(event), x: n.x, y: n.y, before: clone(doc), future: clone(history.future), moved: false, clientX: event.clientX, clientY: event.clientY, focusName: doublePress };
  } else if (object && event.button === 0) {
    const type = 'edge', id = object.dataset.edge;
    const doublePress = lastObjectPress?.id === id && lastObjectPress.type === type && performance.now() - lastObjectPress.time < 650;
    lastObjectPress = { type, id, time: performance.now() }; lastNodePress = null;
    selection = { type, id }; inspectorNodeId = null; connectSource = null; render({ table: false });
    drag = { kind: 'select', focusName: doublePress, clientX: event.clientX, clientY: event.clientY, moved: false };
  } else if (pointerTool === 'select' && event.button === 0) {
    lastNodePress = null; lastObjectPress = null; inspectorNodeId = null; connectSource = null;
    drag = { kind: 'marquee', clientX: event.clientX, clientY: event.clientY, start: worldPoint(event), baseIds: event.shiftKey || event.ctrlKey || event.metaKey ? selectedObjectIds() : [], previousSelection: clone(selection), moved: false };
  } else {
    lastNodePress = null; lastObjectPress = null;
    const box = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
    drag = { kind: camera.mode === 'spatial' && !event.shiftKey && event.button === 0 ? 'rotate' : 'pan', clientX: event.clientX, clientY: event.clientY, panX: camera.panX, panY: camera.panY, yaw: camera.yaw, tilt: camera.tilt, scaleX: box.width / rect.width, scaleY: box.height / rect.height, moved: false };
  }
  if (drag) { svg.setPointerCapture(event.pointerId); event.preventDefault(); }
});
svg.addEventListener('pointermove', event => {
  if (!drag) {
    svg.querySelectorAll('.anchor-preview').forEach(el => el.remove());
    const object = event.target.closest('[data-object]');
    if (object && event.target.closest('[data-free-port]') && editableObject(object.dataset.object)) {
      const n = getDiagramObject(doc, object.dataset.object), port = anchorAtEvent(n, event), p = portPoint(n, port);
      anchorPreview(project(p.x, p.y, layerZ(doc, n.layerId, camera), camera), typeof port === 'string');
    }
    return;
  }
  if (drag.kind === 'select') return;
  const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved && ['node', 'resize', 'group'].includes(drag.kind)) history.push(drag.before);
  drag.moved = true;
  if (drag.kind === 'marquee') {
    updateMarquee(event);
  } else if (drag.kind === 'group') {
    const objects = drag.ids.map(id => getDiagramObject(drag.before, id));
    const p = worldPoint(event), delta = unprojectDelta(p.x - drag.start.x, p.y - drag.start.y, camera, drag.start, layerZ(doc, objects[0].layerId, camera));
    // Clamp the whole group by the same delta to preserve relative positions.
    const dx = Math.max(...objects.map(n => -9000 - n.x), Math.min(Math.round(delta.x), ...objects.map(n => 9000 - n.x)));
    const dy = Math.max(...objects.map(n => -9000 - n.y), Math.min(Math.round(delta.y), ...objects.map(n => 9000 - n.y)));
    objects.forEach(n => updateDiagramObject(doc, n.id, { x: n.x + dx, y: n.y + dy }));
    scene();
  } else if (drag.kind === 'node' || drag.kind === 'resize') {
    const n = getDiagramObject(doc, drag.id);
    const p = worldPoint(event), delta = unprojectDelta(p.x - drag.start.x, p.y - drag.start.y, camera, drag.start, layerZ(doc, n.layerId, camera));
    const minWidth = n.kind === 'table' ? 240 : 80, minHeight = n.kind === 'table' ? 100 : 60, maxSize = n.kind === 'table' ? 4000 : 2400;
    if (drag.kind === 'resize') {
      const sx = drag.handle.includes('e') ? 1 : drag.handle.includes('w') ? -1 : 0;
      const sy = drag.handle.includes('s') ? 1 : drag.handle.includes('n') ? -1 : 0;
      n.width = sx ? Math.max(minWidth, drag.width - 2 * (10000 + sx * drag.x), Math.min(maxSize, drag.width + 2 * (10000 - sx * drag.x), Math.round(drag.width + delta.x * sx))) : drag.width;
      n.height = sy ? Math.max(minHeight, drag.height - 2 * (10000 + sy * drag.y), Math.min(maxSize, drag.height + 2 * (10000 - sy * drag.y), Math.round(drag.height + delta.y * sy))) : drag.height;
      n.x = drag.x + sx * (n.width - drag.width) / 2;
      n.y = drag.y + sy * (n.height - drag.height) / 2;
    } else {
      n.x = Math.max(-9000, Math.min(9000, Math.round(drag.x + delta.x)));
      n.y = Math.max(-9000, Math.min(9000, Math.round(drag.y + delta.y)));
    }
    if (n.kind === 'table') updateDiagramObject(doc, drag.id, drag.kind === 'resize' ? { x: n.x, y: n.y, width: n.width, height: n.height } : { x: n.x, y: n.y });
    scene();
  } else if (drag.kind === 'spatial-node') {
    updateSpatialDrag(event);
  } else if (['connection', 'endpoint'].includes(drag.kind)) {
    updateConnectionDrag(event);
  } else if (drag.kind === 'pan') {
    camera.panX = drag.panX - dx * drag.scaleX; camera.panY = drag.panY - dy * drag.scaleY; viewBox();
  } else {
    camera.yaw = wrapAngle(drag.yaw - dx * .25 + 180) - 180; camera.tilt = wrapAngle(drag.tilt - dy * .2); syncCameraInputs(); scene();
  }
});
function endDrag(event) {
  if (!drag) return;
  if (event.type === 'pointercancel') { cancelCanvasDrag(); scene(); return; }
  const action = drag;
  if (drag.moved) {
    lastDragAt = performance.now(); lastNodePress = null; lastObjectPress = null;
    if (drag.kind === 'spatial-node') updateSpatialDrag(event);
    if (['connection', 'endpoint'].includes(drag.kind)) updateConnectionDrag(event);
    if (drag.kind === 'marquee') updateMarquee(event);
  }
  drag = null; clearDragPreview();
  if (action.moved) {
    if (['node', 'resize', 'group'].includes(action.kind)) persist();
    else if (action.kind === 'marquee') render({ table: false });
    else if (action.kind === 'spatial-node' && action.targetLayer) {
      mutate(() => {
        updateDiagramObject(doc, action.id, { ...action.position, layerId: action.targetLayer }); activeLayerId = action.targetLayer;
      });
      if (getDiagramObject(action.before, action.id).layerId !== action.targetLayer) toast('已移入「' + doc.layers.find(l => l.id === action.targetLayer).name + '」，原有连线和表格关联已保留');
    } else if (action.kind === 'endpoint' && action.target) {
      const edge = doc.edges.find(e => e.id === action.edgeId);
      const source = action.end === 'source' ? action.target : edge.source, target = action.end === 'target' ? action.target : edge.target;
      if (doc.edges.some(e => e.id !== edge.id && e.source === source && e.target === target && (e.style ?? 'solid') === (edge.style ?? 'solid'))) toast('这两个图形之间已有同方向连线');
      else if (edge[action.end] !== action.target || JSON.stringify(edge[action.end + 'Port']) !== JSON.stringify(action.targetPort)) mutate(() => { edge[action.end] = action.target; edge[action.end + 'Port'] = action.targetPort; });
    } else if (action.kind === 'connection' && action.target) {
      if (doc.edges.some(e => e.source === action.id && e.target === action.target && e.style !== 'dashed')) toast('这两个节点之间已有同方向连线');
      else if (doc.edges.length >= 1000) toast('原型最多支持 1000 条流程连线');
      else mutate(() => { addEdge(doc, action.id, action.target, action.port, action.targetPort); selection = { type: 'edge', id: doc.edges.at(-1).id }; });
    }
  } else if (action.kind === 'marquee') { setObjectSelection(action.baseIds); render({ table: false }); }
  else if (['rotate', 'pan'].includes(action.kind) && event.button === 0) { selection = null; render({ table: false }); }
  else if (action.focusName) editSelection();
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
}
svg.addEventListener('pointerleave', () => { if (!drag) svg.querySelectorAll('.anchor-preview').forEach(el => el.remove()); });
svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('dblclick', event => {
  if (inlineEdit || performance.now() - lastDragAt < 200 || event.target.closest('[data-resize],[data-port],[data-free-port],[data-edge-endpoint]')) return;
  const node = event.target.closest('[data-node]'), edge = event.target.closest('[data-edge],[data-relation-link]');
  if (node) beginInlineEdit(node.dataset.node);
  else if (edge) beginEdgeEdit(edge.dataset.edge);
  else if (event.target.closest('[data-table]')) beginTableEdit(event.target.closest('[data-table]').dataset.table);
  else if (lastObjectPress && performance.now() - lastObjectPress.time < 600) editSelection();
  else if (lastNodePress && performance.now() - lastNodePress.time < 600) editSelection();
});
svg.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const node = event.target.closest('[data-node]'), edge = event.target.closest('[data-edge],[data-relation-link]');
  if (node) { event.preventDefault(); beginInlineEdit(node.dataset.node); }
  else if (edge) { event.preventDefault(); beginEdgeEdit(edge.dataset.edge); }
  else if (event.target.closest('[data-table]')) { event.preventDefault(); beginTableEdit(event.target.closest('[data-table]').dataset.table); }
});
new ResizeObserver(viewBox).observe($('stage'));
$('cancel-connect').onclick = () => { connectSource = null; scene(); };

function travel(direction) {
  doc = history[direction](doc); connectSource = null;
  if (!doc.layers.some(layer => layer.id === activeLayerId)) activeLayerId = doc.layers[0].id;
  if (selection?.type === 'layer' && !doc.layers.some(layer => layer.id === selection.id)) selection = null;
  if (selection?.type === 'node' && !doc.nodes.some(n => n.id === selection.id)) selection = null;
  if (selection?.type === 'edge' && !doc.edges.some(e => e.id === selection.id)) selection = null;
  if (selection?.type === 'table' && !doc.tables.some(t => t.id === selection.id)) selection = null;
  persist(); render({ refit: true });
}
$('undo').onclick = () => travel('undo'); $('redo').onclick = () => travel('redo');
document.addEventListener('keydown', event => {
  if (inlineEdit?.editor.contains(event.target)) return;
  if (event.key === 'Escape') { if (!drag) selection = null; cancelCanvasDrag(); connectSource = null; clearPaletteDrag(); scene(); }
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (!editing && event.key === 'F2' && selection) { event.preventDefault(); editSelection(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !editing && !$('confirm-dialog').open && !$('workspace-dialog').open && ['node', 'edge', 'table', 'multi'].includes(selection?.type)) {
    event.preventDefault(); if (selection.type === 'edge') mutate(() => { doc.edges = doc.edges.filter(e => e.id !== selection.id); }); else deleteSelected();
  }
});

let confirmAction;
function confirm(title, message, action) { $('confirm-title').textContent = title; $('confirm-message').textContent = message; confirmAction = action; $('confirm-dialog').showModal(); }
$('confirm-cancel').onclick = () => { $('confirm-dialog').close(); confirmAction = null; };
$('confirm-ok').onclick = () => { $('confirm-dialog').close(); const action = confirmAction; confirmAction = null; action?.(); };
$('reset').onclick = () => confirm('清空当前画布？', '当前工作空间将只保留一个空白图层。清空后可以撤销，其他工作空间不受影响。', () => { mutate(() => { doc = blankDocument(); selection = null; connectSource = null; }); fit(); toast('已清空画布，可撤销'); });
function downloadFile(content, type, extension) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = `DrawAI-图表-${new Date().toLocaleDateString('sv-SE')}.${extension}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('export').onclick = async () => {
  const button = $('export'); button.disabled = true;
  try {
    finishInlineEdit(true);
    if (desktop) { await desktopCommand({ type: 'export' }); return; }
    const payload = validateDiagramFile(desktopPayload());
    const text = JSON.stringify(payload, null, 2) + '\n';
    if (new Blob([text]).size > 12 * 1024 * 1024) throw new Error('图表文件超过 12 MB，请拆分工作空间。');
    downloadFile(text, 'application/octet-stream', 'drawai');
    toast('已导出 .drawai 文件，请使用 DrawAI 程序打开');
  } catch (error) { toast(error.message || '导出失败，请重试。'); }
  finally { button.disabled = false; }
};

let portableAssets = window.__DRAWAI_FILE__?.assets || null;
function bootPortable() {
  try {
    const payload = JSON.parse(document.getElementById('drawai-file').textContent);
    window.__DRAWAI_FILE__ = payload;
    const script = document.createElement('script'); script.textContent = payload.assets.script;
    document.body.append(script);
  } catch {
    document.getElementById('save-status').textContent = '文件无法读取，请重新打开原文件';
  }
}
function portableView() {
  return { mode: camera.mode, tilt: camera.tilt, yaw: camera.yaw, gap: camera.gap, activeLayerId, showRelations };
}
function portableHtml(snapshot, view, storageKey, revision = crypto.randomUUID(), workspaceName = workspaceCatalog.find(w => w.id === activeWorkspaceId).name) {
  const payload = { format: 1, storageKey, revision, workspaceName, document: validateDocument(snapshot), view, assets: portableAssets };
  // Escape raw-text HTML delimiters, including user-entered </script> text.
  const data = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return portableAssets.html.replace('</head>', () => '<style>' + portableAssets.css + '</style></head>').replace('</body>', () => '<script id="drawai-file" type="application/json">' + data + '</script><script>(' + bootPortable.toString() + ')();</script></body>');
}
function originalFileStatus() {
  if (!originalWorkspace()) return;
  if (!originalFile.handle) {
    $('save-status').textContent = storageAvailable ? '仅保存在浏览器' : '自动保存不可用，请导出备份';
    return;
  }
  $('save-status').textContent = originalFile.error ? '原文件未保存，请重试' : originalFile.writing ? '正在写入原文件…' : originalFile.pending ? '等待写入原文件…' : '已保存到原文件';
  $('save-original').textContent = originalFile.error ? '重试保存' : '立即保存';
}
function queueOriginalSave() {
  if (!originalFile.handle || !originalWorkspace()) return;
  originalFile.pending = true;
  clearTimeout(originalFile.timer);
  if (!originalFile.error) originalFile.timer = setTimeout(writeOriginalFile, 600);
}
async function writeOriginalFile() {
  clearTimeout(originalFile.timer);
  if (!originalFile.handle || originalFile.writing || !originalFile.pending || originalFile.error) return;
  originalFile.writing = true; originalFileStatus();
  try {
    // Serialize writes: edits made during a write are saved by the next iteration.
    while (originalFile.pending) {
      originalFile.pending = false;
      const revision = crypto.randomUUID();
      const source = originalWorkspace() ? { doc, view: portableView() } : workspaceSessions.get('default');
      const html = portableHtml(clone(source.doc), source.view, STORAGE_KEY, revision, workspaceCatalog.find(w => w.id === 'default').name);
      const current = await originalFile.handle.getFile();
      if (await current.text() !== originalFile.expectedText) throw new Error('原文件已被其他窗口修改，请重新打开文件后再编辑；当前修改可先导出备份。');
      let writable;
      try {
        writable = await originalFile.handle.createWritable();
        await writable.write(html);
        await writable.close();
      } catch (error) {
        try { await writable?.abort(); } catch { /* Preserve the original write error. */ }
        throw error;
      }
      originalFile.expectedText = html;
      window.__DRAWAI_FILE__.revision = revision;
      // Only recover a browser draft when it belongs to this exact file revision.
      try { localStorage.setItem(STORAGE_KEY + '.file-revision', revision); } catch { /* File saving works without browser storage. */ }
    }
  } catch (error) {
    originalFile.pending = true; originalFile.error = error;
    toast(error.name === 'NotAllowedError' ? '文件写入权限已失效，请点击「重试保存」重新授权。' : error.message || '原文件保存失败，请重试或导出备份。');
  } finally { originalFile.writing = false; originalFileStatus(); }
}
$('save-original').onclick = async () => {
  if (!originalWorkspace()) return;
  finishInlineEdit(true);
  const button = $('save-original'); button.disabled = true;
  try {
    const handle = originalFile.handle || (await window.showOpenFilePicker({
      multiple: false, mode: 'readwrite', types: [{ description: 'DrawAI HTML 图表', accept: { 'text/html': ['.html'] } }],
    }))[0];
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('未获得文件写入权限。可再次启用，或导出 .drawai 文件保存修改。');
    }
    if (!originalFile.handle) {
      const file = await handle.getFile();
      if (file.size > 32 * 1024 * 1024) throw new Error('请选择当前打开的 DrawAI HTML 原文件。');
      const text = await file.text();
      const embedded = new DOMParser().parseFromString(text, 'text/html').getElementById('drawai-file');
      let payload;
      try { payload = JSON.parse(embedded?.textContent); } catch { /* Reject unrelated files below. */ }
      if (payload?.format !== 1 || payload.storageKey !== STORAGE_KEY) throw new Error('选中的文件不是当前图表的原文件，请重新选择。');
      if (payload.revision !== window.__DRAWAI_FILE__.revision) throw new Error('原文件已有其他修改，请重新打开后再编辑；当前修改可先导出备份。');
      originalFile.handle = handle; originalFile.expectedText = text;
      document.querySelector('.sidebar-bottom p').textContent = '编辑完成后自动保存到原 HTML。每次重新打开，请选择原文件并授权。';
    }
    originalFile.error = null; originalFile.pending = true;
    await writeOriginalFile();
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message || '无法关联原文件，请重试或导出备份。');
  } finally { button.disabled = false; originalFileStatus(); }
};
window.addEventListener('beforeunload', event => {
  if (!originalFile.handle) return;
  finishInlineEdit(true);
  if (originalFile.pending || originalFile.writing) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('keydown', event => {
  if (originalWorkspace() && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); if (!$('save-original').disabled) $('save-original').click();
  }
});
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error('文件过大，请选择小于 12 MB 的 DrawAI 文件。');
    const value = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    const wrapped = file.name.toLowerCase().endsWith('.drawai') || value?.format !== undefined;
    const payload = wrapped ? validateDiagramFile(value) : null;
    const imported = payload ? payload.document : validateDocument(value);
    confirm('导入流程图？', `将用文件中的 ${imported.nodes.length} 个节点和 ${imported.tables.length} 张表格替换当前画布。导入后可撤销。`, () => { mutate(() => { doc = imported; selection = null; connectSource = null; });
      if (payload) {
        workspaceCatalog.find(w => w.id === activeWorkspaceId).name = payload.workspaceName;
        restoreWorkspaceView(payload.view); renderWorkspaces(); persist();
      } else fit();
      toast('已导入流程图'); });
  } catch (error) { toast(error instanceof SyntaxError ? '无法读取图表文件，请检查文件内容。' : error.message); }
};
render({ refit: true });
restoreWorkspaceView(workspaceCatalog.find(w => w.id === activeWorkspaceId).view || { mode: initialFile ? 'spatial' : 'flat' });
if (window.__DRAWAI_FILE__) {
  const view = window.__DRAWAI_FILE__.view || {};
  if (doc.layers.some(layer => layer.id === view.activeLayerId)) activeLayerId = view.activeLayerId;
  showRelations = view.showRelations !== false; $('show-relations').checked = showRelations;
  switchView(view.mode === 'flat' ? 'flat' : 'spatial');
  for (const [key, min, max] of [['tilt', 0, 360], ['yaw', -180, 180], ['gap', 250, 1000]]) if (Number.isFinite(view[key])) camera[key] = Math.max(min, Math.min(max, view[key]));
  syncCameraInputs(); scene(true);
  document.querySelector('.project-heading span').textContent = '离线图表';
  document.querySelector('.sidebar-bottom p').textContent = '点击「启用文件自动保存」，选择当前 HTML 并授权后，编辑自动回写原文件。';
  $('save-original').hidden = false;
  if (typeof window.showOpenFilePicker !== 'function') {
    $('save-original').disabled = true;
    $('save-original').title = '请用桌面版 Chrome / Edge 启用文件自动保存';
    document.querySelector('.sidebar-bottom p').textContent = '此浏览器不支持原文件自动保存。请用桌面版 Chrome / Edge 打开，或导出 .drawai 文件保存修改。';
  }
  originalFileStatus();

}
if (!storageAvailable) { $('save-status').textContent = '自动保存不可用，请导出备份'; toast('浏览器存储不可用，编辑后请导出文件保存。'); }

function desktopPayload(id = activeWorkspaceId) {
  const workspace = workspaceCatalog.find(w => w.id === id);
  const session = id === activeWorkspaceId ? { doc, view: portableView() } : workspaceSessions.get(id);
  return { format: 'drawai', version: 1, workspaceName: workspace.name, document: clone(session?.doc || JSON.parse(localStorage.getItem(workspaceStorageKey(id)))), view: session?.view || workspace.view || {} };
}
function desktopStatus(result) {
  if (!desktop) return;
  if (result?.error) { toast(result.error); $('save-status').textContent = '保存未完成'; return; }
  if (result?.entries) desktopState.entries = new Map(result.entries.map(e => [e.id, e]));
  const status = desktopState.entries.get(activeWorkspaceId);
  $('save-status').textContent = status?.dirty ? '有未保存的修改' : status?.path ? '已保存到文件' : '尚未保存为文件';
  $('save-status').title = status?.path || '点击保存，生成 .drawai 图表文件';
}
function desktopSync(id = activeWorkspaceId) {
  if (!desktop || !desktopState.ready) return;
  const entry = { id, activeId: activeWorkspaceId, payload: desktopPayload(id) };
  desktopState.pending = desktopState.pending.then(() => desktop.changed(entry)).then(desktopStatus).catch(error => desktopStatus({ error: error.message }));
}
async function desktopCommand(command) {
  try {
    if (command.type === 'theme') { applyTheme(command.id); return; }
    if (command.type === 'workspace') { switchWorkspace(command.id); return; }
    finishInlineEdit(true); persist(); await desktopState.pending;
    if (command.type === 'open') { desktopStatus(await desktop.open()); return; }
    if (command.type === 'close') { desktopStatus(await desktop.close()); return; }
    if (command.type === 'undo') { travel('undo'); return; }
    if (command.type === 'redo') { travel('redo'); return; }
    if (command.type === 'export') {
      const result = await desktop.exportFile(activeWorkspaceId);
      desktopStatus(result); if (!result.error && !result.canceled) toast('已导出 .drawai 文件副本');
      return;
    }
    if (command.type === 'save' || command.type === 'save-as') {
      const result = await desktop.save(activeWorkspaceId, command.type === 'save-as');
      desktopStatus(result); if (!result.error && !result.canceled) toast('图表已保存为 .drawai 文件');
    }
  } catch (error) { desktopStatus({ error: error.message || '文件操作失败，请重试。' }); }
}
if (desktop) {
  if (initialFile?.view) restoreWorkspaceView(initialFile.view);
  const actions = document.querySelector('.header-actions');
  for (const [id, text, type] of [['desktop-open', '打开', 'open'], ['desktop-save', '保存', 'save'], ['desktop-save-as', '另存为', 'save-as']]) {
    const button = document.createElement('button'); button.id = id; button.className = 'button ' + (type === 'save' ? 'primary' : 'quiet'); button.textContent = text;
    button.onclick = () => desktopCommand({ type }); actions.insertBefore(button, $('import'));
  }
  desktop.onCommand(desktopCommand);
  // Opening a desktop file always starts from its disk contents, in an isolated session.
  desktopState.pending = desktop.initialize(workspaceCatalog.map(w => ({ id: w.id, payload: desktopPayload(w.id) }))).then(result => {
    desktopState.ready = !result.error; desktopStatus(result);
  }).catch(error => desktopStatus({ error: error.message }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['s', 'o'].includes(event.key.toLowerCase())) {
      event.preventDefault(); desktopCommand({ type: event.key.toLowerCase() === 'o' ? 'open' : event.shiftKey ? 'save-as' : 'save' });
    }
  });
  renderWorkspaces();
}

// AI is a WebView2 desktop feature; web and historical Electron builds stay drawing-only.
if (desktop?.engine === 'webview2') {
  const aiToggle = document.createElement('button');
  aiToggle.id = 'ai-toggle'; aiToggle.className = 'button quiet'; aiToggle.textContent = '✧ AI 做图'; aiToggle.setAttribute('aria-expanded', 'false');
  document.querySelector('.header-actions').insertBefore(aiToggle, $('import'));
  aiPanel = mountAIPanel({
    context: () => ({ id: activeWorkspaceId, name: workspaceCatalog.find(w => w.id === activeWorkspaceId).name }),
    snapshot: () => { finishInlineEdit(true); return { id: activeWorkspaceId, name: workspaceCatalog.find(w => w.id === activeWorkspaceId).name, document: clone(doc) }; },
    apply: (next, base) => {
      finishInlineEdit(true);
      if (activeWorkspaceId !== base.id || JSON.stringify(doc) !== JSON.stringify(base.document)) return false;
      cancelCanvasDrag(); clearPaletteDrag();
      mutate(() => { doc = next; selection = null; inspectorNodeId = null; connectSource = null; camera.zoom = 1; camera.panX = 0; camera.panY = 0; }, { refit: true });
      return true;
    },
    openWorkspace: next => {
      if (workspaceCatalog.length >= 50) { toast('工作空间数量已达上限。'); return false; }
      const id = uid('workspace'); workspaceCatalog.push({ id, name: 'AI 生成结果' });
      workspaceSessions.set(id, { doc: clone(next), history: new History(), view: { mode: 'flat' } });
      switchWorkspace(id); return true;
    },
    undo: () => $('undo').click(), resize: () => { finishInlineEdit(true); requestAnimationFrame(viewBox); }, notify: toast,
    transport: desktop?.aiRequest ? { request: request => desktop.aiRequest(request), cancel: id => desktop.aiCancel(id) } : null,
    logs: desktop?.aiLogs ? { browse: (action, name) => desktop.aiLogs(action, name), result: value => desktop.aiLogResult(value) } : null,
  });
} else {
  $('ai-panel').remove();
}
