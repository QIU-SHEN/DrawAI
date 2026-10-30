import { test, expect } from './fixtures.mjs';
import { exampleDocument } from '../fixtures/example.mjs';
const TABLE_ID = 'table-shared';
const key = 'drawai.document.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function point(page, selector, x = 0, y = 0) {
  return page.locator(selector).evaluate((el, coords) => {
    const p = new DOMPoint(coords.x, coords.y).matrixTransform(el.getScreenCTM()); return { x: p.x, y: p.y };
  }, { x, y });
}
async function dragTo(page, a, b) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); });
for (const mode of ['flat', 'spatial']) test(`shared table moves and resizes with eight handles in ${mode}; edit and undo remain intact`, async ({ page }) => {
  if (mode === 'flat') { await page.locator('#view-flat').click(); await page.locator('[data-select-layer="data"]').click(); }
  const a = await point(page, '[data-table]', 610, 235), b = await point(page, '[data-table]', 680, 265);
  await dragTo(page, a, b);
  const moved = await stored(page);
  expect(moved.tables[0].x).toBeCloseTo(-540, 0); expect(Math.abs(moved.tables[0].y + 70)).toBeLessThanOrEqual(1);
  expect(moved.tables[0].layerId).toBe('data'); expect(moved.tables[0].cells).toEqual(exampleDocument().tables[0].cells);
  await expect(page.locator('[data-table] [data-resize]')).toHaveCount(8);
  const c = await point(page, '[data-table]', 1220, 305), d = await point(page, '[data-table]', 1370, 365);
  await dragTo(page, c, d);
  const resized = await stored(page);
  expect(resized.tables[0].width).toBeCloseTo(1370, 0); expect(resized.tables[0].height).toBeCloseTo(365, 0);
  expect(resized.tables[0].x).toBe(moved.tables[0].x); expect(resized.tables[0].y).toBe(moved.tables[0].y);
  await expect(page.locator('#inspector')).toBeHidden();
  await page.screenshot({ path: `test-results/table-handles-${mode}.png` });
  await page.locator('#undo').click(); expect((await stored(page)).tables[0]).toEqual(moved.tables[0]);
  await page.locator('#redo').click();
  const edit = await point(page, '[data-table]', 650, 280); await page.mouse.dblclick(edit.x, edit.y);
  await expect(page.locator('.table-inline-editor')).toBeVisible();
  await page.locator('[data-cell="0,0"]').fill('缩放后编辑');
  await page.locator('[data-table-save]').click(); await page.reload();
  expect((await stored(page)).tables[0]).toEqual({ ...resized.tables[0], cells: (await stored(page)).tables[0].cells });
  expect((await stored(page)).tables[0].cells[0][0]).toBe('缩放后编辑');
});

test('table can move across layers and undo restores its geometry, rows and connections', async ({ page }) => {
  const a = await point(page, '[data-table]', 610, 235);
  const b = await point(page, '[data-scene-layer="flow"]', 0, -330);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 });
  await expect(page.locator('[data-plane-layer="flow"]')).toHaveClass(/drop-plane/);
  await page.mouse.up();
  const saved = await stored(page);
  expect(saved.tables[0].layerId).toBe('flow'); expect(saved.tables[0].cells).toEqual(exampleDocument().tables[0].cells);
  expect(saved.edges).toEqual(exampleDocument().edges);
  await page.locator('#view-flat').click(); await expect(page.locator('[data-table]')).toBeVisible();
  await page.locator('#undo').click(); expect((await stored(page)).tables[0]).toEqual(exampleDocument().tables[0]);
  await page.locator('#redo').click(); await page.reload(); expect((await stored(page)).tables[0]).toEqual(saved.tables[0]);
});

for (const mode of ['flat', 'spatial']) test(`shared table can drag outgoing and incoming arrows in ${mode}`, async ({ page }) => {
  const fixture = exampleDocument();
  if (mode === 'flat') fixture.tables[0] = { ...fixture.tables[0], layerId: 'flow', x: -700, y: 210, width: 400, height: 150 };
  await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key, fixture }); await page.reload();
  await page.locator(`#view-${mode}`).click();
  const selectPoint = await point(page, '[data-table]', mode === 'flat' ? 200 : 610, mode === 'flat' ? 80 : 235);
  await page.mouse.click(selectPoint.x, selectPoint.y);
  const a = await point(page, '[data-table] [data-port="s"]');
  const b = await point(page, '[data-node="agent4"]');
  await dragTo(page, a, b);
  const outbound = (await stored(page)).edges.find(e => e.source === TABLE_ID && e.target === 'agent4');
  expect(outbound).toBeTruthy(); expect(outbound.sourcePort).toBe('s');
  await expect(page.locator('#inspector')).toBeHidden();
  const selectAgent = await point(page, '[data-node="agent4"]'); await page.mouse.click(selectAgent.x, selectAgent.y);
  const c = await point(page, '[data-node="agent4"] [data-port="s"]');
  const d = await point(page, '[data-table]', mode === 'flat' ? 200 : 610, mode === 'flat' ? 90 : 235);
  await dragTo(page, c, d);
  const inbound = (await stored(page)).edges.find(e => e.source === 'agent4' && e.target === TABLE_ID && e.style !== 'dashed');
  expect(inbound).toBeTruthy();
  // Reuse the explicit link-edit action to check table endpoints in the node's connections list.
  await page.locator('[data-list-node="agent4"]').click(); await page.locator('#node-properties').click();
  await expect(page.locator('.edge-list-item').filter({ hasText: '共享检查表' })).toHaveCount(3);
  await page.locator(`[data-edit-edge="${outbound.id}"]`).click();
  await page.locator('#inline-edge-label').fill('读取检查结果'); await page.locator('#inline-edge-label').press('Enter');
  const data = await stored(page); await page.reload();
  expect((await stored(page)).edges).toEqual(data.edges); expect(data.tables[0].cells).toEqual(fixture.tables[0].cells);
  await expect(page.locator(`[data-edge="${outbound.id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-edge="${inbound.id}"]`)).toHaveCount(1);
});

test('canceling table movement and resizing preserves geometry and history', async ({ page }) => {
  await page.locator('#view-flat').click(); await page.locator('[data-select-layer="data"]').click();
  const a = await point(page, '[data-table]', 610, 200);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 80, a.y + 30, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await stored(page)).tables[0]).toEqual(exampleDocument().tables[0]);
  const b = await point(page, '[data-table]', 0, 0);
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x - 35, b.y - 20, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await stored(page)).tables[0]).toEqual(exampleDocument().tables[0]);
  await expect(page.locator('#undo')).toBeDisabled();
});
