import { test, expect } from './fixtures.mjs';
test.beforeEach(async ({ page }) => { await page.goto('/'); });
async function camera(page, tilt) {
  await page.locator('#camera-toggle').click(); await page.locator('#tilt').fill(String(tilt)); await page.locator('#camera-close').click();
}

test('shared-link text is horizontal at its curve midpoint without a pill and edits in that position', async ({ page }) => {
  await camera(page, 78);
  const group = page.locator('[data-edge="relation-agent4"]');
  await expect(group.locator('.edge-label rect')).toHaveCount(0);
  const geometry = await group.evaluate(el => {
    const path = el.querySelector('.data-link-line'), text = el.querySelector('.edge-label');
    const first = path.getPointAtLength(0), last = path.getPointAtLength(path.getTotalLength());
    const m = text.getScreenCTM();
    return { x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')), midpoint: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }, b: m.b, c: m.c };
  });
  expect(geometry.x).toBeCloseTo(geometry.midpoint.x, 1); expect(geometry.y).toBeCloseTo(geometry.midpoint.y, 1);
  expect(geometry.b).toBe(0); expect(geometry.c).toBe(0);
  await group.locator('.edge-label').dblclick();
  await expect(page.locator('#inline-edge-label')).toBeFocused();
  await page.locator('#inline-edge-label').fill('直接这样显示'); await page.locator('#inline-edge-label').press('Enter');
  await page.screenshot({ path: 'test-results/shared-label-midpoint.png' });
  await camera(page, 290);
  const matrix = await group.locator('.edge-label').evaluate(el => ({ b: el.getScreenCTM().b, c: el.getScreenCTM().c }));
  expect(matrix).toEqual({ b: 0, c: 0 });
});

test('vertical orbit makes repeated full turns and crosses 0/360 continuously', async ({ page }) => {
  await page.locator('#tool-drag').click();
  const rect = await page.locator('#scene').boundingBox();
  const from = { x: rect.x + 4, y: rect.y + 430 };
  const initial = await page.locator('[data-layer-content="flow"]').getAttribute('transform');
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x, from.y - 300, { steps: 8 }); await page.mouse.up();
    await expect(page.locator('#tilt')).toHaveValue(String((55 + (i + 1) * 60) % 360));
  }
  expect(await page.locator('[data-layer-content="flow"]').getAttribute('transform')).toBe(initial);
  await camera(page, 350);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x, from.y - 150, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('#tilt')).toHaveValue('20');
  await page.mouse.move(from.x, from.y - 150); await page.mouse.down(); await page.mouse.move(from.x, from.y, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('#tilt')).toHaveValue('350');
});

test('full pitch range changes plane depth order and keeps edge-on rendering finite', async ({ page }) => {
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  for (const tilt of [0, 90, 135, 180, 270, 315, 360]) {
    await camera(page, tilt);
    await expect(page.locator('#tilt')).toHaveValue(String(tilt));
    const scene = await page.locator('#scene').innerHTML(); expect(scene).not.toMatch(/NaN|Infinity/);
    const order = await page.locator('[data-layer-stack]').evaluateAll(els => els.map(el => el.dataset.layerStack));
    if ([135, 180].includes(tilt)) expect(order).toEqual(['flow', 'data']);
    if ([0, 315, 360].includes(tilt)) expect(order).toEqual(['data', 'flow']);
  }
  expect(errors).toEqual([]);
  await camera(page, 140); await page.screenshot({ path: 'test-results/orbit-backside.png' });
  await page.locator('#fit').click(); await expect(page.locator('#tilt')).toHaveValue('55');
});
