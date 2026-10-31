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

// Expected baseline after opening an older file: text now expands undersized shapes.
export async function fitFixture(page, doc) {
  return page.evaluate(async doc => { const {fitNodeText}=await import('/src/scene.js');doc.nodes.forEach(fitNodeText);return doc; },doc);
}
