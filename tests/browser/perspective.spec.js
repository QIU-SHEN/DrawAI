import { test, expect } from './fixtures.mjs';

test('rendered plane converges in the distance and local coordinates match actual browser hit targets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('drawai.document.v1', JSON.stringify({ version: 3, layers: [{ id: 'plane', name: '透视' }], nodes: [], tables: [], edges: [] })));
  await page.reload();
  await page.locator('#view-spatial').click();
  await page.locator('#camera-toggle').click();
  await page.locator('#yaw').fill('0');
  await page.locator('#tilt').fill('60');
  await page.locator('#camera-close').click();
  const corners = await page.locator('[data-scene-layer="plane"] .plane').evaluate(async plane => {
    const { elementScreenPoint } = await import('/src/scene.js');
    return [[-500,-350],[500,-350],[-500,350],[500,350]].map(([x,y]) => {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('cx', x); marker.setAttribute('cy', y); marker.setAttribute('r', '.1'); plane.append(marker);
      const b = marker.getBoundingClientRect(), p = elementScreenPoint(marker, { x, y });
      const actual = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const hit = document.elementFromPoint(p.x, p.y) === marker;
      marker.remove();
      return { ...actual, error: Math.hypot(actual.x - p.x, actual.y - p.y), hit };
    });
  });
  const [farLeft, farRight, nearLeft, nearRight] = corners;
  expect(nearRight.x - nearLeft.x).toBeGreaterThan((farRight.x - farLeft.x) * 1.2);
  expect(farLeft.x).toBeGreaterThan(nearLeft.x);
  expect(farRight.x).toBeLessThan(nearRight.x);
  expect(nearLeft.y).toBeGreaterThan(farLeft.y);
  for (const corner of corners) { expect(corner.error).toBeLessThan(.1); expect(corner.hit).toBe(true); }
  await page.screenshot({ path: 'test-results/perspective-convergence.png' });
});
