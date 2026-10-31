import { test, expect, fitFixture } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { createTable, validateDiagramFile } from '../../src/model.js';
import { exampleDocument } from '../fixtures/example.mjs';
const key = 'drawai.document.v1';
async function exportFile(page) {
  const pending = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await pending; expect(download.suggestedFilename()).toMatch(/\.drawai$/);
  return validateDiagramFile(JSON.parse(readFileSync(await download.path(), 'utf8')));
}

test('DrawAI export commits inline edits and round-trips every table, port, name and view', async ({ page, browser }) => {
  const doc = exampleDocument(), table = createTable('data', 700, -100);
  table.title = '第二张独立表'; table.cells[0][0] = '</script><script>window.injected=1</script> & 中文'; doc.tables.push(table);
  doc.edges[0].sourcePort = { x: 1, y: .6 };
  await page.goto('/'); await page.evaluate(({ key, doc }) => localStorage.setItem(key, JSON.stringify(doc)), { key, doc }); await page.reload();
  await expect(page.locator('#export-html')).toHaveCount(0); await expect(page.locator('#export')).toHaveText('导出文件 ↗');
  await page.locator('#view-flat').click(); await page.locator('[data-list-node="agent2"]').click(); await page.keyboard.press('F2');
  await page.locator('#inline-node-title').fill('打开时就是这张图');
  const payload = await exportFile(page);
  doc.nodes.find(n => n.id === 'agent2').title = '打开时就是这张图';
  Object.assign(doc, await fitFixture(page,doc));
  expect(payload.document).toEqual(doc); expect(payload.view.mode).toBe('flat'); expect(payload.workspaceName).toBe('门店陈列检查');
  const context = await browser.newContext(), reopened = await context.newPage(); await reopened.goto('/');
  await reopened.locator('#import-file').setInputFiles({ name: '中文图表.drawai', mimeType: 'application/octet-stream', buffer: Buffer.from('\uFEFF' + JSON.stringify(payload)) });
  await reopened.locator('#confirm-ok').click();
  await expect(reopened.locator('[data-node="agent2"]')).toContainText('打开时就是这张图');
  await expect(reopened.locator('#view-flat')).toHaveAttribute('aria-pressed', 'true');
  expect(await reopened.evaluate(() => window.injected)).toBeUndefined(); expect((await exportFile(reopened)).document).toEqual(doc);
  await reopened.locator('[data-select-layer="data"]').click(); await expect(reopened.locator('[data-table]')).toHaveCount(2);
  expect((await exportFile(reopened)).view.activeLayerId).toBe('data'); await context.close();
});

test('export works without browser storage or asset downloads; unsupported files leave graph unchanged', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Blocked'); }; });
  await page.route('**/src/portable.json', route => route.abort()); await page.goto('/');
  await page.locator('[data-template="rounded"]').dblclick();
  await page.locator('#inline-node-title').fill('存储不可用时的修改');
  const payload = await exportFile(page); expect(payload.document.nodes[0].title).toBe('存储不可用时的修改');
  await page.locator('#import-file').setInputFiles({ name: 'future.drawai', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify({ ...payload, version: 999 })) });
  await expect(page.locator('#toast')).toContainText('不是支持'); await expect(page.locator('#confirm-dialog')).not.toBeVisible();
  expect((await exportFile(page)).document).toEqual(payload.document);
});
