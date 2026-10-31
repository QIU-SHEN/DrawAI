import { tableObject } from './model.js';
export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esc = escapeHtml;
const radians = n => n * Math.PI / 180;
export const wrapAngle = angle => ((angle % 360) + 360) % 360;
export const canEditPlane = (camera, z = 0) => camera.mode === 'flat' || Math.abs(Math.cos(radians(camera.tilt)) - z / eyeDistance(camera)) > 1e-6;
const eyeDistance = camera => camera.distance || 2600;
export function project(x, y, z, camera) {
  if (camera.mode === 'flat') return { x, y };
  const yaw = radians(camera.yaw), tilt = radians(camera.tilt);
  const u = x * Math.cos(yaw) - y * Math.sin(yaw), v = x * Math.sin(yaw) + y * Math.cos(yaw);
  const w = 1 - (v * Math.sin(tilt) + z * Math.cos(tilt)) / eyeDistance(camera);
  return { x: u / w, y: (v * Math.cos(tilt) - z * Math.sin(tilt)) / w };
}
export function unprojectDelta(dx, dy, camera, start = { x: 0, y: 0 }, z = 0) {
  const a = unprojectPoint(start.x, start.y, z, camera), b = unprojectPoint(start.x + dx, start.y + dy, z, camera);
  return { x: b.x - a.x, y: b.y - a.y };
}
export function unprojectPoint(x, y, z, camera) {
  if (camera.mode === 'flat') return { x, y };
  const yaw = radians(camera.yaw), tilt = radians(camera.tilt), c = Math.cos(tilt), s = Math.sin(tilt), d = eyeDistance(camera);
  // A plane through the eye, or a ray parallel to it, has no unique inverse.
  const denominator = c + y * s / d;
  const v = Math.abs(c - z / d) < 1e-6 || Math.abs(denominator) < 1e-6 ? 0 : (y * (1 - z * c / d) + z * s) / denominator;
  const u = x * (1 - (v * s + z * c) / d);
  return { x: u * Math.cos(yaw) + v * Math.sin(yaw), y: -u * Math.sin(yaw) + v * Math.cos(yaw) };
}
export const layerZ = (doc, id, camera) => ((doc.layers.length - 1) / 2 - doc.layers.findIndex(layer => layer.id === id)) * camera.gap;
export function planeMatrix(z, camera) {
  if (camera.mode === 'flat') return 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)';
  const yaw = radians(camera.yaw), tilt = radians(camera.tilt);
  const a = Math.cos(yaw), b = Math.sin(yaw), c = Math.cos(tilt), s = Math.sin(tilt), d = eyeDistance(camera);
  return 'matrix3d(' + [a,b*c,0,-b*s/d, -b,a*c,0,-a*s/d, 0,0,1,0, 0,-z*s,0,1-z*c/d].join(',') + ')';
}
// SVG <g> transforms are affine. A tiny HTML viewport applies the full projective
// transform to an inner SVG, including its text, controls and inline editors.
export function planeMarkup(content, z, camera, attributes = '') {
  if (camera.mode === 'flat') return '<g ' + attributes + '>' + content + '</g>';
  const matrix = planeMatrix(z, camera);
  return '<foreignObject ' + attributes + ' width="1" height="1" style="overflow:visible"><div xmlns="http://www.w3.org/1999/xhtml" style="width:1px;height:1px;transform-origin:0 0;transform:' + matrix + '"><svg xmlns="http://www.w3.org/2000/svg" data-projection="' + matrix.slice(9, -1) + '" style="width:1px;height:1px;overflow:visible">' + content + '</svg></div></foreignObject>';
}
export function elementScreenPoint(element, point) {
  const plane = element.closest('svg[data-projection]') || element.querySelector('svg[data-projection]');
  if (!plane) return new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM());
  // getScreenCTM flattens CSS perspective to an affine matrix. Keep only the
  // local SVG transform, then explicitly divide by homogeneous w.
  const local = plane.contains(element) ? element : plane;
  const p = new DOMPoint(point.x, point.y).matrixTransform(local.getCTM()), m = plane.dataset.projection.split(',').map(Number);
  const w = m[3] * p.x + m[7] * p.y + m[15];
  return new DOMPoint((m[0] * p.x + m[4] * p.y + m[12]) / w, (m[1] * p.x + m[5] * p.y + m[13]) / w).matrixTransform(plane.closest('foreignObject').ownerSVGElement.getScreenCTM());
}
export function perspectiveDistance(doc, camera) {
  // Keep the eye outside the whole document at every rotation, including large
  // imported diagrams. Distance stays fixed during a drag until the next refit.
  const radius = Math.max(...doc.layers.map(layer => {
    const b = layerBounds(doc, layer.id), z = layerZ(doc, layer.id, camera);
    return Math.hypot(Math.max(Math.abs(b.left), Math.abs(b.right)), Math.max(Math.abs(b.top), Math.abs(b.bottom)), z);
  }));
  return Math.max(2600, radius * 2.5);
}
function wrap(text, limit = 17, maxLines = 2) {
  const lines = ['']; let width = 0;
  for (const c of text) {
    if (c === '\r') continue;
    if (c === '\n') {
      if (lines.length === maxLines) { lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…'; break; }
      lines.push(''); width = 0; continue;
    }
    const w = /[\u0000-\u00ff]/.test(c) ? 0.55 : 1;
    if (width + w > limit) {
      if (lines.length === maxLines) { lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…'; break; }
      lines.push(''); width = 0;
    }
    lines[lines.length - 1] += c; width += w;
  }
  return lines;
}
const pt = p => p.x.toFixed(2) + ',' + p.y.toFixed(2);
const rawNodeSize = n => ({ w: (n.width ?? (n.shape === 'actor' ? 100 : n.shape === 'cylinder' ? 180 : n.shape === 'diamond' ? 260 : n.shape === 'ellipse' ? 210 : 200)) / 2, h: (n.height ?? (['actor', 'cylinder', 'diamond'].includes(n.shape) ? 180 : n.shape === 'ellipse' ? 140 : 112)) / 2 });
const textLayoutCache = new WeakMap();
let textContext;
function fullTextLines(text, width, bold) {
  if (!textContext && typeof document !== 'undefined') textContext = document.createElement('canvas').getContext('2d');
  if (textContext) textContext.font = (bold ? '650' : '400') + ' 23px "Segoe UI", "Microsoft YaHei", sans-serif';
  const lines = ['']; let used = 0;
  const chars = [...String(text || '').replace(/\r/g, '')];
  const measure = char => textContext ? textContext.measureText(char).width : (/[\u0000-\u00ff]/.test(char) ? 15 : 23);
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char === '\n') { lines.push(''); used = 0; continue; }
    const size = measure(char);
    const next = chars[index + 1], trailing = next && /[，。！？；：、）》】”’,.!?;:]/.test(next) ? measure(next) : 0;
    if (used + size + trailing > width && lines.at(-1)) { lines.push(''); used = 0; }
    lines[lines.length - 1] += char; used += size;
  }
  return lines;
}
// Reserve an inscribed text rectangle, so labels also fit slanted/curved shapes.
export function nodeTextLayout(n) {
  const base = rawNodeSize(n);
  const key = JSON.stringify([n.shape,n.title,n.description,base.w,base.h]);
  const cached = textLayoutCache.get(n); if (cached?.key === key) return cached.layout;
  const [fx, fy, offset = 0] = ({diamond:[.5,.5],ellipse:[.7,.7],triangle:[.42,.42,.17],parallelogram:[.72,.9],trapezoid:[.58,.85],pentagon:[.6,.6,.07],hexagon:[.55,.85],octagon:[.7,.8],chevron:[.4,.8],cylinder:[.85,.5]}[n.shape] || [.94,.92]);
  let width = base.w * 2, height = base.h * 2, title, description, textHeight;
  const calculate = () => {
    const available = Math.max(24, width * fx - 24);
    title = fullTextLines(n.title, available, true);
    description = n.description ? fullTextLines(n.description, available, false) : [];
    textHeight = (title.length + description.length) * 30 + (description.length ? 8 : 0);
  };
  calculate();
  while (n.shape !== 'actor' && (textHeight + 24) / fy > 2400 && width < 2400) { width = Math.min(2400, Math.ceil(width * 1.25)); calculate(); }
  if (n.shape !== 'actor') height = Math.max(height, Math.min(2400, Math.ceil((textHeight + 24) / fy)));
  // Only pathological newline-heavy text can exceed the document's size limit.
  const scale = n.shape === 'actor' ? 1 : Math.min(1, Math.max(1, height * fy - 24) / textHeight);
  const layout = { width, height, title, description, textHeight, scale, offset: offset * height };
  textLayoutCache.set(n, {key,layout}); return layout;
}
export const nodeSize = rawNodeSize;
export function fitNodeText(n) {
  if (n.kind === 'table') return;
  const size = rawNodeSize(n), layout = nodeTextLayout(n);
  if (layout.width > size.w * 2) n.width = layout.width;
  if (layout.height > size.h * 2) n.height = layout.height;
}
export const portVector = port => ({ n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } }[port]);
export function shapePolygon(node) {
  const { w, h } = nodeSize(node);
  const vertices = {
    diamond: [[0,-1],[1,0],[0,1],[-1,0]],
    parallelogram: [[-.75,-1],[1,-1],[.75,1],[-1,1]],
    triangle: [[0,-1],[1,1],[-1,1]],
    trapezoid: [[-.6,-1],[.6,-1],[1,1],[-1,1]],
    pentagon: [[0,-1],[1,-.25],[.62,1],[-.62,1],[-1,-.25]],
    hexagon: [[-.55,-1],[.55,-1],[1,0],[.55,1],[-.55,1],[-1,0]],
    octagon: [[-.55,-1],[.55,-1],[1,-.55],[1,.55],[.55,1],[-.55,1],[-1,.55],[-1,-.55]],
    chevron: [[-1,-1],[.45,-1],[1,0],[.45,1],[-1,1],[-.45,0]],
  }[node.shape];
  return vertices?.map(([x,y]) => ({ x: x*w, y: y*h })) || null;
}
export function portPoint(node, port) {
  if (typeof port === 'object') {
    const { w, h } = nodeSize(node);
    return perimeterPoint(node, { x: node.x + port.x * w, y: node.y + port.y * h });
  }
  const { w, h } = nodeSize(node), v = portVector(port);
  if (node.shape === 'parallelogram') return { x: node.x + (v.x ? v.x * w * .875 : -v.y * w * .125), y: node.y + v.y * h };
  if (shapePolygon(node)) return perimeterPoint(node, { x: node.x + v.x * w, y: node.y + v.y * h });
  return { x: node.x + v.x * w * (node.shape === 'parallelogram' ? .875 : 1), y: node.y + v.y * h };
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
// Resolve on the actual outline, including curved corners, rather than the bounding box.
export function perimeterPoint(node, point) {
  const { w, h } = nodeSize(node), x = point.x - node.x, y = point.y - node.y;
  if (node.shape === 'ellipse') {
    const angle = x || y ? Math.atan2(y / h, x / w) : -Math.PI / 2;
    return { x: node.x + w * Math.cos(angle), y: node.y + h * Math.sin(angle) };
  }
  const candidates = [];
  const segment = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? clamp(((x - a.x) * dx + (y - a.y) * dy) / length, 0, 1) : 0;
    candidates.push({ x: a.x + t * dx, y: a.y + t * dy });
  };
  const polygon = vertices => vertices.forEach((p, i) => segment(p, vertices[(i + 1) % vertices.length]));
  const vertices = shapePolygon(node);
  if (node.shape === 'cylinder') {
    const rim = h * .26;
    segment({ x: -w, y: -h + rim }, { x: -w, y: h - rim });
    segment({ x: w, y: -h + rim }, { x: w, y: h - rim });
    for (const side of [-1, 1]) {
      const cy = side * (h - rim), angle = Math.atan2((y - cy) / rim, x / w);
      for (const t of [side < 0 ? clamp(angle, -Math.PI, 0) : clamp(angle, 0, Math.PI), 0, side * Math.PI]) candidates.push({ x: w * Math.cos(t), y: cy + rim * Math.sin(t) });
    }
  } else if (vertices) polygon(vertices);
  else {
    const r = Math.min(w, h, node.shape === 'actor' ? 0 : node.kind === 'table' ? 8 : node.shape === 'rounded' ? 15 : node.shape === 'text' ? 3 : 2);
    segment({ x: -w + r, y: -h }, { x: w - r, y: -h });
    segment({ x: w, y: -h + r }, { x: w, y: h - r });
    segment({ x: w - r, y: h }, { x: -w + r, y: h });
    segment({ x: -w, y: h - r }, { x: -w, y: -h + r });
    [[w - r, h - r, 0], [-w + r, h - r, Math.PI / 2], [-w + r, -h + r, Math.PI], [w - r, -h + r, Math.PI * 1.5]].forEach(([cx, cy, begin]) => {
      const angle = (Math.atan2(y - cy, x - cx) + Math.PI * 2) % (Math.PI * 2);
      for (const t of [begin, begin + Math.PI / 2, clamp(angle, begin, begin + Math.PI / 2)]) candidates.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    });
  }
  const best = candidates.reduce((a, b) => Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b);
  return { x: node.x + best.x, y: node.y + best.y };
}
export function freePort(node, point) {
  const p = perimeterPoint(node, point), { w, h } = nodeSize(node);
  return { x: clamp((p.x - node.x) / w, -1, 1), y: clamp((p.y - node.y) / h, -1, 1) };
}
function portDirection(node, port) {
  if (typeof port === 'string') return portVector(port);
  const p = portPoint(node, port), { w, h } = nodeSize(node), x = (p.x - node.x) / w, y = (p.y - node.y) / h;
  if (Math.abs(x) > .99999) return { x: Math.sign(x), y: 0 };
  if (Math.abs(y) > .99999) return { x: 0, y: Math.sign(y) };
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}
function projectedFreeCurve(e, a, b, start, end, camera, doc) {
  const za = layerZ(doc, a.layerId, camera), zb = layerZ(doc, b.layerId, camera);
  const p = project(start.x, start.y, za, camera), q = project(end.x, end.y, zb, camera);
  const sv = portDirection(a, e.sourcePort || 's'), tv = portDirection(b, e.targetPort || 'n');
  const bend = Math.max(90, Math.min(300, Math.hypot(p.x - q.x, p.y - q.y) * .4));
  const c1 = project(start.x + sv.x * bend, start.y + sv.y * bend, za, camera);
  const c2 = project(end.x + tv.x * bend, end.y + tv.y * bend, zb, camera);
  return { d: `M${pt(p)} C${pt(c1)} ${pt(c2)} ${pt(q)}`, label: { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 } };
}
export function nearestPort(node, point) {
  return ['n', 'e', 's', 'w'].sort((a, b) => {
    const p = portPoint(node, a), q = portPoint(node, b);
    return Math.hypot(p.x - point.x, p.y - point.y) - Math.hypot(q.x - point.x, q.y - point.y);
  })[0];
}

