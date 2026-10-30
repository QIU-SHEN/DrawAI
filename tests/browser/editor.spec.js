import { test, expect } from './fixtures.mjs';
import { exampleDocument } from '../fixtures/example.mjs';
const storageKey = 'drawai.document.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('example renders in 3D; flat switch, camera, zoom and screenshots', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.diagram-node')).toHaveCount(12);
  await expect(page.locator('.data-link')).toHaveCount(3);
  await expect(page.locator('#view-spatial')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/prototype-spatial.png', fullPage: true });
  const before = await page.locator('[data-layer-content="flow"]').getAttribute('transform');
  await page.locator('#view-flat').click();
  expect(await page.locator('[data-layer-content="flow"]').getAttribute('transform')).not.toBe(before);
  await expect(page.locator('.scene-layer')).toHaveCount(1);
  await expect(page.locator('.shared-table')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/prototype-flat.png', fullPage: true });
  await page.locator('#view-spatial').click();
  await page.locator('#camera-toggle').click();
  await page.locator('#gap').fill('900');
  await expect(page.locator('#gap-value')).toHaveText('900');
  await page.locator('#yaw').fill('20');
  await expect(page.locator('#yaw-value')).toHaveText('20°');
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-label')).toHaveText('120%');
  await page.locator('#fit').click();
  await expect(page.locator('#zoom-label')).toHaveText('100%');
  await expect(page.locator('#gap')).toHaveValue('640');
  expect(errors).toEqual([]);
});

test('node edits persist through both views and reload; undo/redo restores name', async ({ page }) => {
  await page.locator('[data-list-node="agent2"]').click();
  await page.locator('#node-properties').click();
  await page.locator('#node-title').fill('图片对比 Agent');
  await page.locator('#node-description').fill('对比标准图与现场图');
  await page.locator('#node-description').blur();
  await page.locator('#view-flat').click();
  await expect(page.locator('[data-node="agent2"] .node-title')).toContainText('图片对比');
  await page.reload();
  await page.locator('[data-list-node="agent2"]').click();
  await page.locator('#node-properties').click();
  await expect(page.locator('#node-title')).toHaveValue('图片对比 Agent');
  await page.locator('#node-title').fill('另一个名字');
  await page.locator('#node-title').blur();
  await page.locator('#undo').click();
  await expect(page.locator('#node-title')).toHaveValue('图片对比 Agent');
  await page.locator('#redo').click();
  await expect(page.locator('#node-title')).toHaveValue('另一个名字');
});

for (const mode of ['spatial', 'flat']) test(`drag updates world position and edges in ${mode}`, async ({ page }) => {
  await page.locator(`#view-${mode}`).click();
  await page.locator('[data-list-node="agent3"]').click();
  await page.locator('#node-properties').click();
  const node = page.locator('[data-node="agent3"]');
  const before = await node.getAttribute('transform');
  const edgeBefore = await page.locator('[data-edge="edge-5"] .edge-line').getAttribute('d');
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  expect(await node.getAttribute('transform')).not.toBe(before);
  expect(await page.locator('[data-edge="edge-5"] .edge-line').getAttribute('d')).not.toBe(edgeBefore);
  const data = await stored(page);
  expect(data.nodes.find(n => n.id === 'agent3').x).not.toBe(-125);
  await page.locator('#undo').click();
  expect(await node.getAttribute('transform')).toBe(before);
});



test('new node connects, edge label edits, delete cleans references and undo restores', async ({ page }) => {
  await page.locator('[data-template="rounded"]').dblclick();
  await page.locator('#node-properties').click();
  await page.locator('#node-title').fill('复核 Agent');
  await page.locator('#node-description').fill('最终复核');
  await page.locator('#connect-node').click();
  await page.locator('[data-list-node="agent4"]').click();
  await page.locator('#node-properties').click();
  await expect(page.locator('.diagram-node')).toHaveCount(13);
  await expect(page.locator('.flow-edge:not(.data-link)')).toHaveCount(13);
  let data = await stored(page);
  const newNode = data.nodes.find(n => n.title === '复核 Agent');
  const newEdge = data.edges.find(e => e.source === newNode.id);
  await page.locator(`[data-edit-edge="${newEdge.id}"]`).click();
  await page.locator('#inline-edge-label').fill('复核完成');
  await page.locator('#inline-edge-label').blur();
  await page.locator(`[data-list-node="${newNode.id}"]`).click();
  await page.locator('#node-properties').click();
  await page.locator('#delete-node').click();
  await expect(page.locator('.diagram-node')).toHaveCount(12);
  data = await stored(page);
  expect(data.nodes.some(n => n.id === newNode.id)).toBe(false);
  expect(data.edges.some(e => e.id === newEdge.id)).toBe(false);
  await page.locator('#undo').click();
  data = await stored(page);
  expect(data.nodes.some(n => n.id === newNode.id)).toBe(true);
  expect(data.edges.find(e => e.id === newEdge.id).label).toBe('复核完成');
});

