import test from 'node:test';
import { readFileSync } from 'node:fs';
const legacy = JSON.parse(readFileSync(new URL('./fixtures/v2.json', import.meta.url), 'utf8'));
const TABLE_ID = 'table-shared';
import assert from 'node:assert/strict';
import { validateDocument, removeNode, removeLayer, addEdge, History, clone, createTable, tableObject, updateDiagramObject } from '../src/model.js';
import { exampleDocument } from './fixtures/example.mjs';
import { project, unprojectDelta, unprojectPoint, planeMatrix, perspectiveDistance, layerZ, escapeHtml, wrapAngle, canEditPlane, freePort, portPoint, perimeterPoint, shapePolygon } from '../src/scene.js';

test('perspective narrows the far edge toward a vanishing point; flat view retains equal widths', () => {
  const camera = { mode: 'spatial', tilt: 60, yaw: 0, distance: 2600 };
  const width = y => project(500, y, 0, camera).x - project(-500, y, 0, camera).x;
  assert.ok(width(350) > width(-350) * 1.2);
  const far = project(500, -350, 0, camera), near = project(500, 350, 0, camera);
  const vanishingY = near.y - near.x * (near.y - far.y) / (near.x - far.x);
  assert.ok(Math.abs(vanishingY + camera.distance / Math.tan(Math.PI / 3)) < 1e-8);
  camera.mode = 'flat'; assert.equal(width(350), width(-350));
});

test('camera stays outside large documents through full rotations', () => {
  const doc = exampleDocument(); doc.nodes[0].x = 9000; doc.nodes[0].y = -9000;
  const camera = { mode: 'spatial', gap: 9000 }; camera.distance = perspectiveDistance(doc, camera);
  for (const tilt of [0, 55, 90, 135, 180, 270]) for (const yaw of [0, 45, 90, 180, 270]) {
    Object.assign(camera, { tilt, yaw });
    const p = project(9000, -9000, 4500, camera);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Math.hypot(p.x, p.y) < 30000);
  }
});

test('example and JSON round-trip retain the workflow and shared relationships', () => {
  const doc = exampleDocument();
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.equal(doc.nodes.filter(n => n.kind === 'agent').length, 3);
});

test('resized dimensions and arrow ports survive round-trip; malformed geometry is rejected', () => {
  const doc = exampleDocument();
  doc.nodes[0].width = 320; doc.nodes[0].height = 180;
  addEdge(doc, 'standard', 'retake', 'n', 'w');
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  for (const mutation of [
    d => { d.nodes[0].width = 0; }, d => { d.nodes[0].height = NaN; },
    d => { d.nodes[0].width = 2401; }, d => { d.edges[0].sourcePort = 'invalid'; },
    d => { d.edges[0].targetPort = '<script>'; },
  ]) { const invalid = clone(doc); mutation(invalid); assert.throws(() => validateDocument(invalid)); }
});

test('deleting an object cleans its edges without rewriting table content; undo restores all', () => {
  const doc = exampleDocument(), original = clone(doc), history = new History();
  history.push(doc); removeNode(doc, 'agent3');
  assert.ok(!doc.edges.some(e => [e.source, e.target].includes('agent3')));
  assert.deepEqual(doc.tables, original.tables); validateDocument(doc);
  assert.deepEqual(history.undo(doc), original);
});

test('connections reject loops, duplicates, and missing endpoints', () => {
  const doc = exampleDocument();
  assert.equal(addEdge(doc, 'agent2', 'agent2'), false);
  assert.equal(addEdge(doc, 'agent2', 'agent3'), false);
  assert.equal(addEdge(doc, 'agent2', 'absent'), false);
  assert.equal(addEdge(doc, 'agent4', 'agent3'), true);
  validateDocument(doc);
});

