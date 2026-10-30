import { test, expect } from './fixtures.mjs';
import { exampleDocument } from '../fixtures/example.mjs';
const key = 'drawai.document.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function point(page, selector, x = 0, y = 0) {
  return page.locator(selector).evaluate((el, { x, y }) => {
    const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()); return { x: p.x, y: p.y };
  }, { x, y });
}
async function dragTo(page, a, b) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); });

for (const mode of ['flat', 'spatial']) test(`eight handles resize with fixed opposite corner and connected edges follow in ${mode}`, async ({ page }) => {
  await page.locator(`#view-${mode}`).click();
  await page.locator('[data-list-node="agent2"]').click();
  const node = page.locator('[data-node="agent2"]');
  await expect(node.locator('[data-resize]')).toHaveCount(8);
  const a = await point(page, '[data-node="agent2"]', 100, 56);
  const b = await point(page, '[data-node="agent2"]', 170, 96);
  const edgeBefore = await page.locator('[data-edge="edge-4"] .edge-line').getAttribute('d');
  await dragTo(page, a, b);
  const saved = (await stored(page)).nodes.find(n => n.id === 'agent2');
  expect(saved.width).toBeCloseTo(270, 0); expect(saved.height).toBeCloseTo(152, 0);
  expect(saved.x - saved.width / 2).toBe(-495); expect(saved.y - saved.height / 2).toBe(-56);
  expect(await page.locator('[data-edge="edge-4"] .edge-line').getAttribute('d')).not.toBe(edgeBefore);
  await expect(page.locator('#inspector')).toBeHidden();
  await page.screenshot({ path: `test-results/resize-${mode}.png` });
  await page.locator('#undo').click();
  expect((await stored(page)).nodes.find(n => n.id === 'agent2').width).toBeUndefined();
  await page.locator('#redo').click(); await page.reload();
  expect((await stored(page)).nodes.find(n => n.id === 'agent2').width).toBe(saved.width);
});

for (const mode of ['flat', 'spatial']) test(`drag a directional arrow to connect; edit its label in place in ${mode}`, async ({ page }) => {
  await page.locator(`#view-${mode}`).click();
  await page.locator('[data-list-node="standard"]').click();
  const a = await point(page, '[data-node="standard"]', 0, -93);
  const b = await point(page, '[data-node="retake"]', -70, 0);
  await dragTo(page, a, b);
  const saved = await stored(page), edge = saved.edges.find(e => e.source === 'standard' && e.target === 'retake');
  expect(edge.sourcePort).toBe('n'); expect(edge.targetPort).toBe('w');
  await expect(page.locator('#inspector')).toBeHidden();
  const edgePoint = await page.locator(`[data-edge="${edge.id}"] .edge-line`).evaluate(el => {
    for (let t = .1; t < 1; t += .1) {
      const local = el.getPointAtLength(el.getTotalLength() * t), p = new DOMPoint(local.x, local.y).matrixTransform(el.getScreenCTM());
      if (document.elementFromPoint(p.x, p.y)?.closest('[data-edge]') === el.parentElement) return { x: p.x, y: p.y };
    }
    throw new Error('No exposed segment of the new edge');
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(page.locator('#inspector')).toBeHidden();
  await page.mouse.dblclick(edgePoint.x, edgePoint.y);
  await expect(page.locator('#inline-edge-label')).toBeFocused();
  await page.locator('#inline-edge-label').fill('需要重拍');
  await page.locator('#inline-edge-label').press('Enter');
  expect((await stored(page)).edges.find(e => e.id === edge.id).label).toBe('需要重拍');
  await page.locator('#undo').click();
  expect((await stored(page)).edges.find(e => e.id === edge.id).label).toBe('');
  await page.locator('#redo').click();
  await page.keyboard.press('Delete');
  expect((await stored(page)).edges.some(e => e.id === edge.id)).toBe(false);
  await page.locator('#undo').click();
  expect((await stored(page)).edges.find(e => e.id === edge.id).label).toBe('需要重拍');
});

test('connection drag to blank or Escape cancels without changing the document', async ({ page }) => {
  await page.locator('#view-flat').click();
  await page.locator('[data-list-node="standard"]').click();
  const a = await point(page, '[data-node="standard"]', -137, 0);
  const b = await point(page, '[data-scene-layer="flow"]', -790, -320);
  await dragTo(page, a, b);
  await expect(page.locator('.flow-edge')).toHaveCount(12);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.connection-preview')).toHaveCount(0);
  await expect(page.locator('.flow-edge')).toHaveCount(12);
});



test('3D drag moves a node to another plane with references intact; flat edit stays in that layer', async ({ page }) => {
  const a = await point(page, '[data-node="agent2"]');
  const b = await point(page, '[data-scene-layer="data"]', 550, 260);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 });
  await expect(page.locator('[data-plane-layer="data"]')).toHaveClass(/drop-plane/);
  await expect(page.locator('#palette-ghost')).toContainText('共享数据');
  await page.screenshot({ path: 'test-results/cross-layer-drag.png' });
  await page.mouse.up();
  const saved = await stored(page), moved = saved.nodes.find(n => n.id === 'agent2');
  expect(moved.layerId).toBe('data'); expect(moved.x).toBeCloseTo(550, 0); expect(moved.y).toBeCloseTo(260, 0);
  expect(saved.edges).toEqual(exampleDocument().edges); expect(saved.tables).toEqual(exampleDocument().tables);
  await page.locator('#view-flat').click();
  await expect(page.locator('.diagram-node')).toHaveCount(1);
  await expect(page.locator('[data-node="agent2"]')).toBeVisible();
  await page.locator('#undo').click();
  expect((await stored(page)).nodes.find(n => n.id === 'agent2').layerId).toBe('flow');
  await page.locator('#redo').click(); await page.reload();
  expect((await stored(page)).nodes.find(n => n.id === 'agent2').layerId).toBe('data');
});

