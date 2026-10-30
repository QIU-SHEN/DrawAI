import { exampleDocument } from '../fixtures/example.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchWebView, native, pause } from './helpers.mjs';
import { validateFile } from '../../desktop/file-format.mjs';

test('fresh app is blank and native theme menu changes only accents, remembers selection and never edits diagrams', { timeout: 60000 }, async () => {
  let host = await launchWebView(); const directory = host.directory;
  try {
    let page = host.page;
    await expect(page.locator('.scene-layer')).toHaveCount(1);
    await expect(page.locator('.diagram-node,.shared-table,.flow-edge,.data-link,.empty-layer-title')).toHaveCount(0);
    await expect(page.locator('.project-heading strong')).toHaveText('工作空间 1');
    await expect(page.locator('#view-flat')).toHaveAttribute('aria-pressed', 'true');
    const status = await page.locator('#save-status').textContent();
    assert.deepEqual((await native(page, 'theme-menu')).map(i => i.label), ['经典粉', '天空蓝', '薄荷绿', '柔和紫', '暖杏橙']);
    await page.screenshot({ path: path.resolve('releases/webview2-blank.png') });
    for (const [label, color] of [['天空蓝','#7fa9ec'], ['薄荷绿','#7fc5a4'], ['柔和紫','#b397df'], ['暖杏橙','#e8ad7d'], ['经典粉','#ec7fa4']]) {
      await native(page, 'theme', label);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'))).toBe(color);
      assert.equal(await page.locator('.plane-surface').evaluate(e => getComputedStyle(e).fill), 'rgb(242, 242, 242)');
      await expect(page.locator('#save-status')).toHaveText(status);
      assert.equal((await native(page, 'theme-menu')).filter(i => i.selected)[0].label, label);
    }
    await page.locator('[data-template="rounded"]').dblclick(); await page.locator('#inline-node-title').press('Enter');
    const file = path.join(directory, '自己的图.drawai'); await native(page, 'save-path', file); await page.locator('#desktop-save').click();
    await expect(page.locator('#save-status')).toHaveText('已保存到文件'); const before = await readFile(file, 'utf8');
    await native(page, 'theme', '天空蓝'); await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(await readFile(path.join(directory, 'profile/theme.txt'), 'utf8'), '#7fa9ec');
    await host.stop(); host = await launchWebView(undefined, directory); page = host.page;
    await expect(page.locator('.scene-layer')).toHaveCount(1); await expect(page.locator('.diagram-node,.shared-table')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'))).toBe('#7fa9ec');
    await page.screenshot({ path: path.resolve('releases/webview2-theme-blue.png') });
  } finally { await host.stop(); }
});

test('WebView2 native editor opens, edits, saves, isolates windows/spaces and guards external changes', { timeout: 120000 }, async () => {
  const base = path.resolve('.local/webview2-tests'); await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, '图表测试 '));
  const file = path.join(dir, '中文 文件.drawai'), other = path.join(dir, '另存为.drawai'), spaceFile = path.join(dir, '第二空间.drawai');
  await writeFile(file, JSON.stringify({ format: 'drawai', version: 1, workspaceName: '测试图表', document: exampleDocument(), view: { mode: 'spatial' } }));
  const host = await launchWebView(file), page = host.page;
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await expect(page.locator('#desktop-save')).toBeVisible(); await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(await page.evaluate(() => window.drawaiDesktop.engine), 'webview2');
    assert.equal(await page.evaluate(async () => (await fetch('/Program.cs')).status), 404);
    await page.locator('#view-flat').click(); await page.locator('[data-node]').first().dblclick();
    await page.locator('#inline-node-title').fill('WebView2 编辑保存'); await page.locator('#inline-node-title').press('Enter');
    await expect(page.locator('#save-status')).toHaveText('有未保存的修改');
    await page.locator('#desktop-save').click(); await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).document.nodes[0].title, 'WebView2 编辑保存');
    assert.equal(validateFile(JSON.parse(await readFile(file,'utf8'))).document.nodes[0].title, 'WebView2 编辑保存');
    await native(page, 'save-path', other); await page.locator('#desktop-save-as').click(); await expect(page.locator('#save-status')).toHaveAttribute('title', other);
    await page.locator('#add-workspace').click(); await page.locator('#workspace-name').fill('第二工作空间'); await page.locator('#workspace-name').press('Enter');
    await page.locator('[data-template="hexagon"]').dblclick(); await page.locator('#inline-node-title').press('Enter');
    await native(page, 'save-path', spaceFile); await page.keyboard.press('Control+s'); await expect(page.locator('#save-status')).toHaveAttribute('title', spaceFile);
    assert.equal(JSON.parse(await readFile(spaceFile, 'utf8')).document.nodes.length, 1);
    await page.locator('[data-workspace="default"]').click(); await expect(page.locator('#save-status')).toHaveAttribute('title', other);
    await page.locator('[data-node]').first().dblclick(); await page.locator('#inline-node-title').fill('保留未保存内容'); await page.locator('#inline-node-title').press('Enter');
    await writeFile(other, '外部修改'); await page.locator('#desktop-save').click(); await expect(page.locator('#toast')).toContainText('其他程序修改');
    assert.equal(await readFile(other, 'utf8'), '外部修改');
    await page.locator('#desktop-save-as').click(); await expect(page.locator('#save-status')).toHaveText('有未保存的修改');
    await host.second(spaceFile); await expect(page.locator('.project-heading strong')).toHaveText('第二工作空间');
    await host.second(file);
    await expect.poll(() => host.browser.contexts().flatMap(c => c.pages()).length).toBe(2);
    const second = host.browser.contexts().flatMap(c => c.pages()).find(p => p !== page);
    await expect(second.locator('#desktop-save')).toBeVisible(); await second.locator('#view-flat').click();
    await expect(second.locator('[data-node]').first()).toContainText('WebView2 编辑保存');
    await host.second(file); assert.equal(host.browser.contexts().flatMap(c => c.pages()).length, 2);
    // Export commits inline edits into a compatible copy, without saving/rebinding the source.
    await expect(second.locator('#export-html')).toHaveCount(0);
    await expect(second.locator('#export')).toHaveText('导出文件 ↗');
    const original = await readFile(file, 'utf8'), exported = path.join(dir, '导出副本.drawai');
    await second.locator('[data-node]').first().dblclick(); await second.locator('#inline-node-title').fill('仅在副本里的修改');
    await native(second, 'save-path', exported); await second.locator('#export').click();
    await expect(second.locator('#toast')).toContainText('已导出 .drawai');
    assert.equal(validateFile(JSON.parse(await readFile(exported, 'utf8'))).document.nodes[0].title, '仅在副本里的修改');
    assert.equal(await readFile(file, 'utf8'), original);
    await expect(second.locator('#save-status')).toHaveAttribute('title', file);
    await expect(second.locator('#save-status')).toHaveText('有未保存的修改');
    await second.locator('#export').click(); // Cancel: no selected output path.
    await expect(second.locator('#export')).toBeEnabled();
    await expect(second.locator('#save-status')).toHaveAttribute('title', file);
    await native(second, 'save-path', file); await second.locator('#export').click();
    await expect(second.locator('#toast')).toContainText('更新原文件请使用保存');
    assert.equal(await readFile(file, 'utf8'), original);
    await host.second(exported);
    await expect.poll(() => host.browser.contexts().flatMap(c => c.pages()).length).toBe(3);
    const reopened = host.browser.contexts().flatMap(c => c.pages()).find(p => p !== page && p !== second);
    await expect(reopened.locator('[data-node]').first()).toContainText('仅在副本里的修改');
    await expect(reopened.locator('#view-flat')).toHaveAttribute('aria-pressed', 'true');
    await second.locator('#desktop-save').click(); await expect(second.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).document.nodes[0].title, '仅在副本里的修改');
    // Closing commits unsubmitted inline edits, then Cancel keeps the window and data.
    await page.locator('[data-workspace="default"]').click(); await page.locator('[data-node]').first().dblclick(); await page.locator('#inline-node-title').fill('关闭前未提交');
    await native(page, 'answer', 'Cancel'); await native(page, 'close'); await expect(page.locator('#inline-node-title')).toHaveCount(0); await expect(page.locator('[data-node]').first()).toContainText('关闭前未提交');
    assert.equal(page.isClosed(), false);
    // Invalid native files do not replace the current graph or silently become editable.
    const invalid = path.join(dir, '错误.drawai'); await writeFile(invalid, '{"format":"drawai","version":999}');
    await native(page, 'open-path', invalid); await page.locator('#desktop-open').click();
    await expect.poll(async () => (await native(page, 'error')).message).toContain('不是支持');
    await expect(page.locator('[data-node]').first()).toContainText('关闭前未提交');
    // Close with Save commits to a new file and really closes the window.
    const closeSaved = path.join(dir, '关闭保存.drawai'); await native(page, 'save-path', closeSaved); await page.locator('#desktop-save-as').click();
    await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    await page.locator('[data-node]').first().dblclick(); await page.locator('#inline-node-title').fill('关闭时保存成功');
    await native(page, 'answer', 'Yes'); await native(page, 'close'); await expect.poll(() => page.isClosed()).toBe(true);
    assert.equal(JSON.parse(await readFile(closeSaved, 'utf8')).document.nodes[0].title, '关闭时保存成功');
    assert.deepEqual(errors, []);
    await second.bringToFront(); await second.screenshot({ path: path.resolve('releases/webview2-preview.png') });
  } finally { await host.stop(); }
});

