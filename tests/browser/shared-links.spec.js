import { test, expect, fitFixture } from './fixtures.mjs';
import { exampleDocument } from '../fixtures/example.mjs';
const key = 'drawai.document.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function linkPoint(page, id) {
  return page.locator(`[data-edge="relation-${id}"] .data-link-line`).evaluate(el => {
    for (let t = .4; t < .95; t += .05) {
      const local = el.getPointAtLength(el.getTotalLength() * t), p = new DOMPoint(local.x, local.y).matrixTransform(el.getScreenCTM());
      if (document.elementFromPoint(p.x, p.y)?.closest('[data-edge]') === el.parentElement) return { x: p.x, y: p.y };
    }
    throw new Error('No exposed shared-link hit target');
  });
}
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('all three dashed shared links can be selected without opening a panel or rotating the scene', async ({ page }) => {
  await page.locator('#camera-toggle').click(); await page.locator('#yaw').fill('0'); await page.locator('#tilt').fill('78'); await page.locator('#camera-close').click();
  const matrix = await page.locator('[data-scene-layer="flow"]').getAttribute('transform');
  const bounds = await page.locator('#stage').boundingBox();
  for (const id of ['agent2', 'agent3', 'agent4']) {
    const p = await linkPoint(page, id);
    await page.mouse.click(p.x + 5, p.y);
    await expect(page.locator(`[data-edge="relation-${id}"]`)).toHaveClass(/selected/);
    await expect(page.locator('.data-link.selected')).toHaveCount(1);
    await expect(page.locator('#relation-actions')).toBeVisible();
    await expect(page.locator('#inspector')).toBeHidden();
    await expect(page.locator('[data-resize]')).toHaveCount(0);
  }
  expect(await page.locator('#stage').boundingBox()).toEqual(bounds);
  expect(await page.locator('[data-scene-layer="flow"]').getAttribute('transform')).toBe(matrix);
  await page.screenshot({ path: 'test-results/shared-link-selected.png' });
});

test('shared link label edits in place, respects IME and Escape, persists and supports undo', async ({ page }) => {
  const p = await linkPoint(page, 'agent3'); await page.mouse.dblclick(p.x, p.y);
  await expect(page.locator('#inline-edge-label')).toHaveValue('读取 / 回写');
  await expect(page.locator('#inspector')).toBeHidden();
  await page.locator('#inline-edge-label').fill('取消此文字'); await page.locator('#inline-edge-label').press('Escape');
  await expect(page.locator('[data-edge="relation-agent3"] .edge-label')).toHaveText('读取 / 回写');
  await page.keyboard.press('F2'); await page.locator('#inline-edge-label').fill('回写检查结果');
  await page.locator('#inline-edge-label').dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(page.locator('#inline-edge-label')).toBeVisible();
  await page.locator('#inline-edge-label').press('Enter');
  expect((await stored(page)).edges.find(e => e.id === 'relation-agent3').label).toBe('回写检查结果');
  await page.locator('#undo').click(); await expect(page.locator('[data-edge="relation-agent3"] .edge-label')).toHaveText('读取 / 回写');
  await page.locator('#redo').click(); await page.reload();
  await expect(page.locator('[data-edge="relation-agent3"] .edge-label')).toHaveText('回写检查结果');
  expect((await stored(page)).tables[0].cells).toEqual(exampleDocument().tables[0].cells);
});

test('Delete and toolbar remove an aggregate shared link and undo restores all its checklist associations', async ({ page }) => {
  const fixture = exampleDocument();
  await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key, fixture }); await page.reload();
  Object.assign(fixture,await fitFixture(page,fixture));
  const p = await linkPoint(page, 'agent2'); await page.mouse.click(p.x, p.y); await page.keyboard.press('Delete');
  await expect(page.locator('[data-edge="relation-agent2"]')).toHaveCount(0);
  const saved = await stored(page);
  expect(saved.tables).toEqual(fixture.tables);
  expect(saved.nodes).toEqual(fixture.nodes); expect(saved.edges).toEqual(fixture.edges.filter(e => e.id !== 'relation-agent2'));
  await page.locator('#undo').click(); expect((await stored(page)).tables[0].cells).toEqual(fixture.tables[0].cells);
  const q = await linkPoint(page, 'agent2'); await page.mouse.click(q.x, q.y); await page.locator('#delete-relation').click();
  await expect(page.locator('.data-link')).toHaveCount(2); await expect(page.locator('#relation-actions')).toBeHidden();
  await page.locator('#undo').click(); await page.reload(); expect((await stored(page)).tables[0].cells).toEqual(fixture.tables[0].cells);
});

test('hidden shared links cannot be deleted and flat same-layer relations remain selectable', async ({ page }) => {
  const p = await linkPoint(page, 'agent4'); await page.mouse.click(p.x, p.y);
  await page.locator('#show-relations').uncheck(); await expect(page.locator('#relation-actions')).toBeHidden();
  await page.keyboard.press('Delete'); await page.locator('#show-relations').check();
  await expect(page.locator('.data-link')).toHaveCount(3); await expect(page.locator('.diagram-node')).toHaveCount(12);
  const fixture = exampleDocument(); fixture.tables[0] = { ...fixture.tables[0], layerId: 'flow', x: -680, y: 500, width: 700, height: 180 };
  await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key, fixture }); await page.reload(); await page.locator('#view-flat').click();
  const q = await linkPoint(page, 'agent2'); await page.mouse.click(q.x, q.y);
  await expect(page.locator('[data-edge="relation-agent2"]')).toHaveClass(/selected/);
  await page.locator('#edit-relation-text').click(); await page.locator('#inline-edge-label').fill('读取库存');
  await page.locator('#view-spatial').click();
  expect((await stored(page)).edges.find(e => e.id === 'relation-agent2').label).toBe('读取库存');
});
