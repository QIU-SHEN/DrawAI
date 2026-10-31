export const STORAGE_KEY = globalThis.drawaiDesktop?.initial?.storageKey || globalThis.__DRAWAI_WV_BOOTSTRAP__?.storageKey || globalThis.__DRAWAI_FILE__?.storageKey || 'drawai.document.v1';
export const statuses = ['待检查', '通过', '不通过', '需复核'];
// Shared .drawai envelope for browser exports and both desktop hosts.
export function validateDiagramFile(value) {
  if (!value || value.format !== 'drawai' || value.version !== 1) throw new Error('这不是支持的 DrawAI 图表文件。');
  if (typeof value.workspaceName !== 'string' || !value.workspaceName.trim() || value.workspaceName.length > 60) throw new Error('图表名称无效。');
  const document = validateDocument(value.document);
  const v = value.view || {}, view = { mode: v.mode === 'flat' ? 'flat' : 'spatial', showRelations: v.showRelations !== false };
  if (document.layers.some(l => l.id === v.activeLayerId)) view.activeLayerId = v.activeLayerId;
  for (const [key, min, max] of [['tilt', 0, 360], ['yaw', -180, 180], ['gap', 250, 1000]]) if (Number.isFinite(v[key])) view[key] = Math.max(min, Math.min(max, v[key]));
  return { format: 'drawai', version: 1, workspaceName: value.workspaceName.trim(), document, view };
}
export const kinds = { shape: '普通图形', agent: 'Agent', input: '输入', decision: '判断', result: '结果' };
export const shapes = { rounded: '圆角矩形', rectangle: '矩形', diamond: '菱形', ellipse: '椭圆', parallelogram: '平行四边形', triangle: '三角形', trapezoid: '梯形', pentagon: '五边形', hexagon: '六边形', octagon: '八边形', chevron: '燕尾形', cylinder: '圆柱体', actor: '人形', text: '文本' };
export const defaultShape = kind => ({ shape: 'rounded', agent: 'rounded', input: 'rectangle', decision: 'diamond', result: 'ellipse' }[kind]);
export const defaultLayers = () => [{ id: 'flow', name: '业务流程' }, { id: 'data', name: '共享数据' }];
export const clone = value => structuredClone(value);
export const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 10)}`;
export const validPort = port => ['n', 'e', 's', 'w'].includes(port) || (!!port && typeof port === 'object' && !Array.isArray(port) && Number.isFinite(port.x) && Number.isFinite(port.y) && Math.abs(port.x) <= 1 && Math.abs(port.y) <= 1);
const copyPort = port => typeof port === 'string' ? port : { x: port.x, y: port.y };
// Legacy endpoint is accepted only during v1/v2 migration.
export const TABLE_ID = '@shared-table';
export function createTable(layerId, x = -360, y = -140) {
  return { id: uid('table'), layerId, x, y, width: 720, height: 280, title: '表格', columns: ['', '', ''], cells: Array.from({ length: 3 }, () => ['', '', '']) };
}
export function tableObject(doc, id) {
  const table = doc.tables.find(t => t.id === id);
  return table ? { ...table, kind: 'table', shape: 'rectangle', description: '', x: table.x + table.width / 2, y: table.y + table.height / 2 } : null;
}
export const getDiagramObject = (doc, id) => doc.nodes.find(n => n.id === id) || tableObject(doc, id);
export function updateDiagramObject(doc, id, patch) {
  const object = getDiagramObject(doc, id);
  if (!object) return;
  if (object.kind !== 'table') { Object.assign(object, patch); return; }
  Object.assign(object, patch);
  Object.assign(doc.tables.find(t => t.id === id), { x: Math.max(-10000, Math.min(10000, object.x - object.width / 2)), y: Math.max(-10000, Math.min(10000, object.y - object.height / 2)), layerId: object.layerId, width: object.width, height: object.height });
}

export function blankDocument() {
  return { version: 3, layers: [{ id: 'flow', name: '图层 1' }], nodes: [], tables: [], edges: [] };
}

export function removeNode(doc, id) {
  doc.nodes = doc.nodes.filter(n => n.id !== id);
  doc.edges = doc.edges.filter(e => e.source !== id && e.target !== id);
  doc.tables = doc.tables.filter(t => t.id !== id);
}

export function removeLayer(doc, id) {
  if (doc.layers.length <= 1 || !doc.layers.some(layer => layer.id === id)) return false;
  doc.nodes.filter(n => n.layerId === id).forEach(n => removeNode(doc, n.id));
  doc.tables.filter(t => t.layerId === id).forEach(t => removeNode(doc, t.id));
  doc.layers = doc.layers.filter(layer => layer.id !== id);
  return true;
}

export function addEdge(doc, source, target, sourcePort, targetPort) {
  if (doc.edges.length >= 1000) return false;
  if (source === target || !getDiagramObject(doc, source) || !getDiagramObject(doc, target)) return false;
  if (doc.edges.some(e => e.source === source && e.target === target && e.style !== 'dashed')) return false;
  if ((sourcePort !== undefined && !validPort(sourcePort)) || (targetPort !== undefined && !validPort(targetPort))) return false;
  doc.edges.push({ id: uid('edge'), source, target, label: '', ...(sourcePort ? { sourcePort: copyPort(sourcePort) } : {}), ...(targetPort ? { targetPort: copyPort(targetPort) } : {}) });
  return true;
}

function validateLegacy(value) {
  const fail = () => { throw new Error('文件格式不正确：请导入由 DrawAI 导出的 JSON。'); };
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.rows)) fail();
  if (value.version === 1) value = { ...value, version: 2, layers: defaultLayers(), table: { layerId: 'data', x: -610, y: -100 }, nodes: value.nodes.map(n => ({ ...n, layerId: 'flow', shape: defaultShape(n?.kind) })) };
  if (value.nodes.length > 200 || value.edges.length > 1000 || value.rows.length > 500) throw new Error('原型最多支持 200 个节点、1000 条连线和 500 条检查项。');
  const str = (s, max) => typeof s === 'string' && s.length <= max;
  const idOk = id => str(id, 80) && /^[\w-]+$/.test(id);
  const coordinate = n => Number.isFinite(n) && Math.abs(n) <= 10000;
  if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 20) fail();
  const layerIds = new Set();
  for (const layer of value.layers) {
    if (!layer || !idOk(layer.id) || layerIds.has(layer.id) || !str(layer.name, 60) || !layer.name.trim()) fail();
    layerIds.add(layer.id);
  }
  if (value.table !== null && (!value.table || !layerIds.has(value.table.layerId) || !coordinate(value.table.x) || !coordinate(value.table.y))) fail();
  if (value.table === null && value.rows.length) fail();
  if (value.table) for (const key of ['width', 'height']) if (value.table[key] !== undefined && (!Number.isFinite(value.table[key]) || value.table[key] < (key === 'width' ? 240 : 100) || value.table[key] > 4000)) fail();
  const ids = new Set();
  for (const n of value.nodes) {
    if (!n || !idOk(n.id) || ids.has(n.id) || !Object.hasOwn(kinds, n.kind) || !Object.hasOwn(shapes, n.shape) || !layerIds.has(n.layerId) || !str(n.title, 60) || !n.title.trim() || !str(n.description, 240) || !coordinate(n.x) || !coordinate(n.y)) fail();
    ids.add(n.id);
    if (n.relationLabel !== undefined && !str(n.relationLabel, 60)) fail();
    for (const key of ['width', 'height']) if (n[key] !== undefined && (!Number.isFinite(n[key]) || n[key] < (key === 'width' ? 80 : 60) || n[key] > 2400)) fail();
  }
  if (value.table) ids.add(TABLE_ID);
  const edgeIds = new Set();
  const pairs = new Set();
  for (const e of value.edges) {
    const pair = `${e?.source}:${e?.target}`;
    if (!e || !idOk(e.id) || edgeIds.has(e.id) || !ids.has(e.source) || !ids.has(e.target) || e.source === e.target || pairs.has(pair) || !str(e.label, 60)) fail();
    edgeIds.add(e.id); pairs.add(pair);
    for (const key of ['sourcePort', 'targetPort']) if (e[key] !== undefined && !['n', 'e', 's', 'w'].includes(e[key])) fail();
  }
  const rowIds = new Set();
  for (const r of value.rows) {
    if (!r || !idOk(r.id) || rowIds.has(r.id) || !str(r.item, 100) || !statuses.includes(r.status) || !str(r.note, 500) || !Array.isArray(r.agentIds) || new Set(r.agentIds).size !== r.agentIds.length || !r.agentIds.every(id => value.nodes.some(n => n.id === id && n.kind === 'agent'))) fail();
    rowIds.add(r.id);
  }
  // Only retain known fields, never execute or interpolate imported markup.
  return { version: 2, layers: value.layers.map(({ id, name }) => ({ id, name })), table: value.table ? { layerId: value.table.layerId, x: value.table.x, y: value.table.y, ...(value.table.width !== undefined ? { width: value.table.width } : {}), ...(value.table.height !== undefined ? { height: value.table.height } : {}) } : null, nodes: value.nodes.map(({ id, kind, shape, layerId, title, description, x, y, width, height, relationLabel }) => ({ id, kind, shape, layerId, title, description, x, y, ...(relationLabel !== undefined ? { relationLabel } : {}), ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) })), edges: value.edges.map(({ id, source, target, label, sourcePort, targetPort }) => ({ id, source, target, label, ...(sourcePort ? { sourcePort } : {}), ...(targetPort ? { targetPort } : {}) })), rows: value.rows.map(({ id, item, status, agentIds, note }) => ({ id, item, status, agentIds: [...agentIds], note })) };
}

function migrateLegacy(value) {
  const tableIdBase = 'table-shared';
  let tableId = tableIdBase, suffix = 0;
  while (value.nodes.some(n => n.id === tableId)) tableId = tableIdBase + '-' + (++suffix);
  const tables = value.table ? [{ id: tableId, ...value.table, width: value.table.width ?? 1220, height: value.table.height ?? 305, title: '共享检查表', columns: ['检查项', '结果', '关联 Agent', '备注'], cells: value.rows.map(r => [r.item, r.status, r.agentIds.map(id => value.nodes.find(n => n.id === id).title).join(' · '), r.note]) }] : [];
  const edges = value.edges.map(e => ({ ...e, source: e.source === TABLE_ID ? tableId : e.source, target: e.target === TABLE_ID ? tableId : e.target }));
  if (tables.length) for (const id of new Set(value.rows.flatMap(r => r.agentIds))) {
    let edgeId = 'relation-' + id.slice(0, 60), i = 0;
    while (edges.some(e => e.id === edgeId)) edgeId = 'relation-' + id.slice(0, 60) + '-' + (++i);
    // Keep old flow arrows and old shared relations as separate, editable edges.
    edges.push({ id: edgeId, source: id, target: tableId, label: value.nodes.find(n => n.id === id).relationLabel ?? '读取 / 回写', style: 'dashed' });
  }
  return { version: 3, layers: value.layers, nodes: value.nodes.map(({ relationLabel, ...n }) => n), tables, edges };
}

export function validateDocument(value) {
  if (value?.version === 1 || value?.version === 2) return validateDocument(migrateLegacy(validateLegacy(value)));
  const fail = () => { throw new Error('文件格式不正确：请导入由 DrawAI 导出的 JSON。'); };
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  const idOk = v => str(v, 80) && /^[\w-]+$/.test(v);
  const coordinate = v => Number.isFinite(v) && Math.abs(v) <= 10000;
  const size = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  if (!value || value.version !== 3 || !Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 20 || !Array.isArray(value.nodes) || value.nodes.length > 200 || !Array.isArray(value.tables) || value.tables.length > 50 || !Array.isArray(value.edges) || value.edges.length > 1200) fail();
  const layers = new Set(), ids = new Set(), edgeIds = new Set();
  for (const l of value.layers) {
    if (!l || !idOk(l.id) || layers.has(l.id) || !str(l.name, 60) || !l.name.trim()) fail();
    layers.add(l.id);
  }
  for (const n of value.nodes) {
    if (!n || !idOk(n.id) || ids.has(n.id) || !Object.hasOwn(kinds, n.kind) || !Object.hasOwn(shapes, n.shape) || !layers.has(n.layerId) || !str(n.title, 60) || !n.title.trim() || !str(n.description, 240) || !coordinate(n.x) || !coordinate(n.y)) fail();
    for (const k of ['width', 'height']) if (n[k] !== undefined && !size(n[k], k === 'width' ? 80 : 60, 2400)) fail();
    ids.add(n.id);
  }
  let cellCount = 0;
  for (const t of value.tables) {
    if (!t || !idOk(t.id) || ids.has(t.id) || !layers.has(t.layerId) || !coordinate(t.x) || !coordinate(t.y) || !size(t.width, 240, 4000) || !size(t.height, 100, 4000) || !str(t.title, 100) || !Array.isArray(t.columns) || !t.columns.length || t.columns.length > 20 || !t.columns.every(c => str(c, 100)) || !Array.isArray(t.cells) || t.cells.length > 500 || !t.cells.every(row => Array.isArray(row) && row.length === t.columns.length && row.every(c => str(c, 1000)))) fail();
    cellCount += t.columns.length * t.cells.length;
    if (cellCount > 10000) fail();
    ids.add(t.id);
  }
  const pairs = new Set();
  for (const e of value.edges) {
    const pair = JSON.stringify([e?.source, e?.target, e?.style ?? 'solid']);
    if (!e || !idOk(e.id) || edgeIds.has(e.id) || !ids.has(e.source) || !ids.has(e.target) || e.source === e.target || pairs.has(pair) || !str(e.label, 60) || (e.style !== undefined && !['solid', 'dashed'].includes(e.style))) fail();
    for (const k of ['sourcePort', 'targetPort']) if (e[k] !== undefined && !validPort(e[k])) fail();
    edgeIds.add(e.id); pairs.add(pair);
  }
  return { version: 3, layers: value.layers.map(({ id, name }) => ({ id, name })), nodes: value.nodes.map(({ id, kind, shape, layerId, title, description, x, y, width, height }) => ({ id, kind, shape, layerId, title, description, x, y, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) })), tables: value.tables.map(({ id, layerId, x, y, width, height, title, columns, cells }) => ({ id, layerId, x, y, width, height, title, columns: [...columns], cells: cells.map(row => [...row]) })), edges: value.edges.map(({ id, source, target, label, sourcePort, targetPort, style }) => ({ id, source, target, label, ...(sourcePort ? { sourcePort: copyPort(sourcePort) } : {}), ...(targetPort ? { targetPort: copyPort(targetPort) } : {}), ...(style ? { style } : {}) })) };
}

export class History {
  constructor() { this.past = []; this.future = []; }
  push(doc) { this.past.push(clone(doc)); if (this.past.length > 80) this.past.shift(); this.future = []; }
  undo(doc) { if (!this.past.length) return doc; this.future.push(clone(doc)); return this.past.pop(); }
  redo(doc) { if (!this.future.length) return doc; this.past.push(clone(doc)); return this.future.pop(); }
}
