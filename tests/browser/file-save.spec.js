import { test, expect } from './fixtures.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { writeLegacyHtml } from './legacy-html.mjs';

async function openExport(page, browser, info, { blockedStorage = false } = {}) {
  await page.goto('/');
  await expect(page.locator('#save-original')).toBeHidden();
  const path = info.outputPath('original.html'); writeLegacyHtml(path);
  const context = await browser.newContext({ offline: true, viewport: { width: 1536, height: 960 } });
  if (blockedStorage) await context.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; });
  const file = await context.newPage();
  // Native picker/permission prompts are OS UI. Stub only that boundary and its
  // writable stream; close commits bytes to a real fixture on disk for reopening.
  await file.exposeFunction('readFixture', () => readFileSync(path, 'utf8'));
  await file.exposeFunction('writeFixture', text => writeFileSync(path, text));
  await file.addInitScript(() => {
    window.fileIO = { writes: 0, active: 0, maxActive: 0, delay: 0, fail: false, denied: false, cancel: false, wrong: false };
    window.showOpenFilePicker = async () => {
      if (fileIO.cancel) throw new DOMException('Cancelled', 'AbortError');
      return [{
        queryPermission: async () => fileIO.denied ? 'prompt' : 'granted',
        requestPermission: async () => fileIO.denied ? 'denied' : 'granted',
        getFile: async () => new File([fileIO.wrong ? '<html>unrelated</html>' : await readFixture()], 'original.html'),
        createWritable: async () => {
          if (fileIO.denied) throw new DOMException('Permission revoked', 'NotAllowedError');
          fileIO.active++; fileIO.maxActive = Math.max(fileIO.maxActive, fileIO.active);
          let content;
          return {
            write: async text => { content = text; await new Promise(resolve => setTimeout(resolve, fileIO.delay)); },
            close: async () => {
              if (fileIO.fail) throw new DOMException('Disk full', 'QuotaExceededError');
              await writeFixture(content); fileIO.writes++; fileIO.active--;
            },
            abort: async () => { fileIO.active--; },
          };
        },
      }];
    };
  });
  await file.goto(pathToFileURL(path).href);
  return { file, context, path };
}
async function editTitle(file, title) {
  await file.locator('[data-list-node="agent2"]').click(); await file.keyboard.press('F2');
  await file.locator('#inline-node-title').fill(title); await file.locator('#inline-node-title').press('Enter');
}
async function saved(file) { await expect(file.locator('#save-status')).toHaveText('已保存到原文件'); }
async function freshTitle(browser, path) {
  const context = await browser.newContext({ offline: true }); const page = await context.newPage();
  await page.goto(pathToFileURL(path).href);
  const title = await page.evaluate(() => window.__DRAWAI_FILE__.document.nodes.find(n => n.id === 'agent2').title);
  await context.close(); return title;
}

test('associated HTML automatically saves edits and undo to the same file and opens in a clean browser', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info);
  const errors = []; file.on('pageerror', error => errors.push(error.message));
  const identity = await file.evaluate(() => window.__DRAWAI_FILE__.storageKey);
  await file.locator('#save-original').click(); await saved(file);
  await editTitle(file, '已经自动写回原文件'); await saved(file);
  expect(await freshTitle(browser, path)).toBe('已经自动写回原文件');
  await file.locator('#undo').click(); await saved(file);
  expect(await freshTitle(browser, path)).toBe('AGENT 2');
  await file.locator('#redo').click(); await saved(file);
  await file.locator('[data-select-layer="data"]').click();
  await file.locator('[data-list-node="table-shared"]').click(); await file.keyboard.press('F2');
  await file.locator('[data-table-title]').fill('自动保存的表格'); await file.locator('[data-table-save]').click(); await saved(file);
  await file.screenshot({ path: info.outputPath('file-autosave.png') });
  await file.reload(); await expect(file.locator('[data-node="agent2"]')).toContainText('已经自动写回原文件');
  expect(await file.evaluate(() => window.__DRAWAI_FILE__.document.tables[0].title)).toBe('自动保存的表格');
  expect(await file.evaluate(() => window.__DRAWAI_FILE__.storageKey)).toBe(identity);
  await expect(file.locator('#save-original')).toHaveText('启用文件自动保存');
  expect(errors).toEqual([]); await context.close();
});

test('changes during an in-flight save are serialized and saved without browser storage', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info, { blockedStorage: true });
  await file.locator('#save-original').click(); await saved(file);
  await file.evaluate(() => { fileIO.delay = 1300; });
  await editTitle(file, '第一笔修改');
  await expect.poll(() => file.evaluate(() => fileIO.active)).toBe(1);
  await editTitle(file, '写入过程中再次修改');
  await saved(file);
  expect(await freshTitle(browser, path)).toBe('写入过程中再次修改');
  expect(await file.evaluate(() => fileIO.maxActive)).toBe(1);
  await context.close();
});

