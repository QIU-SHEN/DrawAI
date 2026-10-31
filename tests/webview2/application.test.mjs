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
    await expect.poll(async()=>JSON.parse(await readFile(file,'utf8')).view.mode).toBe('spatial');
    await expect(page.locator('#inspector')).toBeHidden();
  } finally { await host.stop(); }
});


test('WebView2 native AI supports images, undo, errors and cancellation without browser CORS', { timeout: 60000 }, async () => {
  const { mockAPI, nativeAIExercise } = await import('../fixtures/ai.mjs');
  const api = await mockAPI(), host = await launchWebView();
  try { await nativeAIExercise(host.page, api); } finally { await host.stop(); await api.close(); }
});

test('AI logs persist raw responses and parse failures, redact secrets/images, survive restart and stay bounded', { timeout: 90000 }, async () => {
  const { mockAPI, configureAI, promptAI, imageFile } = await import('../fixtures/ai.mjs');
  const { readdir } = await import('node:fs/promises');
  const api = await mockAPI(); let host = await launchWebView(); const directory = host.directory;
  const logFolder = path.join(directory, 'profile', 'logs', 'ai');
  const logs = async () => (await readdir(logFolder)).filter(n=>n.endsWith('.json')).sort().reverse();
  const readLatest = async () => JSON.parse(await readFile(path.join(logFolder,(await logs())[0]),'utf8'));
  try {
    const page = host.page;
    api.setHandler((call,res) => { const image=call.body.messages.find(m=>Array.isArray(m.content)).content[1].image_url.url; res.end(JSON.stringify({choices:[{message:{content:'这是普通文字，不是 JSON。 test-only-secret query-secret-123 ' + image}}]})); });
    await configureAI(page,api.url+'?api_key=query-secret-123');
    await page.locator('#ai-image-file').setInputFiles(imageFile);
    await expect(page.locator('#ai-images img')).toHaveCount(1);
    await promptAI(page,'生成这个');
    await expect(page.locator('#ai-status')).toContainText('请求编号');
    await expect(page.locator('#ai-send')).toBeEnabled();
    let entry = await readLatest();
    assert.equal(entry.httpStatus,200); assert.equal(entry.outcome,'error'); assert.equal(entry.imageCount,1);
    assert.match(entry.error,/SyntaxError/); assert.match(entry.responseBody,/这是普通文字/);
    const raw=JSON.stringify(entry); assert.ok(!raw.includes('test-only-secret')); assert.ok(!raw.includes('query-secret-123')); assert.ok(!raw.includes(imageFile.buffer.toString('base64')));
    assert.equal(entry.endpoint,api.url+'/chat/completions'); assert.equal(entry.messageCount,7);
    await page.locator('#ai-view-logs').click(); await expect(page.locator('#ai-log-content')).toHaveValue(/模型内容 message.content/);
    await expect(page.locator('#ai-log-content')).toHaveValue(/这是普通文字/);
    await page.locator('#ai-log-close').click();
    api.setHandler((_call,res)=>{res.writeHead(401);res.end('{"error":{"message":"bad credentials"}}');});
    await promptAI(page,'再次生成'); await expect(page.locator('#ai-status')).toContainText('401');await expect(page.locator('#ai-send')).toBeEnabled();
    entry=await readLatest();assert.equal(entry.httpStatus,401);assert.match(entry.responseBody,/bad credentials/);
    api.setHandler(()=>{});await promptAI(page,'取消这个请求');await expect.poll(()=>api.calls.length).toBe(5);await page.locator('#ai-stop').click();await expect(page.locator('#ai-send')).toBeEnabled();assert.equal((await readLatest()).outcome,'canceled');
    api.setHandler((_call,res)=>res.end('x'.repeat(2*1024*1024+100)));
    await promptAI(page,'过大回复');await expect(page.locator('#ai-status')).toContainText('过大');await expect(page.locator('#ai-send')).toBeEnabled();assert.equal((await readLatest()).responseTruncated,true);
    // Direct bridge calls exercise log retention without GUI timing noise.
    api.setHandler((_call,res)=>res.end('not-json'));
    for(let i=0;i<21;i++) await page.evaluate(async ({endpoint,id})=>{await window.drawaiDesktop.aiRequest({id,endpoint,key:'',body:JSON.stringify({model:'m',messages:[],stream:false})});await window.drawaiDesktop.aiLogResult({id,outcome:'error',error:'parse failure'});},{endpoint:api.url+'/chat/completions',id:'retention-'+i});
    assert.equal((await logs()).length,20);
    const rejected=await page.evaluate(()=>window.drawaiDesktop.aiLogs('read','../../theme.txt'));assert.match(rejected.error,/无效/);
    await host.stop();host=await launchWebView(undefined,directory);
    await host.page.locator('#ai-toggle').click();await host.page.locator('#ai-view-logs').click();
    await expect(host.page.locator('#ai-log-files option')).toHaveCount(20);await expect(host.page.locator('#ai-log-content')).toHaveValue(/not-json/);
  } finally {await host.stop();await api.close();}
});