test('export/import round trip, malformed files do not overwrite state', async ({ page }) => {
  await page.locator('[data-list-node="agent2"]').click();
  await page.locator('#node-properties').click();
  await page.locator('#node-title').fill('持久化验证');
  await page.locator('#node-title').blur();
  const saved = await stored(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('DrawAI');
  const downloadPath = await download.path();
  await page.locator('#reset').click();
  await page.locator('#confirm-ok').click();
  await page.locator('#import-file').setInputFiles(downloadPath);
  await page.locator('#confirm-ok').click();
  expect(await stored(page)).toEqual(saved);
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":9}') });
  await expect(page.locator('#toast')).toContainText('格式不正确');
  expect(await stored(page)).toEqual(saved);
});

test('narrow viewport keeps view switch and editing reachable', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('#view-flat')).toBeVisible();
  await page.locator('#view-flat').click();
  await page.locator('[data-node="agent2"]').click();
  await expect(page.locator('#inspector')).toBeHidden();
  await page.locator('#node-properties').click();
  await expect(page.locator('#node-title')).toBeVisible();
  await page.locator('#close-inspector').click();
  await page.locator('#sidebar-toggle').click();
  await page.locator('[data-template="table"]').dblclick();
  await expect(page.locator('.table-inline-editor')).toBeVisible();
  await page.locator('[data-table-save]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('double click opens name editing, literal HTML stays text, type change preserves generic links', async ({ page }) => {
  await page.locator('[data-list-node="agent2"]').click();
  await page.locator('#node-properties').click();
  await page.locator('[data-node="agent2"]').dblclick();
  await expect(page.locator('#inline-node-title')).toBeFocused();
  await page.locator('#inline-node-title').fill('<script>alert(1)</script>');
  await page.locator('#inline-node-title').press('Enter');
  await page.locator('#node-properties').click();
  await page.locator('#node-shape').selectOption('hexagon');
  await expect(page.locator('.data-link')).toHaveCount(3);
  const data = await stored(page);
  expect(data.edges.some(e => e.source === 'agent2' && e.target === 'table-shared')).toBe(true);
  await page.reload();
  await page.locator('[data-list-node="agent2"]').click();
  await page.locator('#node-properties').click();
  await expect(page.locator('#node-title')).toHaveValue('<script>alert(1)</script>');
  expect(await page.locator('#scene script').count()).toBe(0);
});

