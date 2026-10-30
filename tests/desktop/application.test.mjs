import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exampleDocument } from '../fixtures/example.mjs';
import { serializeFile } from '../../desktop/file-format.mjs';

test('desktop opens native files, saves in place, isolates workspaces, handles conflicts and close prompts', { timeout: 90000 }, async () => {
  const base = path.resolve('.local/desktop-tests'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'DrawAI desktop 中文 '));
  const file = path.join(dir, '中文 图表.drawai'), other = path.join(dir, '另存 图表.drawai'), space = path.join(dir, '第二空间.drawai');
  const payload = { format: 'drawai', version: 1, workspaceName: '文件里的图表', document: exampleDocument(), view: { mode: 'flat', activeLayerId: 'flow' } };
  await writeFile(file, serializeFile(payload));
  const env = { ...process.env, TEMP: dir, TMP: dir, DRAWAI_DESKTOP_TEST: '1', DRAWAI_TEST_PROFILE: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('desktop/main.mjs'), file], env });
  try {
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await expect(page.locator('#desktop-save')).toBeVisible();
    await expect(page.locator('.project-heading strong')).toHaveText(payload.workspaceName);
    await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.drawaiDesktop.initial.document), 'object');
    assert.equal(await page.evaluate(async () => (await fetch('/desktop/main.mjs')).status), 404);
    await app.evaluate(({ dialog }) => { globalThis.dialogChoices = []; globalThis.savePaths = []; dialog.showMessageBox = async (_win, options) => { globalThis.lastDialog = options; return { response: globalThis.dialogChoices.shift() ?? 2 }; }; dialog.showSaveDialog = async () => { const filePath = globalThis.savePaths.shift(); return { canceled: !filePath, filePath }; }; });
    const node = page.locator('[data-node]').first();
    await node.dblclick(); await page.locator('#inline-node-title').fill('桌面编辑已保存'); await page.locator('#inline-node-title').press('Enter');
    await expect(page.locator('#save-status')).toHaveText('有未保存的修改');
    await page.locator('#desktop-save').click(); await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).document.nodes[0].title, '桌面编辑已保存');
    const exported = path.join(dir, '导出副本.drawai'), original = await readFile(file, 'utf8');
    await node.dblclick(); await page.locator('#inline-node-title').fill('导出时提交文字');
    await app.evaluate((_electron, filename) => globalThis.savePaths.push(filename), exported);
    await page.locator('#export').click(); await expect(page.locator('#toast')).toContainText('已导出 .drawai');
    assert.equal(JSON.parse(await readFile(exported, 'utf8')).document.nodes[0].title, '导出时提交文字');
    assert.equal(await readFile(file, 'utf8'), original);
    await expect(page.locator('#save-status')).toHaveAttribute('title', file);
    await expect(page.locator('#save-status')).toHaveText('有未保存的修改');
    await page.locator('#export').click(); await expect(page.locator('#export')).toBeEnabled();
    await app.evaluate((_electron, filename) => globalThis.savePaths.push(filename), file);
    await page.locator('#export').click(); await expect(page.locator('#toast')).toContainText('更新原文件请使用保存');
    assert.equal(await readFile(file, 'utf8'), original);
    await app.evaluate((_electron, filename) => globalThis.savePaths.push(filename), other);
    await page.locator('#desktop-save-as').click(); await expect(page.locator('#save-status')).toHaveAttribute('title', other);
    const savedOriginal = await readFile(file, 'utf8');
    await page.locator('#add-workspace').click(); await page.locator('#workspace-name').fill('第二工作空间'); await page.locator('#workspace-name').press('Enter');
    await page.locator('[data-template="hexagon"]').dblclick(); await page.locator('#inline-node-title').press('Enter');
    await app.evaluate((_electron, filename) => globalThis.savePaths.push(filename), space);
    await page.locator('#desktop-save').click(); await expect(page.locator('#save-status')).toHaveAttribute('title', space);
    assert.equal(JSON.parse(await readFile(space, 'utf8')).document.nodes.length, 1);
    assert.equal(await readFile(file, 'utf8'), savedOriginal);
    await page.locator('[data-workspace="default"]').click();
    await expect(page.locator('#save-status')).toHaveAttribute('title', other);
    const spaceId = await page.locator('[data-workspace]').last().getAttribute('data-workspace');
    await page.locator(`[data-rename-workspace="${spaceId}"]`).click(); await page.locator('#workspace-name').fill('后台重命名'); await page.locator('#workspace-name').press('Enter');
    const a = page.locator('[data-node]').first(); await a.dblclick(); await page.locator('#inline-node-title').fill('未覆盖外部版本'); await page.locator('#inline-node-title').press('Enter');
    await writeFile(other, '外部修改'); await page.locator('#desktop-save').click();
    await expect(page.locator('#toast')).toContainText('其他程序修改'); assert.equal(await readFile(other, 'utf8'), '外部修改');
    // Canceling a save-as keeps the original binding and unsaved state.
    await page.locator('#desktop-save-as').click(); await expect(page.locator('#save-status')).toHaveText('有未保存的修改');
    // Reopening a known file focuses its existing window/workspace, without losing edits.
    await app.evaluate(({ app }, filename) => app.emit('second-instance', {}, ['DrawAI.exe', filename], process.cwd()), space);
    await expect(page.locator('.project-heading strong')).toHaveText('后台重命名');
    await expect(page.locator('#save-status')).toHaveText('有未保存的修改');
    await page.locator('#desktop-save').click(); await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(JSON.parse(await readFile(space, 'utf8')).workspaceName, '后台重命名');
    // A different file opens independently, including paths containing spaces and Chinese.
    await app.evaluate(({ app }, filename) => app.emit('second-instance', {}, ['DrawAI.exe', filename], process.cwd()), file);
    await expect.poll(async () => (await app.windows()).length).toBe(2);
    const second = (await app.windows()).find(p => p !== page);
    await expect(second.locator('#desktop-save')).toBeVisible(); await expect(second.locator('[data-node]').first()).toContainText('桌面编辑已保存');
    // Pending inline edits are committed before the close prompt. Cancel preserves the window.
    await page.locator('[data-workspace="default"]').click();
    await page.locator('[data-node]').first().dblclick(); await page.locator('#inline-node-title').fill('关闭前输入');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getTitle().includes('DrawAI') && w.id === 1)?.close());
    await expect.poll(async () => app.evaluate(() => globalThis.lastDialog?.message)).toBe('保存修改后关闭？');
    assert.equal(page.isClosed(), false);
    await expect(page.locator('[data-node]').first()).toContainText('关闭前输入');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.resolve('test-results/desktop-native.png') });
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
