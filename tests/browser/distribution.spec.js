import { test, expect } from '@playwright/test';

test('web stays drawing-only even when previous AI settings exist', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('drawai.ai.settings.v1', JSON.stringify({address:'https://example.invalid/v1',model:'previous'})));
  await page.goto('/');
  await expect(page.locator('.scene-layer')).toHaveCount(1);
  await expect(page.locator('#ai-toggle,#ai-panel')).toHaveCount(0);
  await page.locator('[data-template="rounded"]').dblclick();
  await page.locator('#inline-node-title').fill('手工绘图');
  await page.locator('#inline-node-title').press('Enter');
  await page.reload();
  await expect(page.locator('.node-title')).toContainText('手工绘图');
  await expect(page.locator('#ai-toggle,#ai-panel')).toHaveCount(0);
});
