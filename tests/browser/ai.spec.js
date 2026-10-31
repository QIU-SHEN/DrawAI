import { test, expect } from '@playwright/test';
import { configureAI, promptAI, imageFile, completion, generated } from '../fixtures/ai.mjs';
const address = 'https://ai.example.test/v1';
// Component tests opt into the desktop-only UI in an isolated browser harness.
// Production web pages never enable this branch; native HTTP is tested in WebView2.
test.beforeEach(async ({ page }) => {
  await page.route('**/src/app.js', async route => { const response=await route.fetch(); const source=await response.text(); expect(source).toContain("if (desktop?.engine === 'webview2')"); await route.fulfill({response,body:source.replace("if (desktop?.engine === 'webview2')",'if (true)')}); });
  await page.goto('/');
});

test('AI settings and send remain reachable on short desktop and phone screens', async ({ page }) => {
  await page.locator('#ai-toggle').click();
  for (const viewport of [{width:820,height:620},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#ai-config')).toHaveAttribute('open', '');
    await page.locator('#ai-send').scrollIntoViewIfNeeded();
    const bounds=await page.locator('#ai-send').boundingBox();
    expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
  }
});

test('image generation and follow-up yield editable nodes, history, undo, safe exports and ephemeral key', async ({ page }) => {
  const calls = [];
  await page.route(address + '/chat/completions', route => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: completion(generated(calls.length === 1 ? '提交申请' : '填写申请')) }); });
  await configureAI(page, address);
  await page.locator('#ai-image-file').setInputFiles(imageFile); await expect(page.locator('#ai-images img')).toHaveCount(1);
  await promptAI(page, '还原这张图'); await expect(page.locator('[data-node="submit"] .node-title')).toContainText('提交申请');
  expect(calls[0].messages.at(-1).content[1].image_url.url).toMatch(/^data:image\/png/);
  await promptAI(page, '把提交申请改成填写申请'); await expect(page.locator('[data-node="submit"] .node-title')).toContainText('填写申请');
  expect(calls[1].messages.at(-2).content).toContain('提交申请'); expect(calls[1].messages.some(m => typeof m.content === 'string' && m.content.includes('还原这张图'))).toBeTruthy();
  await page.locator('#ai-undo').click(); await expect(page.locator('[data-node="submit"] .node-title')).toContainText('提交申请');
  await page.locator('#ai-undo').click(); await expect(page.locator('.diagram-node')).toHaveCount(0);
  await page.locator('#redo').click(); await expect(page.locator('.diagram-node')).toHaveCount(2);
  const download = page.waitForEvent('download'); await page.locator('#export').click(); const file = await download; const stream = await file.createReadStream(); let text=''; for await (const chunk of stream) text+=chunk;
  expect(JSON.parse(text).document.nodes).toHaveLength(2); expect(text).not.toContain('test-only-secret'); expect(text).not.toContain('还原这张图');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('test-only-secret');
  await page.reload(); await page.locator('#ai-toggle').click(); await expect(page.locator('#ai-key')).toHaveValue(''); await expect(page.locator('#ai-model')).toHaveValue('test-vision');
});
test('paste/drop/removal and unsupported files are handled before sending', async ({ page }) => {
  await configureAI(page, address);
  await page.locator('#ai-form').evaluate((form, data) => { const bytes=Uint8Array.from(atob(data), c=>c.charCodeAt(0)); const transfer=new DataTransfer(); transfer.items.add(new File([bytes], '粘贴.png', {type:'image/png'})); form.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer})); }, imageFile.buffer.toString('base64'));
  await expect(page.locator('#ai-images img')).toHaveCount(1);
  await page.locator('#ai-images button').click(); await expect(page.locator('#ai-images img')).toHaveCount(0);
  await page.locator('#ai-form').evaluate((form,data)=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'拖入.png',{type:'image/png'}));form.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));},imageFile.buffer.toString('base64'));
  await expect(page.locator('#ai-images img')).toHaveCount(1);
  await page.locator('#ai-image-file').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')}); await expect(page.locator('#ai-status')).toContainText('支持 PNG'); await expect(page.locator('#ai-images img')).toHaveCount(1);
});
test('stale AI response preserves manual edits and can open separately; cancel and malformed replies never edit', async ({ page }) => {
  let release;
  await page.route(address + '/chat/completions', async route => { await new Promise(resolve=>release=resolve); await route.fulfill({json:completion()}).catch(()=>{}); });
  await configureAI(page,address); await promptAI(page,'画流程'); await expect.poll(()=>!!release).toBeTruthy();
  await page.locator('[data-template="ellipse"]').dblclick(); await page.locator('#inline-node-title').fill('手工内容'); await page.locator('#inline-node-title').press('Enter');
  release(); await expect(page.locator('#ai-new-workspace')).toBeVisible(); await expect(page.locator('.diagram-node')).toHaveCount(1);
  await page.locator('#ai-new-workspace').click(); await expect(page.locator('.diagram-node')).toHaveCount(2);
  await page.locator('[data-workspace="default"]').click(); await expect(page.locator('.diagram-node')).toHaveCount(1);
  release=null; await promptAI(page,'停止测试'); await expect.poll(()=>!!release).toBeTruthy(); await page.locator('#ai-stop').click(); release(); await expect(page.locator('#ai-send')).toBeEnabled(); await expect(page.locator('.diagram-node')).toHaveCount(1);
  await page.unrouteAll(); await page.route(address + '/chat/completions',route=>route.fulfill({json:{choices:[{message:{content:'bad'}}]}}));
  await promptAI(page,'非法回复'); await expect(page.locator('#ai-status')).toContainText('未返回有效'); await expect(page.locator('.diagram-node')).toHaveCount(1);
});