test('import rejects malformed documents and dangling/non-agent references', () => {
  const mutations = [
    d => { d.version = 9; },
    d => { d.nodes[0].x = Infinity; },
    d => { d.nodes[0].id = d.nodes[1].id; },
    d => { d.nodes[0].kind = '__proto__'; },
    d => { d.nodes[0].title = ''; },
    d => { d.edges[0].target = 'missing-node'; },
    d => { d.edges.push(clone(d.edges[0])); },
    d => { d.tables[0].columns = []; },
    d => { d.tables[0].cells[0].push('extra'); },
    d => { d.tables[0].cells[0][0] = 42; },
    d => { d.tables[0].cells[0][0] = 'x'.repeat(1001); },
    d => { d.tables[0].id = d.nodes[0].id; },
    d => { d.edges[0].style = 'bad'; },
  ];
  for (const mutation of mutations) { const doc = exampleDocument(); mutation(doc); assert.throws(() => validateDocument(doc)); }
  assert.throws(() => validateDocument(null));
  assert.throws(() => validateDocument({}));
});

test('redo history is invalidated after a new branch, snapshots are independent', () => {
  const doc = exampleDocument(), history = new History();
  history.push(doc); doc.nodes[0].title = 'changed';
  const original = history.undo(doc);
  assert.equal(original.nodes[0].title, '标准图');
  history.push(original); original.nodes[0].title = 'new branch';
  assert.equal(history.future.length, 0);
});

test('drag inverse preserves displacement at different angles and both view modes', () => {
  for (const mode of ['flat', 'spatial']) for (const yaw of [-30, 0, 30]) for (const tilt of [25, 48, 65]) {
    const camera = { mode, yaw, tilt };
    const a = project(-200, 100, 320, camera), b = project(-130, 150, 320, camera);
    const delta = unprojectDelta(b.x - a.x, b.y - a.y, camera, a, 320);
    assert.ok(Math.abs(delta.x - 70) < 1e-8);
    assert.ok(Math.abs(delta.y - 50) < 1e-8);
  }
});