test('unwritable AI logs report failure without blocking drawing', { timeout: 30000 }, async () => {
  const { mockAPI, configureAI, promptAI } = await import('../fixtures/ai.mjs');
  const api=await mockAPI(), host=await launchWebView();
  try {
    const dir=path.join(host.directory,'profile','logs');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'ai'),'not a directory');
    await configureAI(host.page,api.url);await promptAI(host.page,'画审批流程');
    await expect(host.page.locator('[data-node="submit"]')).toBeVisible();
    await expect(host.page.locator('#ai-status')).toContainText('日志写入失败');
    await expect(host.page.locator('#ai-send')).toBeEnabled();
  } finally {await host.stop();await api.close();}
});

test('identical AI table duplicates apply once and undo together; conflicts identify fields', {timeout:30000}, async()=>{
  const {mockAPI,configureAI,promptAI,completion,generated}=await import('../fixtures/ai.mjs');
  const api=await mockAPI(),host=await launchWebView();
  try {
    const doc=generated(),table={id:'t1',layerId:'flow',title:'资料',x:-300,y:240,width:720,height:200,columns:['项目'],cells:[['内容']]};
    doc.tables.push(table);doc.nodes.push({...table,kind:'table'});doc.edges.push({id:'e2',source:'review',target:'t1',label:'记录',style:'dashed'});
    api.setHandler((_req,res)=>res.end(JSON.stringify(completion(doc))));
    await configureAI(host.page,api.url);await promptAI(host.page,'生成带表格的流程');
    await expect(host.page.locator('.diagram-node')).toHaveCount(2);await expect(host.page.locator('.shared-table')).toHaveCount(1);await expect(host.page.locator('#ai-messages')).toContainText('合并 1 处');
    await host.page.locator('#ai-undo').click();await expect(host.page.locator('.diagram-node,.shared-table')).toHaveCount(0);
    doc.nodes[2].cells=[['不同内容']];await promptAI(host.page,'冲突表格');await expect(host.page.locator('#ai-status')).toContainText('nodes[2] 与 tables[0]');await expect(host.page.locator('#ai-send')).toBeEnabled();await expect(host.page.locator('.diagram-node,.shared-table')).toHaveCount(0);
  }finally{await host.stop();await api.close();}
});

test('native AI repairs table width through model and logs each attempt separately', {timeout:30000},async()=>{
  const {mockAPI,configureAI,promptAI,completion,generated,imageFile}=await import('../fixtures/ai.mjs');
  const {readdir}=await import('node:fs/promises');const api=await mockAPI(),host=await launchWebView();
  try{
    const doc=generated();doc.tables.push({id:'t1',layerId:'flow',title:'资料',x:0,y:220,width:200,height:120,columns:['项目'],cells:[['内容']]});
    api.setHandler((_call,res)=>{const reply=structuredClone(doc);if(api.calls.length===2)reply.tables[0].width=320;res.end(JSON.stringify(completion(reply)));});
    await configureAI(host.page,api.url);await host.page.locator('#ai-image-file').setInputFiles(imageFile);await expect(host.page.locator('#ai-images img')).toHaveCount(1);
    await promptAI(host.page,'按图片生成');await expect(host.page.locator('#ai-send')).toBeEnabled();await expect(host.page.locator('.shared-table')).toHaveCount(1);
    assert.equal(api.calls.length,2);assert.match(api.calls[1].body.messages.at(-1).content,/tables\[0\]\.width/);assert.deepEqual(api.calls[1].body.messages.slice(0,3),api.calls[0].body.messages);
    const folder=path.join(host.directory,'profile','logs','ai');const names=(await readdir(folder)).filter(n=>n.endsWith('.json')).sort();assert.equal(names.length,2);
    const entries=await Promise.all(names.map(n=>readFile(path.join(folder,n),'utf8').then(JSON.parse)));assert.equal(entries[0].outcome,'retry');assert.match(entries[0].error,/尝试 1\/3/);assert.match(entries[0].error,/tables\[0\]\.width/);assert.equal(entries[1].outcome,'success');assert.match(entries[1].error,/尝试 2\/3/);
    assert.equal(entries[0].error.split('；')[0],entries[1].error.split('；')[0]);assert.notEqual(entries[0].requestId,entries[1].requestId);
    const file=path.join(host.directory,'模型修正.drawai');await native(host.page,'save-path',file);await host.page.locator('#desktop-save').click();await expect(host.page.locator('#save-status')).toHaveText('已保存到文件');assert.equal(JSON.parse(await readFile(file,'utf8')).document.tables[0].width,320);
    await host.page.locator('#ai-undo').click();await expect(host.page.locator('.diagram-node,.shared-table')).toHaveCount(0);
  }finally{await host.stop();await api.close();}
});