test('AI sends precise errors and original images back twice, then applies one undoable result', async ({page})=>{
  const calls=[];const doc=generated();doc.tables.push({id:'t1',layerId:'flow',title:'资料',x:0,y:220,width:200,height:120,columns:['项目'],cells:[['内容']]});
  await page.route(address+'/chat/completions',async route=>{
    calls.push(route.request().postDataJSON());
    const reply=structuredClone(doc);
    if(calls.length>1)reply.tables[0].width=240;
    if(calls.length===2)reply.edges[0].target='missing';
    await route.fulfill({json:completion(reply)});
  });
  await configureAI(page,address);await page.locator('#ai-image-file').setInputFiles(imageFile);
  await expect(page.locator('#ai-images img')).toHaveCount(1);await promptAI(page,'照图生成');
  await expect(page.locator('#ai-send')).toBeEnabled();await expect(page.locator('.shared-table')).toHaveCount(1);
  expect(calls).toHaveLength(3);expect(calls[1].messages.at(-1).content).toContain('tables[0].width');expect(calls[2].messages.at(-1).content).toContain('edges[0].target');
  expect(calls[2].messages.slice(0,3)).toEqual(calls[0].messages);expect(calls[2].messages.at(-2).role).toBe('assistant');
  await expect(page.locator('#ai-messages')).toContainText('模型已自动修正 2 次');
  await page.locator('#ai-undo').click();await expect(page.locator('.diagram-node,.shared-table')).toHaveCount(0);
});

test('AI stops at three invalid replies and does not retry HTTP failures',async({page})=>{
  let calls=0;await page.route(address+'/chat/completions',route=>{calls++;return route.fulfill({json:{choices:[{message:{content:'not-json'}}]}});});
  await configureAI(page,address);await promptAI(page,'做图');await expect(page.locator('#ai-send')).toBeEnabled();
  await expect(page.locator('#ai-status')).toContainText('自动修正已重试 2 次');expect(calls).toBe(3);await expect(page.locator('.diagram-node')).toHaveCount(0);
  await page.unroute(address+'/chat/completions');await page.route(address+'/chat/completions',route=>{calls++;return route.fulfill({status:401,json:{}});});
  await promptAI(page,'重发');await expect(page.locator('#ai-send')).toBeEnabled();expect(calls).toBe(4);await expect(page.locator('#ai-status')).toContainText('401');
});

test('retry can be canceled and preserves edits made while waiting',async({page})=>{
  let calls=0,release;
  await page.route(address+'/chat/completions',async route=>{calls++;if(calls%2===1)return route.fulfill({json:{choices:[{message:{content:'bad'}}]}});await new Promise(r=>release=r);await route.fulfill({json:completion()}).catch(()=>{});});
  await configureAI(page,address);await promptAI(page,'画流程');await expect.poll(()=>!!release).toBeTruthy();
  await expect(page.locator('#ai-status')).toContainText('第 1/2 次重试');await page.locator('#ai-stop').click();release();
  await expect(page.locator('#ai-send')).toBeEnabled();await expect(page.locator('#ai-status')).toContainText('已停止');expect(calls).toBe(2);await expect(page.locator('.diagram-node')).toHaveCount(0);
  release=null;await promptAI(page,'再试');await expect.poll(()=>!!release).toBeTruthy();
  await page.locator('[data-template="ellipse"]').dblclick();await page.locator('#inline-node-title').fill('保留手工内容');await page.locator('#inline-node-title').press('Enter');
  release();await expect(page.locator('#ai-new-workspace')).toBeVisible();await expect(page.locator('.diagram-node')).toHaveCount(1);await expect(page.locator('.node-title')).toContainText('保留手工内容');
});