test('user text is rendered as literal text', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('v1 and v2 migrate non-destructively, preserve all text, references, geometry and labels', () => {
  const v1 = { version: 1, nodes: legacy.nodes.map(({ layerId, shape, ...node }) => node), edges: legacy.edges, rows: legacy.rows };
  const untouched = clone(v1); assert.deepEqual(validateDocument(v1), exampleDocument()); assert.deepEqual(v1, untouched);
  const v2 = clone(legacy); v2.table.width = 1750; v2.rows[0].note = '备注';
  v2.rows[1].agentIds.push('agent2'); v2.nodes[2].relationLabel = '共享说明';
  v2.edges.push({ id: 'out', source: '@shared-table', target: 'agent2', label: '普通箭头' });
  v2.edges.push({ id: 'in', source: 'agent2', target: '@shared-table', label: '已有普通箭头' });
  const before = clone(v2), migrated = validateDocument(v2);
  assert.deepEqual(v2, before); assert.equal(migrated.tables[0].width, 1750);
  assert.deepEqual(migrated.tables[0].cells[0], ['图片差异', '待检查', 'AGENT 2', '备注']);
  assert.equal(migrated.tables[0].cells[1][2], 'AGENT 3 · AGENT 2');
  assert.equal(migrated.edges.find(e => e.style === 'dashed' && e.source === 'agent2').label, '共享说明');
  assert.equal(migrated.edges.find(e => e.id === 'out').source, TABLE_ID);
  assert.equal(migrated.edges.filter(e => e.source === 'agent2' && e.target === TABLE_ID).length, 2);
  assert.deepEqual(validateDocument(migrated), migrated);
});

test('layer deletion cleans only its contents and related references, undo restores table too', () => {
  const doc = exampleDocument(), history = new History();
  history.push(doc); removeLayer(doc, 'data');
  assert.equal(doc.tables.length, 0); assert.equal(doc.nodes.length, 12);
  assert.equal(removeLayer(doc, 'flow'), false);
  validateDocument(doc);
  const restored = history.undo(doc);
  assert.equal(restored.tables[0].cells.length, 3); assert.equal(restored.tables[0].layerId, 'data');
  removeLayer(restored, 'flow');
  assert.equal(restored.nodes.length, 0); assert.equal(restored.edges.length, 0);
  assert.deepEqual(restored.tables[0].cells, exampleDocument().tables[0].cells);
  validateDocument(restored);
});

test('layer and shape validation rejects missing references, duplicate layers and orphaned rows', () => {
  for (const mutation of [
    d => { d.layers = []; }, d => { d.layers.push(clone(d.layers[0])); },
    d => { d.nodes[0].layerId = 'missing'; }, d => { d.nodes[0].shape = 'invalid'; },
    d => { d.tables[0].layerId = 'missing'; }, d => { d.tables = []; },
  ]) { const doc = exampleDocument(); mutation(doc); assert.throws(() => validateDocument(doc)); }
});

test('drop inverse resolves the chosen layer at rotated angles and projective plane matrices agree', () => {
  const doc = exampleDocument(); doc.layers.push({ id: 'third', name: 'Third' });
  for (const mode of ['flat', 'spatial']) for (const yaw of [-175, -45, 0, 75, 179]) for (const tilt of [10, 48, 78]) {
    const camera = { mode, yaw, tilt, gap: 640 };
    for (const layer of doc.layers) {
      const z = layerZ(doc, layer.id, camera), p = project(221, -87, z, camera);
      const local = unprojectPoint(p.x, p.y, z, camera);
      assert.ok(Math.abs(local.x - 221) < 1e-8); assert.ok(Math.abs(local.y + 87) < 1e-8);
      const m = planeMatrix(z, camera).slice(9, -1).split(',').map(Number);
      assert.ok(Math.abs((m[0] * 221 - m[4] * 87 + m[12]) / (m[3] * 221 - m[7] * 87 + m[15]) - p.x) < 1e-8);
      assert.ok(Math.abs((m[1] * 221 - m[5] * 87 + m[13]) / (m[3] * 221 - m[7] * 87 + m[15]) - p.y) < 1e-8);
    }
  }
});



test('table geometry and directed links survive serialization and layer deletion cleans table endpoints', () => {
  const doc = exampleDocument();
  updateDiagramObject(doc, TABLE_ID, { x: 100, y: 200, width: 1500, height: 400 });
  assert.equal(doc.tables[0].x, -650); assert.equal(doc.tables[0].y, 0);
  assert.equal(addEdge(doc, TABLE_ID, 'agent2', 'n', 's'), true);
  assert.equal(addEdge(doc, 'agent3', TABLE_ID, 'e', 'w'), true);
  assert.equal(addEdge(doc, TABLE_ID, TABLE_ID), false);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  const rows = clone(doc.tables[0].cells), edges = clone(doc.edges);
  updateDiagramObject(doc, TABLE_ID, { layerId: 'flow', x: 300 });
  assert.deepEqual(doc.tables[0].cells, rows); assert.deepEqual(doc.edges, edges);
  assert.equal(tableObject(doc, TABLE_ID).x, 300); assert.equal(tableObject(doc, TABLE_ID).width, 1500);
  updateDiagramObject(doc, TABLE_ID, { layerId: 'data' });
  removeLayer(doc, 'data');
  assert.ok(!doc.edges.some(e => e.source === TABLE_ID || e.target === TABLE_ID));
  assert.equal(addEdge(doc, 'agent2', TABLE_ID), false);
  validateDocument(doc);
});

test('table dimensions and dangling table endpoints are validated without dropping legacy data', () => {
  for (const mutate of [
    d => { d.tables[0].width = 0; }, d => { d.tables[0].height = 99; },
    d => { d.tables[0].width = Infinity; }, d => { d.tables[0].height = 4001; },
    d => { addEdge(d, TABLE_ID, 'agent2'); d.tables = []; },
  ]) { const doc = exampleDocument(); mutate(doc); assert.throws(() => validateDocument(doc)); }
  assert.deepEqual(validateDocument(exampleDocument()), exampleDocument());
});


test('multiple tables remain independent; table-to-table arrows and deletion round-trip', () => {
  const doc = exampleDocument(), second = createTable('flow'); doc.tables.push(second);
  second.title = '普通表'; second.columns = ['自由列']; second.cells = [['任意文字']];
  assert.equal(addEdge(doc, TABLE_ID, second.id, 'e', 'w'), true);
  assert.deepEqual(validateDocument(doc), doc);
  const first = clone(doc.tables[0]); removeNode(doc, second.id);
  assert.deepEqual(doc.tables, [first]); assert.ok(!doc.edges.some(e => e.target === second.id));
});


test('full-orbit projection and inverse agree from front and back, with finite edge-on fallback', () => {
  for (const tilt of [0, 10, 55, 89, 91, 135, 180, 225, 269, 271, 315, 359, 360]) {
    for (const yaw of [-175, -30, 0, 120]) {
      const camera = { mode: 'spatial', yaw, tilt };
      const p = project(221, -87, 320, camera), local = unprojectPoint(p.x, p.y, 320, camera);
      assert.ok(Math.abs(local.x - 221) < 1e-8); assert.ok(Math.abs(local.y + 87) < 1e-8);
      const m = planeMatrix(320, camera).slice(9, -1).split(',').map(Number);
      assert.ok(Math.abs((m[0] * 221 - m[4] * 87 + m[12]) / (m[3] * 221 - m[7] * 87 + m[15]) - p.x) < 1e-8);
      assert.ok(Math.abs((m[1] * 221 - m[5] * 87 + m[13]) / (m[3] * 221 - m[7] * 87 + m[15]) - p.y) < 1e-8);
    }
  }
  for (const tilt of [90, 270, -90, 450]) {
    const camera = { mode: 'spatial', yaw: -30, tilt };
    assert.equal(canEditPlane(camera), false);
    const local = unprojectPoint(100, 30, 0, camera);
    assert.ok(Number.isFinite(local.x) && Number.isFinite(local.y));
    assert.ok(Math.hypot(local.x, local.y) < 1000);
  }
  assert.equal(wrapAngle(-725), 355); assert.equal(wrapAngle(1085), 5);
});

test('legacy migration handles ID collisions and does not silently accept corrupt documents', () => {
  const value = clone(legacy); value.nodes[0].id = 'table-shared'; value.edges[0].source = 'table-shared';
  value.edges[1].id = 'relation-agent2';
  const doc = validateDocument(value); assert.equal(doc.tables[0].id, 'table-shared-1');
  assert.equal(new Set(doc.edges.map(e => e.id)).size, doc.edges.length);
  for (const mutate of [v => v.rows[0].agentIds.push('standard'), v => v.rows[0].agentIds.push('agent2'), v => v.table.layerId = 'absent']) {
    const invalid = clone(legacy); mutate(invalid); assert.throws(() => validateDocument(invalid));
  }
});

test('free anchors serialize independently and reject malformed or unbounded coordinates', () => {
  const doc = exampleDocument();
  const source = { x: 1, y: .6 }, target = { x: -.35, y: -1 };
  assert.equal(addEdge(doc, 'standard', 'table-shared', source, target), true);
  source.y = 0; target.x = 0;
  assert.deepEqual(doc.edges.at(-1).sourcePort, { x: 1, y: .6 });
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  for (const port of [null, {}, { x: 0 }, { x: 1.1, y: 0 }, { x: 0, y: Infinity }, [0, 1], 'invalid']) {
    const bad = clone(doc); bad.edges[0].targetPort = port;
    assert.throws(() => validateDocument(bad));
  }
});

test('free anchors lie on real shape outlines, and follow movement and resizing', () => {
  for (const shape of ['rectangle', 'rounded', 'diamond', 'ellipse', 'parallelogram', 'text']) {
    const node = { id: 'n', shape, kind: 'input', x: 140, y: -75, width: 400, height: 240 };
    const local = { x: node.x + 170, y: node.y + 83 }, anchor = freePort(node, local), p = portPoint(node, anchor);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    if (shape === 'ellipse') assert.ok(Math.abs(((p.x - node.x) / 200) ** 2 + ((p.y - node.y) / 120) ** 2 - 1) < 1e-9);
    if (shape === 'diamond') assert.ok(Math.abs(Math.abs((p.x - node.x) / 200) + Math.abs((p.y - node.y) / 120) - 1) < 1e-9);
    const moved = portPoint({ ...node, x: node.x + 85, y: node.y - 42 }, anchor);
    assert.ok(Math.abs(moved.x - p.x - 85) < 1e-8); assert.ok(Math.abs(moved.y - p.y + 42) < 1e-8);
    const resized = { ...node, width: 800, height: 480 }, q = portPoint(resized, anchor), boundary = perimeterPoint(resized, q);
    assert.ok(Math.hypot(q.x - boundary.x, q.y - boundary.y) < 1e-8);
  }
  const rounded = { kind: 'agent', shape: 'rounded', x: 0, y: 0, width: 200, height: 112 };
  const corner = perimeterPoint(rounded, { x: 100, y: 56 });
  assert.ok(Math.abs(Math.hypot(corner.x - 85, corner.y - 41) - 15) < 1e-8);
  const table = { kind: 'table', shape: 'rectangle', x: 0, y: 0, width: 600, height: 260 };
  const anchor = freePort(table, { x: 100, y: -130 });
  assert.deepEqual(anchor, { x: 1 / 3, y: -1 });
  assert.deepEqual(portPoint({ ...table, width: 900, height: 400 }, anchor), { x: 150, y: -200 });
});

test('neutral polygon shapes round-trip and both snapped/free anchors stay on their rendered boundary', () => {
  const names = ['triangle','trapezoid','pentagon','hexagon','octagon','chevron'];
  const doc = { version:3, layers:[{id:'flow',name:'图形'}], nodes:names.map((shape,i)=>({id:'n'+i,kind:'shape',shape,layerId:'flow',title:shape,description:'自由说明',x:0,y:0,width:400,height:240})),tables:[],edges:[] };
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  for (const n of doc.nodes) {
    const vertices = shapePolygon(n);
    const onBoundary = p => vertices.some((a,i) => {
      const b=vertices[(i+1)%vertices.length],dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);
      return t>=-1e-8&&t<=1+1e-8&&Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<1e-6;
    });
    for(const anchor of ['n','e','s','w',freePort(n,{x:173,y:67}),freePort(n,{x:-198,y:0})]) {
      const p=portPoint(n,anchor);assert.ok(onBoundary(p),n.shape+' anchor must meet its outline');
      const moved=portPoint({...n,x:55,y:-31},anchor);assert.ok(Math.hypot(moved.x-p.x-55,moved.y-p.y+31)<1e-7);
    }
  }
});

