import { test as base, expect } from '@playwright/test';
import { exampleDocument } from '../fixtures/example.mjs';
// Regression cases explicitly load a fixture; the shipped app starts blank.
export const test = base.extend({ page: async ({ page }, use) => {
  await page.addInitScript(doc => {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const key = 'drawai.document.v1';
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(doc));
        localStorage.setItem(key + '.workspaces', JSON.stringify({ version: 1, activeId: 'default', items: [{ id: 'default', name: '门店陈列检查', view: { mode: 'spatial' } }] }));
      }
    } catch { }
  }, exampleDocument());
  await use(page);
} });
export { expect };