test('cancellation, wrong files and denied permission never overwrite the selected file', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info);
  const original = readFileSync(path, 'utf8');
  await file.evaluate(() => { fileIO.cancel = true; }); await file.locator('#save-original').click();
  await expect(file.locator('#save-original')).toBeEnabled();
  await file.evaluate(() => { fileIO.cancel = false; fileIO.wrong = true; }); await file.locator('#save-original').click();
  await expect(file.locator('#toast')).toContainText('不是当前图表的原文件');
  await file.evaluate(() => { fileIO.wrong = false; fileIO.denied = true; }); await file.locator('#save-original').click();
  await expect(file.locator('#toast')).toContainText('未获得文件写入权限');
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(await file.evaluate(() => fileIO.writes)).toBe(0);
  await expect(file.locator('#save-status')).toHaveText('仅保存在浏览器');
  await context.close();
});

test('failed write keeps the original intact, guards closing and retries the latest edit', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info);
  await file.locator('#save-original').click(); await saved(file);
  const original = readFileSync(path, 'utf8');
  await file.evaluate(() => { fileIO.fail = true; }); await editTitle(file, '写入失败后的修改');
  await expect(file.locator('#save-status')).toHaveText('原文件未保存，请重试');
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(await file.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await editTitle(file, '重试保存最新修改');
  await file.evaluate(() => { fileIO.fail = false; fileIO.denied = true; }); await file.locator('#save-original').click();
  await expect(file.locator('#toast')).toContainText('未获得文件写入权限');
  await file.evaluate(() => { fileIO.denied = false; }); await file.locator('#save-original').click(); await saved(file);
  expect(await freshTitle(browser, path)).toBe('重试保存最新修改');
  await context.close();
});

test('external file edits stop auto-overwrite and new file revisions supersede stale browser drafts', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info);
  await file.locator('#save-original').click(); await saved(file);
  await editTitle(file, '此浏览器的旧存档'); await saved(file);
  // Mimic another editor producing a new revision of the same document file.
  const current = readFileSync(path, 'utf8');
  const embedded = JSON.parse(current.match(/<script id="drawai-file" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  embedded.revision = 'external-revision'; embedded.document.nodes.find(n => n.id === 'agent2').title = '其他窗口已保存的新内容';
  const external = current.replace(/(<script id="drawai-file" type="application\/json">)[\s\S]*?(<\/script>)/, (_, start, end) => start + JSON.stringify(embedded).replace(/</g, '\\u003c') + end);
  writeFileSync(path, external);
  await editTitle(file, '不能覆盖外部修改');
  await expect(file.locator('#save-status')).toHaveText('原文件未保存，请重试');
  await expect(file.locator('#toast')).toContainText('已被其他窗口修改');
  expect(readFileSync(path, 'utf8')).toBe(external);
  file.on('dialog', dialog => dialog.accept()); await file.reload();
  await expect(file.locator('[data-node="agent2"]')).toContainText('其他窗口已保存的新内容');
  await context.close();
});

test('unsupported browser retains offline editing and DrawAI export', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info);
  await file.addInitScript(() => { window.showOpenFilePicker = undefined; }); await file.reload();
  await expect(file.locator('#save-original')).toBeDisabled();
  await expect(file.locator('.sidebar-bottom p')).toContainText('不支持原文件自动保存');
  const before = readFileSync(path, 'utf8'); await editTitle(file, '手动导出仍然可用');
  const pending = file.waitForEvent('download'); await file.locator('#export').click();
  expect((await pending).suggestedFilename()).toMatch(/\.drawai$/);
  expect(readFileSync(path, 'utf8')).toBe(before); await context.close();
});

test('switching workspaces while saving never writes the other workspace into the associated HTML', async ({ page, browser }, info) => {
  const { file, context, path } = await openExport(page, browser, info);
  await file.locator('#save-original').click(); await saved(file);
  await file.evaluate(() => { fileIO.delay = 1200; }); await editTitle(file, '原文件的最新内容');
  await expect.poll(() => file.evaluate(() => fileIO.active)).toBe(1);
  await file.locator('#add-workspace').click(); await file.locator('#workspace-name').fill('文件外的独立空间'); await file.locator('#workspace-name').press('Enter');
  await expect(file.locator('#save-original')).toBeHidden();
  await file.locator('[data-template="rounded"]').dblclick();
  await expect.poll(() => file.evaluate(() => fileIO.active)).toBe(0);
  expect(await freshTitle(browser, path)).toBe('原文件的最新内容');
  await file.locator('[data-workspace="default"]').click(); await saved(file);
  await expect(file.locator('[data-node="agent2"]')).toContainText('原文件的最新内容');
  await context.close();
});