test('cylinder and actor retain free anchors through resize and file round trips', () => {
  const doc = { version:3, layers:[{id:'flow',name:'图形'}], nodes:['cylinder','actor'].map((shape,i)=>({id:'n'+i,kind:'shape',shape,layerId:'flow',title:shape,description:'自由文字',x:0,y:0,width:180,height:180})),tables:[],edges:[] };
  addEdge(doc, 'n0', 'n1', 'e', 'w');
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  for (const n of doc.nodes) for (const raw of [{x:50,y:-85},{x:70,y:90},{x:90,y:20}]) {
    const anchor = freePort(n,raw), p = portPoint(n,anchor), repeat = perimeterPoint(n,p);
    assert.ok(Math.hypot(p.x-repeat.x,p.y-repeat.y)<1e-8);
    if(n.shape==='cylinder') {
      const r=90*.26;
      assert.ok(Math.abs(p.x)===90 || Math.abs((p.x/90)**2+((Math.abs(p.y)-(90-r))/r)**2-1)<1e-8);
    }
    const resized=portPoint({...n,width:360,height:360},anchor);
    assert.ok(Math.hypot(resized.x-p.x*2,resized.y-p.y*2)<1e-8);
  }
});

test('edge direction and routing survive files and reject unsupported enum values',()=>{
  const doc=exampleDocument();doc.edges[0].direction='both';doc.edges[0].routing='straight';
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).edges[0],doc.edges[0]);
  for(const [field,value] of [['direction','sideways'],['routing','script']]){const bad=structuredClone(doc);bad.edges[0][field]=value;assert.throws(()=>validateDocument(bad),new RegExp('edges\\[0\\]\\.'+field));}
});

test('cross-layer straight and double-ended edges render with both line styles',async()=>{
  const {renderScene}=await import('../src/scene.js');const doc=exampleDocument();doc.edges=[{id:'cross',source:'agent2',target:'table-shared',label:'关联',routing:'straight',direction:'both'}];
  for(const style of ['solid','dashed']){
    doc.edges[0].style=style;const svg={innerHTML:''};renderScene(svg,doc,{mode:'spatial',tilt:55,yaw:-30,gap:640},null,true,null,'flow');
    assert.match(svg.innerHTML,/class="edge-line[^\"]*" d="M[^\"]+ L[^\"]+"/);assert.match(svg.innerHTML,/marker-start="url\(#(?:flow|data)-arrow\)"/);
  }
});