test('WebView2 keeps graph movement, resize, arrows, editable tables and 3D rotation', { timeout: 90000 }, async () => {
  const base = path.resolve('.local/webview2-tests'); await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, '交互 '));
  const file = path.join(dir, '画布.drawai'); await writeFile(file, JSON.stringify({ format: 'drawai', version: 1, workspaceName: '测试图表', document: exampleDocument(), view: { mode: 'spatial' } }));
  const host = await launchWebView(file), page=host.page;
  const position = (selector,x,y) => page.locator(selector).evaluate(async(el,p)=>{const {elementScreenPoint}=await import("/src/scene.js");const q=elementScreenPoint(el,p);return {x:q.x,y:q.y};},{x,y});
  const drag = async(a,b)=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();};
  const saved = async()=>{await page.locator('#desktop-save').click();await expect(page.locator('#save-status')).toHaveText('已保存到文件');return JSON.parse(await readFile(file,'utf8')).document;};
  try {
    await expect(page.locator('#desktop-save')).toBeVisible();await page.locator('#view-flat').click();await page.locator('#tool-drag').click();
    const before=JSON.parse(await readFile(file,'utf8')).document, p=await position('[data-node="agent2"]',0,0), view=await page.locator('#scene').getAttribute('viewBox');
    await drag(p,{x:p.x+35,y:p.y+20});assert.notEqual((await saved()).nodes.find(n=>n.id==='agent2').x,before.nodes.find(n=>n.id==='agent2').x);assert.equal(await page.locator('#scene').getAttribute('viewBox'),view);
    await page.locator('#undo').click();await page.locator('[data-list-node="agent2"]').click();
    await drag(await position('[data-node="agent2"]',100,56),await position('[data-node="agent2"]',170,96));
    assert.ok((await saved()).nodes.find(n=>n.id==='agent2').width>260);await page.locator('#undo').click();
    await page.locator('[data-list-node="standard"]').click();
    await drag(await position('[data-node="standard"]',0,-93),await position('[data-node="retake"]',-70,0));
    assert.ok((await saved()).edges.some(e=>e.source==='standard'&&e.target==='retake'));
    await page.locator('[data-select-layer="data"]').click();await page.locator('[data-list-node="table-shared"]').click();await page.keyboard.press('F2');
    await page.locator('[data-table-title]').fill('WebView2 自由表格');await page.locator('[data-cell="0,0"]').fill('编辑内容');await page.locator('[data-table-save]').click();
    const table=(await saved()).tables.find(t=>t.id==='table-shared');assert.equal(table.title,'WebView2 自由表格');assert.equal(table.cells[0][0],'编辑内容');
    await page.locator('#view-spatial').click();const tilt=await page.locator('#tilt').inputValue(),box=await page.locator('#scene').boundingBox();
    await drag({x:box.x+15,y:box.y+15},{x:box.x+130,y:box.y+70});assert.notEqual(await page.locator('#tilt').inputValue(),tilt);
    await page.locator('#desktop-save').click();await expect(page.locator('#save-status')).toHaveText('已保存到文件');
    assert.equal(JSON.parse(await readFile(file,'utf8')).view.mode,'spatial');
    await expect(page.locator('#inspector')).toBeHidden();
  } finally { await host.stop(); }
});