test('text follows its plane, 3D blank dragging rotates, flat dragging pans only the current layer', async ({ page }) => {
  await page.locator('#tool-drag').click();
  const getMatrix = selector => page.locator(selector).evaluate(el => { const m = el.getCTM(); return { a: m.a, b: m.b, c: m.c, d: m.d }; });
  const nodeMatrix = await getMatrix('[data-node="agent2"] .node-title');
  const planeMatrix = await getMatrix('[data-scene-layer="flow"]');
  expect(nodeMatrix).toEqual(planeMatrix);
  expect(Math.abs(nodeMatrix.b)).toBeGreaterThan(.01);
  expect(await getMatrix('.shared-table .table-title')).toEqual(await getMatrix('[data-scene-layer="data"]'));
  // Check drag direction from a front-facing yaw, before an orbit turns past a point's horizontal extremum.
  await page.locator('#camera-toggle').click();
  await page.locator('#yaw').fill('0');
  await page.locator('#camera-close').click();
  const rect = await page.locator('#scene').boundingBox();
  const dragBlank = async () => {
    await page.mouse.move(rect.x + 40, rect.y + 30); await page.mouse.down();
    await page.mouse.move(rect.x + 180, rect.y + 65, { steps: 8 }); await page.mouse.up();
  };
  const before = await page.locator('[data-layer-content="flow"]').getAttribute('transform');
  const boxBefore = await page.locator('#scene').getAttribute('viewBox');
  const frontBefore = await page.locator('[data-node="missing"]').boundingBox();
  await dragBlank();
  expect(await page.locator('[data-layer-content="flow"]').getAttribute('transform')).not.toBe(before);
  expect(await page.locator('#scene').getAttribute('viewBox')).toBe(boxBefore);
  const frontAfter = await page.locator('[data-node="missing"]').boundingBox();
  expect(frontAfter.x + frontAfter.width / 2).toBeGreaterThan(frontBefore.x + frontBefore.width / 2);
  await page.mouse.move(rect.x + 180, rect.y + 65); await page.mouse.down();
  await page.mouse.move(rect.x + 40, rect.y + 30, { steps: 8 }); await page.mouse.up();
  const frontReturned = await page.locator('[data-node="missing"]').boundingBox();
  expect(frontReturned.x + frontReturned.width / 2).toBeLessThan(frontAfter.x + frontAfter.width / 2);
  await page.locator('#view-flat').click();
  const flatBefore = await page.locator('#scene').getAttribute('viewBox');
  await dragBlank();
  expect(await page.locator('#scene').getAttribute('viewBox')).not.toBe(flatBefore);
  await expect(page.locator('[data-layer-content="flow"]')).toHaveAttribute('transform', 'matrix(1 0 0 1 0 0)');
  await page.locator('[data-select-layer="data"]').click();
  await expect(page.locator('.scene-layer')).toHaveCount(1);
  await expect(page.locator('.diagram-node')).toHaveCount(0);
  await expect(page.locator('.shared-table')).toHaveCount(1);
  await expect(page.locator('.data-link')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/prototype-flat-data.png', fullPage: true });
  await page.locator('#tool-select').click();
  await page.locator('.shared-table').dblclick({ delay: 220 });
  await expect(page.locator('.table-inline-editor')).toBeVisible();
  await page.locator('[data-table-save]').click();
  await page.locator('#view-spatial').click();
  await expect(page.locator('.scene-layer')).toHaveCount(2);
  await expect(page.locator('.data-link')).toHaveCount(3);
});

async function dragTemplate(page, template, x, y) {
  const source = await page.locator('[data-template="' + template + '"]').boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

for (const mode of ['flat', 'spatial']) test(`palette drag creates the chosen shape at the drop position on the active layer in ${mode}`, async ({ page }) => {
  await page.locator(`#view-${mode}`).click();
  if (mode === 'spatial') {
    await page.locator('#camera-toggle').click(); await page.locator('#yaw').fill('28'); await page.locator('#camera-close').click();
  }
  const rect = await page.locator('#scene').boundingBox();
  const x = rect.x + rect.width * .3, y = rect.y + rect.height * .4;
  await dragTemplate(page, 'diamond', x, y);
  const doc = await stored(page), added = doc.nodes.at(-1);
  expect(added.shape).toBe('diamond'); expect(added.kind).toBe('shape'); expect(added.layerId).toBe('flow');
  const box = await page.locator('[data-node="' + added.id + '"]').boundingBox();
  expect(Math.abs(box.x + box.width / 2 - x)).toBeLessThan(8);
  expect(Math.abs(box.y + box.height / 2 - y)).toBeLessThan(8);
  await expect(page.locator('#palette-ghost')).toBeHidden();
  await page.locator('#undo').click();
  await expect(page.locator('.diagram-node')).toHaveCount(12);
  await page.locator('#redo').click();
  await expect(page.locator('.diagram-node')).toHaveCount(13);
  await page.reload();
  expect((await stored(page)).nodes.at(-1).shape).toBe('diamond');
});

test('palette drop outside canvas and Escape cancellation do not create nodes', async ({ page }) => {
  await dragTemplate(page, 'ellipse', 110, 110);
  await expect(page.locator('.diagram-node')).toHaveCount(12);
  const source = await page.locator('[data-template="ellipse"]').boundingBox();
  const rect = await page.locator('#scene').boundingBox();
  await page.mouse.move(source.x + 15, source.y + 15); await page.mouse.down();
  await page.mouse.move(rect.x + 300, rect.y + 200, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.diagram-node')).toHaveCount(12);
  await expect(page.locator('#palette-ghost')).toBeHidden();
});

test('layers can be added, renamed, populated, removed and restored with all references', async ({ page }) => {
  await page.locator('#view-flat').click();
  await page.locator('#add-layer').click();
  await page.locator('#layer-name').fill('复核层'); await page.locator('#layer-name').blur();
  const data = await stored(page), layerId = data.layers.at(-1).id;
  await expect(page.locator('.scene-layer')).toHaveCount(1);
  await expect(page.locator('.diagram-node')).toHaveCount(0);
  await page.locator('#close-inspector').click();
  const rect = await page.locator('#scene').boundingBox();
  await dragTemplate(page, 'rounded', rect.x + rect.width / 2, rect.y + rect.height / 2);
  const newNode = (await stored(page)).nodes.at(-1);
  expect(newNode.layerId).toBe(layerId);
  await page.locator('[data-list-node="' + newNode.id + '"]').click();
  await page.locator('#node-properties').click();
  await page.locator('#view-spatial').click();
  await expect(page.locator('.scene-layer')).toHaveCount(3);
  await expect(page.locator('.data-link')).toHaveCount(3);
  await page.locator('#close-inspector').click();
  await page.screenshot({ path: 'test-results/prototype-three-layers.png', fullPage: true });
  await page.reload();
  await page.locator('[data-manage-layer="' + layerId + '"]').click();
  await expect(page.locator('#layer-name')).toHaveValue('复核层');
  await page.locator('#delete-layer').click();
  await page.locator('#confirm-ok').click();
  expect((await stored(page)).nodes.some(n => n.id === newNode.id)).toBe(false);
  expect((await stored(page)).edges.some(e => e.source === newNode.id || e.target === newNode.id)).toBe(false);
  await page.locator('#undo').click();
  expect((await stored(page)).nodes.some(n => n.id === newNode.id)).toBe(true);
  await expect(page.locator('.scene-layer')).toHaveCount(3);
});



test('moving a node between layers preserves cross-layer edges and checklist associations', async ({ page }) => {
  await page.locator('[data-list-node="agent3"]').click();
  await page.locator('#node-properties').click();
  await page.locator('#node-layer').selectOption('data');
  await expect(page.locator('.flow-edge:not(.data-link)')).toHaveCount(12);
  await expect(page.locator('.data-link')).toHaveCount(3);
  await page.locator('#view-flat').click();
  await expect(page.locator('.diagram-node')).toHaveCount(1);
  await expect(page.locator('.shared-table')).toHaveCount(1);
  await expect(page.locator('.flow-edge:not(.data-link)')).toHaveCount(0);
  await expect(page.locator('.data-link')).toHaveCount(1);
  expect((await stored(page)).edges.some(e => e.source === 'agent3' && e.target === 'table-shared')).toBe(true);
  await page.locator('[data-select-layer="flow"]').click();
  await expect(page.locator('.diagram-node')).toHaveCount(11);
  await expect(page.locator('.shared-table')).toHaveCount(0);
});



for (const mode of ['flat', 'spatial']) test(`single click keeps the canvas size and double click edits text in place in ${mode}`, async ({ page }) => {
  await page.locator(`#view-${mode}`).click();
  const node = page.locator('[data-node="agent2"]');
  const canvasBefore = await page.locator('#stage').boundingBox();
  await node.click();
  await expect(page.locator('#inspector')).toBeHidden();
  expect(await page.locator('#stage').boundingBox()).toEqual(canvasBefore);
  await node.dblclick();
  await expect(page.locator('#inline-node-title')).toBeVisible();
  await expect(page.locator('#inspector')).toBeHidden();
  expect(await page.locator('#stage').boundingBox()).toEqual(canvasBefore);
  await page.locator('#inline-node-title').fill('图片核对');
  await page.locator('#inline-node-description').fill('对比商品位置\n核实缺货情况');
  await page.screenshot({ path: `test-results/inline-edit-${mode}.png`, fullPage: true });
  await page.locator('#inline-node-description').press('Enter');
  await expect(page.locator('.node-inline-editor')).toHaveCount(0);
  expect((await stored(page)).nodes.find(n => n.id === 'agent2').description).toBe('对比商品位置\n核实缺货情况');
  await expect(node.locator('.node-title')).toHaveText('图片核对');
  await page.locator('#undo').click();
  await expect(node.locator('.node-title')).toHaveText('AGENT 2');
  await page.locator('#redo').click();
  await expect(node.locator('.node-title')).toHaveText('图片核对');
  await page.reload();
  await expect(node.locator('.node-title')).toHaveText('图片核对');
  await expect(page.locator('#inspector')).toBeHidden();
});

test('inline editing cancels with Escape, saves outside and accepts Chinese composition Enter', async ({ page }) => {
  await page.locator('#view-flat').click();
  const node = page.locator('[data-node="agent3"]');
  await node.dblclick();
  await page.locator('#inline-node-title').fill('应取消的名称');
  await page.locator('#inline-node-title').press('Escape');
  await expect(node.locator('.node-title')).toHaveText('AGENT 3');
  await page.keyboard.press('F2');
  await page.locator('#inline-node-title').fill('中文检查');
  await page.locator('#inline-node-title').dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(page.locator('#inline-node-title')).toBeVisible();
  await page.locator('#inline-node-description').fill('第一行');
  await page.locator('#inline-node-description').press('End');
  await page.locator('#inline-node-description').press('Shift+Enter');
  await page.locator('#inline-node-description').pressSequentially('第二行');
  const rect = await page.locator('#stage').boundingBox();
  await page.mouse.click(rect.x + 10, rect.y + 10);
  await expect(page.locator('.node-inline-editor')).toHaveCount(0);
  const saved = (await stored(page)).nodes.find(n => n.id === 'agent3');
  expect(saved.title).toBe('中文检查'); expect(saved.description).toBe('第一行\n第二行');
  await expect(page.locator('#inspector')).toBeHidden();
});
