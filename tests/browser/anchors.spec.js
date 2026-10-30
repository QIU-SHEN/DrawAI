import { test, expect } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
const key = 'drawai.document.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
function fixture(mode = 'flat') {
  return { version: 3, layers: [{ id: 'flow', name: '流程' }, { id: 'data', name: '表格层' }], nodes: [
    { id: 'a', layerId: 'flow', kind: 'input', shape: 'rectangle', title: '起点', description: '', x: -470, y: -150, width: 360, height: 240 },
    { id: 'b', layerId: 'flow', kind: 'input', shape: 'ellipse', title: '椭圆', description: '', x: 450, y: -140, width: 280, height: 200 },
  ], tables: [{ id: 'table', layerId: mode === 'flat' ? 'flow' : 'data', title: '任意位置连接', x: -200, y: 130, width: 500, height: 220, columns: ['名称', '内容'], cells: [['自由点', '自由连接']] }], edges: [] };
}
async function load(page, mode = 'flat', doc = fixture(mode)) {
  await page.goto('/'); await page.evaluate(({ key, doc }) => localStorage.setItem(key, JSON.stringify(doc)), { key, doc }); await page.reload();
  await page.locator(`#view-${mode}`).click();
}
async function point(page, selector, x = 0, y = 0) {
  return page.locator(selector).evaluate((el, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM()); return { x: q.x, y: q.y }; }, { x, y });
}
async function drag(page, a, b, finish = true) {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); if (finish) await page.mouse.up();
}
async function createFreeEdge(page) {
  await drag(page, await point(page, '[data-node="a"]', 180, 70), await point(page, '[data-table="table"]', 110, 0));
  const doc = await stored(page); expect(doc.edges).toHaveLength(1); return doc.edges[0];
}
function closePort(port, x, y) { expect(port.x).toBeCloseTo(x, 2); expect(port.y).toBeCloseTo(y, 2); }

for (const mode of ['flat', 'spatial']) test(`free border-to-table anchors and editable endpoints in ${mode}`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, mode); const edge = await createFreeEdge(page);
  closePort(edge.sourcePort, 1, 70 / 120); closePort(edge.targetPort, -.56, -1);
  const tangent = await page.locator(`[data-edge="${edge.id}"] .edge-line`).evaluate(el => {
    const at = distance => { const p = el.getPointAtLength(distance); return new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM()); };
    const a = at(0), b = at(1); return { x: b.x - a.x, y: b.y - a.y };
  });
  const directionStart = await point(page, '[data-node="a"]', 180, 70), directionEnd = await point(page, '[data-node="a"]', 200, 70);
  expect(tangent.x * (directionEnd.x - directionStart.x) + tangent.y * (directionEnd.y - directionStart.y)).toBeGreaterThan(0);
  await expect(page.locator('.edge-endpoint')).toHaveCount(2); await expect(page.locator('#inspector')).toBeHidden();
  await drag(page, await point(page, '[data-edge-endpoint="source"]'), await point(page, '[data-node="a"]', -100, -120));
  const sourceChanged = (await stored(page)).edges[0]; closePort(sourceChanged.sourcePort, -100 / 180, -1); expect(sourceChanged.targetPort).toEqual(edge.targetPort);
  await drag(page, await point(page, '[data-edge-endpoint="target"]'), await point(page, '[data-table="table"]', 0, 50));
  const both = (await stored(page)).edges[0]; closePort(both.targetPort, -1, (50 - 110) / 110); expect(both.sourcePort).toEqual(sourceChanged.sourcePort);
  await page.screenshot({ path: `test-results/free-anchors-${mode}.png` });
  await page.locator('#undo').click(); expect((await stored(page)).edges[0]).toEqual(sourceChanged);
  await page.locator('#redo').click(); await page.reload(); expect((await stored(page)).edges[0]).toEqual(both);
  expect(errors).toEqual([]);
});