export function layerBounds(doc, id) {
  const nodes = doc.nodes.filter(n => n.layerId === id);
  const tables = doc.tables.filter(t => t.layerId === id);
  return {
    left: Math.min(-820, ...nodes.map(n => n.x - nodeSize(n).w - 55), ...tables.map(t => t.x - 100)),
    right: Math.max(820, ...nodes.map(n => n.x + nodeSize(n).w + 55), ...tables.map(t => t.x + t.width + 100)),
    top: Math.min(tables.length && !nodes.length ? -260 : -400, ...nodes.map(n => n.y - nodeSize(n).h - 65), ...tables.map(t => t.y - 100)),
    bottom: Math.max(tables.length && !nodes.length ? 340 : 425, ...nodes.map(n => n.y + nodeSize(n).h + (n.shape === 'actor' ? nodeTextLayout(n).textHeight + 50 : 65)), ...tables.map(t => t.y + t.height + 80)),
  };
}
function plane(doc, layer, index, active) {
  const { left, right, top, bottom } = layerBounds(doc, layer.id);
  let grid = '';
  const step = Math.max(80, Math.ceil(Math.max(right - left, bottom - top) / 6400) * 80);
  for (let x = Math.ceil(left / step) * step; x < right; x += step) grid += '<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + bottom + '"/>';
  for (let y = Math.ceil(top / step) * step; y < bottom; y += step) grid += '<line x1="' + left + '" y1="' + y + '" x2="' + right + '" y2="' + y + '"/>';
  return '<g class="plane ' + (doc.tables.some(t => t.layerId === layer.id) ? 'data-plane' : 'flow-plane') + (active ? ' active-plane' : '') + '" data-plane-layer="' + esc(layer.id) + '"><rect class="plane-shadow" x="' + (left + 7) + '" y="' + (top + 12) + '" width="' + (right - left) + '" height="' + (bottom - top) + '" rx="14"/><rect class="plane-surface" x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '" rx="14"/><g class="plane-grid">' + grid + '</g><text class="plane-label" x="' + (left + 28) + '" y="' + (top + 44) + '">' + String(index + 1).padStart(2, '0') + '  ' + esc(wrap(layer.name, 12, 1)[0]) + '</text><text class="plane-caption" x="' + (right - 190) + '" y="' + (top + 44) + '">' + (active ? '当前编辑层' : '点击左侧切换图层') + '</text></g>';
}
function diagramControls(w, h, selected) {
  const handles = selected ? `<g class="resize-controls"><rect class="selection-outline" x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}"/>` + [['nw', -w, -h], ['n', 0, -h], ['ne', w, -h], ['e', w, 0], ['se', w, h], ['s', 0, h], ['sw', -w, h], ['w', -w, 0]].map(([dir, x, y]) => `<circle class="resize-handle" data-resize="${dir}" cx="${x}" cy="${y}" r="9"><title>拖动调整大小</title></circle>`).join('') + '</g>' : '';
  const ports = '<g class="connection-controls">' + ['n', 'e', 's', 'w'].map(port => {
    const v = portVector(port), angle = { e: 0, s: 90, w: 180, n: -90 }[port];
    return `<g class="connection-port" data-port="${port}" transform="translate(${v.x * (w + 37)},${v.y * (h + 37)}) rotate(${angle})"><title>拖向另一图形建立箭头</title><rect x="-24" y="-22" width="48" height="44" fill="transparent"/><path d="M-10 -3H1V-8L12 0L1 8V3H-10Z"/></g>`;
  }).join('') + '</g>';
  return handles + ports;
}
function nodeMarkup(n, selected, active, linked, connecting) {
  const { w, h } = nodeSize(n);
  const variant = n.kind === 'result' ? n.title.startsWith('✓') ? 'success' : n.title.startsWith('×') ? 'warning' : 'neutral' : n.kind;
  const vertices = shapePolygon(n);
  const rim = h * .26;
  const back = {
    rounded: `<rect class="node-back" x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}" rx="15"/>`,
    rectangle: `<rect class="node-back" x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}" rx="2"/>`,
    diamond: `<path class="node-back" d="M0 ${-h}L${w} 0L0 ${h}L${-w} 0Z"/>`,
    ellipse: `<ellipse class="node-back" rx="${w}" ry="${h}"/>`,
    cylinder: `<path class="node-back" d="M${-w} ${-h + rim}A${w} ${rim} 0 0 1 ${w} ${-h + rim}V${h - rim}A${w} ${rim} 0 0 1 ${-w} ${h - rim}Z"/>`,
    actor: `<rect class="node-back actor-hit" x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}" style="fill:transparent;stroke:none;filter:none"/>`,
    parallelogram: `<path class="node-back" d="M${-w * .75} ${-h}H${w}L${w * .75} ${h}H${-w}Z"/>`,
    text: `<rect class="node-back text-back" x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}" rx="3"/>`,
  }[n.shape] || (vertices ? `<path class="node-back" d="M${vertices.map(pt).join('L')}Z"/>` : '');
  const detail = n.shape === 'cylinder' ? `<path class="node-back" style="fill:none;filter:none;pointer-events:none" d="M${-w} ${-h + rim}A${w} ${rim} 0 0 0 ${w} ${-h + rim}"/>`
    : n.shape === 'actor' ? `<ellipse class="node-back" style="filter:none;pointer-events:none" cx="0" cy="${-.8 * h}" rx="${.36 * w}" ry="${.2 * h}"/><path class="node-back" style="fill:none;filter:none;pointer-events:none" d="M0 ${-.6 * h}V${.35 * h}M${-w} ${-.35 * h}H${w}M${-w} ${h}L0 ${.35 * h}L${w} ${h}"/>` : '';
  const layout = nodeTextLayout(n);
  const lineMarkup = (lines, y, cls) => '<text class="' + cls + ' centered" x="0" y="' + y + '" xml:space="preserve">' + lines.map((line,i) => '<tspan x="0" dy="' + (i ? 30 : 0) + '">' + esc(line) + '</tspan>').join('') + '</text>';
  const top = -layout.textHeight / 2 + 23;
  const content = lineMarkup(layout.title, top, 'node-title') + (layout.description.length ? lineMarkup(layout.description, top + layout.title.length * 30 + 8, 'node-description') : '');
  const textTransform = 'translate(0,' + (n.shape === 'actor' ? h + 24 + layout.textHeight / 2 : layout.offset) + ') scale(' + layout.scale + ')';
  const boundary = n.shape === 'actor' ? `<rect class="connection-boundary" data-free-port="true" x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}"/>` : back.replace(/class="[^"]*"/, 'class="connection-boundary" data-free-port="true"');
  return '<g transform="translate(' + n.x + ',' + n.y + ')" class="diagram-node ' + variant + (selected ? ' selected' : '') + (active ? '' : ' dimmed') + (connecting ? ' connecting' : '') + '" data-node="' + esc(n.id) + '" data-object="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(n.title) + '，' + esc(n.description) + '"><title>' + esc(n.title) + '：' + esc(n.description) + '。内部拖动移动，边缘拖出连线，双击编辑。</title>' + back + detail + boundary + `<g class="node-text" transform="${textTransform}">` + content + '</g>' + (linked ? '<circle class="linked-dot" cx="0" cy="' + h + '" r="5"/>' : '') + diagramControls(w, h, selected) + '</g>';
}
function edgeMarkup(e, a, b, d, label, selected, active, transform = '') {
  const dashed = e.style === 'dashed';
  return '<g class="flow-edge ' + (dashed ? 'data-link ' : '') + (selected ? 'selected ' : '') + (active ? '' : 'dimmed') + '" data-edge="' + esc(e.id) + '" data-label-x="' + label.x + '" data-label-y="' + label.y + '" data-label-transform="' + transform + '" tabindex="0" role="button" aria-label="连线 ' + esc(a.title) + ' 到 ' + esc(b.title) + '"><title>单击选中 · 双击编辑分支文字 · 右键设置连线 · Delete 删除</title><path class="edge-hit data-link-hit" d="' + d + '"/><path class="edge-line' + (dashed ? ' data-link-line' : '') + '" d="' + d + '" marker-end="url(#' + (dashed ? 'data-arrow' : 'flow-arrow') + ')"' + (e.direction === 'both' ? ' marker-start="url(#' + (dashed ? 'data-arrow' : 'flow-arrow') + ')"' : '') + '/>' + (e.label ? '<text class="edge-label" transform="' + transform + '" x="' + label.x + '" y="' + label.y + '">' + esc(e.label) + '</text>' : '') + '</g>';
}
function localEdge(e, a, b, selected, active) {
  const dx = b.x - a.x, dy = b.y - a.y, sa = nodeSize(a), sb = nodeSize(b);
  let start, end, d, label;
  if (e.sourcePort || e.targetPort) {
    const sp = e.sourcePort || nearestPort(a, b), tp = e.targetPort || nearestPort(b, a);
    start = portPoint(a, sp); end = portPoint(b, tp);
    const sv = portDirection(a, sp), tv = portDirection(b, tp), bend = Math.max(50, Math.hypot(end.x - start.x, end.y - start.y) * .4);
    const c1 = { x: start.x + sv.x * bend, y: start.y + sv.y * bend }, c2 = { x: end.x + tv.x * bend, y: end.y + tv.y * bend };
    d = `M${pt(start)} C${pt(c1)} ${pt(c2)} ${pt(end)}`;
    label = { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 - 16 };
  } else if (Math.abs(dx) >= Math.abs(dy) * .95) {
    const s = Math.sign(dx) || 1;
    start = { x: a.x + sa.w * s, y: a.y }; end = { x: b.x - (sb.w + 4) * s, y: b.y };
    const mid = (start.x + end.x) / 2;
    d = 'M' + pt(start) + ' C' + mid + ',' + start.y + ' ' + mid + ',' + end.y + ' ' + pt(end);
    label = { x: mid, y: (start.y + end.y) / 2 - 16 };
  } else {
    const s = Math.sign(dy) || 1;
    start = { x: a.x, y: a.y + sa.h * s }; end = { x: b.x, y: b.y - (sb.h + 4) * s };
    const mid = (start.y + end.y) / 2;
    d = 'M' + pt(start) + ' C' + start.x + ',' + mid + ' ' + end.x + ',' + mid + ' ' + pt(end);
    label = { x: (start.x + end.x) / 2 + (Math.abs(dx) < 50 ? 68 : 0), y: mid - 14 };
  }
  if (e.routing === 'straight') { d = 'M' + pt(start) + ' L' + pt(end); label = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 16 }; }
  return edgeMarkup(e, a, b, d, label, selected, active);
}
function tableMarkup(table, selected) {
  const { width: w, height: h } = table;
  const header = Math.min(48, h * .22), colHeight = Math.min(38, h * .18);
  const count = Math.min(table.cells.length, Math.max(1, Math.floor((h - header - colHeight - 22) / 28)));
  const rowHeight = (h - header - colHeight - (table.cells.length > count ? 22 : 0)) / Math.max(count, 1);
  const cw = w / table.columns.length, limit = Math.max(1, (cw - 18) / 17);
  let grid = '', content = '';
  table.columns.forEach((column, i) => {
    if (i) grid += `<path class="table-rule" d="M${cw * i} ${header}V${h}"/>`;
    content += `<text class="table-col" x="${cw * i + 10}" y="${header + colHeight * .68}">${esc(wrap(column, limit, 1)[0])}</text>`;
  });
  table.cells.slice(0, count).forEach((row, r) => {
    const y = header + colHeight + r * rowHeight;
    grid += `<path class="table-rule" d="M0 ${y}H${w}"/>`;
    content += row.map((cell, c) => `<text class="table-cell" x="${cw * c + 10}" y="${y + rowHeight * .65}">${esc(wrap(cell, limit, 1)[0])}</text>`).join('');
  });
  return `<g class="shared-table ${selected ? 'selected' : ''}" transform="translate(${table.x},${table.y})" data-table="${esc(table.id)}" data-object="${esc(table.id)}" tabindex="0" role="button" aria-label="表格 ${esc(table.title)}"><title>拖动移动 · 双击编辑标题和内容 · 蓝色手柄缩放 · 四向箭头连线</title><g class="table-content"><rect class="table-body" width="${w}" height="${h}" rx="8"/><rect class="table-header" y="${header}" width="${w}" height="${colHeight}"/><text class="table-title" x="16" y="${header * .68}">${esc(wrap(table.title, Math.max(1, (w - 32) / 22), 1)[0])}</text>${grid}${content}${table.cells.length > count ? `<text class="table-footnote" x="12" y="${h - 7}">显示 ${count} / ${table.cells.length} 行 · 双击编辑全部</text>` : ''}</g><rect class="connection-boundary" data-free-port="true" width="${w}" height="${h}" rx="8"/><g class="table-controls" transform="translate(${w / 2},${h / 2})">${diagramControls(w / 2, h / 2, selected)}</g></g>`;
}
export function renderScene(svg, doc, camera, selection, showRelations, connectSource, activeLayerId) {
  doc.nodes.forEach(fitNodeText);
  const selectedIds = new Set(selection?.type === 'multi' ? selection.ids : ['node', 'table'].includes(selection?.type) ? [selection.id] : []);
  const selectedNode = ['node', 'table'].includes(selection?.type) ? selection.id : null;
  const relatedNodes = new Set([selectedNode]);
  for (const e of doc.edges) if (e.source === selectedNode || e.target === selectedNode) { relatedNodes.add(e.source); relatedNodes.add(e.target); }
  const relatedAgents = new Set(doc.edges.filter(e => e.style === 'dashed').flatMap(e => [e.source, e.target]));
  const visibleLayers = doc.layers.filter(layer => camera.mode !== 'flat' || layer.id === activeLayerId);
  const visibleIds = new Set(visibleLayers.map(layer => layer.id));
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  doc.tables.forEach(t => byId.set(t.id, tableObject(doc, t.id)));
  const visibleEdges = doc.edges.filter(e => (showRelations || e.style !== 'dashed') && visibleIds.has(byId.get(e.source).layerId) && visibleIds.has(byId.get(e.target).layerId));
  const defs = '<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#858585"/></marker><marker id="data-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#666666"/></marker><filter id="node-shadow" x="-30%" y="-40%" width="160%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#333333" flood-opacity="0.12"/></filter></defs>';
  const sorted = camera.mode === 'spatial' && Math.cos(radians(camera.tilt)) < 0 ? [...visibleLayers] : [...visibleLayers].reverse();
  const bridges = new Map(doc.layers.map(layer => [layer.id, []]));
  const sameLayerLinks = new Map(doc.layers.map(layer => [layer.id, []]));
  function placeLink(html, first, second) {
    if (first === second) sameLayerLinks.get(first).push(html);
    else {
      const upper = [...sorted].reverse().find(layer => layer.id === first || layer.id === second);
      bridges.get(upper.id).push(html);
    }
  }
  visibleEdges.filter(e => e.style === 'dashed' && byId.get(e.source).layerId !== byId.get(e.target).layerId).forEach(e => {
    const a = byId.get(e.source), b = byId.get(e.target);
    const siblings = visibleEdges.filter(other => other.style === 'dashed' && other.target === e.target);
    const start = portPoint(a, e.sourcePort || 's'), end = portPoint(b, e.targetPort || 'n');
    if (b.kind === 'table' && !e.targetPort) end.x = b.x - b.width * .35 + b.width * .7 * (siblings.indexOf(e) + .5) / siblings.length;
    const p = project(start.x, start.y, layerZ(doc, a.layerId, camera), camera);
    const q = project(end.x, end.y, layerZ(doc, b.layerId, camera), camera);
    const direction = Math.sign(q.y - p.y) || 1;
    const { d, label } = e.routing === 'straight' ? {d: 'M' + pt(p) + ' L' + pt(q), label: {x:(p.x+q.x)/2,y:(p.y+q.y)/2-16}} : typeof e.sourcePort === 'object' || typeof e.targetPort === 'object' ? projectedFreeCurve(e, a, b, start, end, camera, doc) : { d: `M${pt(p)} C${p.x},${p.y + direction * 85} ${q.x},${q.y - direction * 85} ${pt(q)}`, label: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
    placeLink(edgeMarkup(e, a, b, d, label, selection?.id === e.id, !selectedNode || a.id === selectedNode || b.id === selectedNode), a.layerId, b.layerId);
  });
  visibleEdges.filter(e => e.style !== 'dashed' && byId.get(e.source).layerId !== byId.get(e.target).layerId).forEach(e => {
    const a = byId.get(e.source), b = byId.get(e.target);
    const start = portPoint(a, e.sourcePort || 's'), end = portPoint(b, e.targetPort || 'n');
    const p = project(start.x, start.y, layerZ(doc, a.layerId, camera), camera);
    const q = project(end.x, end.y, layerZ(doc, b.layerId, camera), camera);
    const { d, label } = e.routing === 'straight' ? {d: 'M' + pt(p) + ' L' + pt(q), label: {x:(p.x+q.x)/2,y:(p.y+q.y)/2-16}} : typeof e.sourcePort === 'object' || typeof e.targetPort === 'object' ? projectedFreeCurve(e, a, b, start, end, camera, doc) : { d: 'M' + pt(p) + ' C' + p.x + ',' + ((p.y + q.y) / 2) + ' ' + q.x + ',' + ((p.y + q.y) / 2) + ' ' + pt(q), label: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - 15 } };
    return placeLink(edgeMarkup(e, a, b, d, label, selection?.id === e.id, !selectedNode || a.id === selectedNode || b.id === selectedNode), a.layerId, b.layerId);
  });
  const contents = sorted.map(layer => {
    const nodes = doc.nodes.filter(n => n.layerId === layer.id);
    const edges = visibleEdges.filter(e => byId.get(e.source).layerId === layer.id && byId.get(e.target).layerId === layer.id).map(e => localEdge(e, byId.get(e.source), byId.get(e.target), selection?.id === e.id, !selectedNode || e.source === selectedNode || e.target === selectedNode)).join('');
    const nodeHtml = nodes.map(n => nodeMarkup(n, selectedIds.has(n.id), !selectedNode || relatedNodes.has(n.id), relatedAgents.has(n.id), connectSource === n.id)).join('');
    const table = doc.tables.filter(t => t.layerId === layer.id).map(t => tableMarkup(t, selectedIds.has(t.id))).join('');
    const empty = '';
    const z = layerZ(doc, layer.id, camera);
    // Paint each complete layer bottom-to-top; its translucent surface dims lower contents and blocks lower hit targets.
    return '<g data-layer-stack="' + esc(layer.id) + '">' + bridges.get(layer.id).join('') + planeMarkup(plane(doc, layer, doc.layers.indexOf(layer), layer.id === activeLayerId), z, camera, 'class="scene-layer" data-scene-layer="' + esc(layer.id) + '"') + sameLayerLinks.get(layer.id).join('') + planeMarkup(edges + nodeHtml + table + empty, z, camera, 'class="layer-content" data-layer-content="' + esc(layer.id) + '"') + '</g>';
  }).join('');
  svg.innerHTML = defs + contents;
  const points = visibleLayers.flatMap(layer => {
    const b = layerBounds(doc, layer.id), z = layerZ(doc, layer.id, camera);
    return [b.left, b.right].flatMap(x => [b.top, b.bottom].map(y => project(x, y, z, camera)));
  });
  return { left: Math.min(...points.map(p => p.x)) - 65, right: Math.max(...points.map(p => p.x)) + 65, top: Math.min(...points.map(p => p.y)) - 65, bottom: Math.max(...points.map(p => p.y)) + 65 };
}