test('3D move canceled with Escape or released outside planes leaves the node unchanged', async ({ page }) => {
  const a = await point(page, '[data-node="agent2"]');
  const b = await point(page, '[data-scene-layer="data"]', 550, 260);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await expect(page.locator('[data-node="agent2"]')).toHaveAttribute('transform', 'translate(-395,0)');
  await dragTo(page, a, { x: 10, y: 10 });
  await expect(page.locator('[data-node="agent2"]')).toHaveAttribute('transform', 'translate(-395,0)');
  await expect(page.locator('#undo')).toBeDisabled();
});

test('slightly translucent upper plane still blocks picking lower nodes in its overlap', async ({ page }) => {
  const doc = exampleDocument();
  doc.nodes.push({ id: 'under', kind: 'agent', shape: 'rounded', title: '被遮挡节点', description: '', layerId: 'data', x: 0, y: -150 });
  await page.evaluate(({ key, doc }) => localStorage.setItem(key, JSON.stringify(doc)), { key, doc }); await page.reload();
  await page.locator('#camera-toggle').click(); await page.locator('#gap').fill('250'); await page.locator('#camera-close').click();
  const p = await point(page, '[data-node="under"]');
  const hit = await page.evaluate(p => {
    const el = document.elementFromPoint(p.x, p.y);
    return { node: el.closest('[data-node]')?.dataset.node, layer: el.closest('[data-scene-layer]')?.dataset.sceneLayer };
  }, p);
  expect(hit.node).not.toBe('under'); expect(hit.layer).toBe('flow');
  expect(await page.locator('[data-plane-layer="flow"] .plane-surface').evaluate(el => getComputedStyle(el).fillOpacity)).toBe('0.85');
  await page.screenshot({ path: 'test-results/translucent-layer-overlap.png' });
  await page.locator('#view-flat').click(); await page.locator('[data-select-layer="data"]').click();
  await page.locator('[data-list-node="under"]').click();
  await expect(page.locator('[data-node="under"]')).toHaveClass(/selected/);
});

test('branch text accepts Chinese composition, cancels with Escape and saves outside', async ({ page }) => {
  await page.locator('#view-flat').click();
  const p = await page.locator('[data-edge="edge-4"] .edge-line').evaluate(el => {
    const q = el.getPointAtLength(el.getTotalLength() * .55), point = new DOMPoint(q.x, q.y).matrixTransform(el.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.dblclick(p.x, p.y);
  await page.locator('#inline-edge-label').fill('中文分支');
  await page.locator('#inline-edge-label').dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(page.locator('#inline-edge-label')).toBeVisible();
  await page.locator('#inline-edge-label').press('Escape');
  await expect(page.locator('[data-edge="edge-4"] .edge-label')).toHaveText('无缺货差异');
  await page.keyboard.press('F2'); await page.locator('#inline-edge-label').fill('确认无缺货');
  await page.locator('#view-spatial').click();
  expect((await stored(page)).edges.find(e => e.id === 'edge-4').label).toBe('确认无缺货');
  await page.reload(); await expect(page.locator('[data-edge="edge-4"] .edge-label')).toHaveText('确认无缺货');
});



test('resizing from an edge keeps height and opposite edge; Escape restores original dimensions', async ({ page }) => {
  await page.locator('#view-flat').click(); await page.locator('[data-list-node="retake"]').click();
  const a = await point(page, '[data-node="retake"]', -105, 0);
  const b = await point(page, '[data-node="retake"]', -165, 0);
  await dragTo(page, a, b);
  const saved = (await stored(page)).nodes.find(n => n.id === 'retake');
  expect(saved.width).toBe(270); expect(saved.height).toBe(140); expect(saved.x + saved.width / 2).toBe(-35);
  const c = await point(page, '[data-node="retake"]', -135, 0);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x - 35, c.y, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await stored(page)).nodes.find(n => n.id === 'retake')).toEqual(saved);
  await page.locator('#undo').click(); expect((await stored(page)).nodes.find(n => n.id === 'retake').width).toBeUndefined();
});