test('near midpoints snaps with a visible indicator; leaving the snap zone keeps a free anchor', async ({ page }) => {
  await load(page); await createFreeEdge(page);
  await drag(page, await point(page, '[data-edge-endpoint="source"]'), await point(page, '[data-node="a"]', 180, 8), false);
  await expect(page.locator('.anchor-preview.snapped')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/anchor-snap.png' }); await page.mouse.up();
  expect((await stored(page)).edges[0].sourcePort).toBe('e');
  await drag(page, await point(page, '[data-edge-endpoint="target"]'), await point(page, '[data-table="table"]', 0, 115));
  expect((await stored(page)).edges[0].targetPort).toBe('w');
  await drag(page, await point(page, '[data-edge-endpoint="target"]'), await point(page, '[data-table="table"]', 0, 55));
  closePort((await stored(page)).edges[0].targetPort, -1, -.5);
});

test('endpoint reattachment follows curved outlines; Escape and empty drops preserve the old edge', async ({ page }) => {
  await load(page); const edge = await createFreeEdge(page);
  const blank = await point(page, '[data-scene-layer="flow"]', 700, -360);
  await drag(page, await point(page, '[data-edge-endpoint="target"]'), blank);
  expect((await stored(page)).edges[0]).toEqual(edge);
  await drag(page, await point(page, '[data-edge-endpoint="source"]'), await point(page, '[data-node="b"]', -112, 60), false);
  await page.keyboard.press('Escape'); await page.mouse.up(); expect((await stored(page)).edges[0]).toEqual(edge);
  await drag(page, await point(page, '[data-edge-endpoint="target"]'), await point(page, '[data-node="b"]', -112, 60));
  const changed = (await stored(page)).edges[0]; expect(changed.target).toBe('b'); closePort(changed.targetPort, -.8, .6);
  await page.locator('#undo').click(); expect((await stored(page)).edges[0]).toEqual(edge);
});

test('anchors follow resize and movement, survive export/import, and retain old center ports', async ({ page }) => {
  await load(page); const edge = await createFreeEdge(page);
  await page.locator('[data-list-node="a"]').click();
  await drag(page, await point(page, '[data-node="a"]', 0, 0), await point(page, '[data-node="a"]', 50, 20));
  await drag(page, await point(page, '[data-node="a"]', 180, 120), await point(page, '[data-node="a"]', 260, 180));
  const doc = await stored(page); expect(doc.edges[0]).toEqual(edge);
  const a = doc.nodes[0];
  const start = await page.locator(`[data-edge="${edge.id}"] .edge-line`).evaluate(el => { const p = el.getPointAtLength(0); return { x: p.x, y: p.y }; });
  expect(start.x).toBeCloseTo(a.x + a.width / 2, 1); expect(start.y).toBeCloseTo(a.y + a.height / 2 * edge.sourcePort.y, 1);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise;
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8')); expect(exported.document).toEqual(doc);
  await page.locator('#import-file').setInputFiles({ name: 'anchors.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) }); await page.locator('#confirm-ok').click();
  expect(await stored(page)).toEqual(doc);
  const old = fixture(); old.edges = [{ id: 'old', source: 'a', target: 'table', sourcePort: 's', targetPort: 'n', label: '原中点连接' }];
  await load(page, 'flat', old); await expect(page.locator('[data-edge="old"]')).toHaveCount(1);
  expect((await stored(page)).edges).toEqual(old.edges);
});

test('free edge can start on a table and finish on a diamond edge', async ({ page }) => {
  const doc = fixture(); doc.nodes[1].shape = 'diamond'; await load(page, 'flat', doc);
  await drag(page, await point(page, '[data-table="table"]', 390, 220), await point(page, '[data-node="b"]', -84, 40));
  const edge = (await stored(page)).edges[0]; expect(edge.source).toBe('table'); expect(edge.target).toBe('b');
  closePort(edge.sourcePort, .56, 1); closePort(edge.targetPort, -.6, .4);
});
