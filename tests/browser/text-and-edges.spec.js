import {test,expect} from '@playwright/test';
import {generated} from '../fixtures/ai.mjs';
const key='drawai.document.v1';
const longTitle='按门店输出商品名称与配送明细';
const longDescription='字段包括门店编号、商品编号、名称、价格、数量、配送时间以及核对结果。请保留全部说明，不要省略任何信息。';
const doc=generated(longTitle);doc.nodes[0].description=longDescription;doc.nodes[0].x=-350;doc.nodes[1].x=350;doc.nodes[1].y=150;
test.beforeEach(async({page})=>{await page.addInitScript(({doc,key})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(doc));},{doc,key});await page.goto('/');});
const saved=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
async function point(page,selector,x,y){return page.locator(selector).evaluate(async(el,p)=>{const {elementScreenPoint}=await import('/src/scene.js');const q=elementScreenPoint(el,p);return{x:q.x,y:q.y};},{x,y});}
async function menu(page,id){const p=await page.locator(`[data-edge="${id}"] .edge-line`).evaluate(async el=>{const {elementScreenPoint}=await import('/src/scene.js');const q=elementScreenPoint(el,el.getPointAtLength(el.getTotalLength()/2));return{x:q.x,y:q.y};});await page.mouse.click(p.x,p.y,{button:'right'});await expect(page.locator('#edge-context-menu')).toBeVisible();}

test('full labels grow shapes, use resized width and expand inline editor',async({page})=>{
  const n=page.locator('[data-node="submit"]');await expect(n.locator('.node-title')).toHaveText(longTitle);await expect(n.locator('.node-description')).toHaveText(longDescription);
  const size=await n.locator('.node-back').evaluate(el=>({width:+el.getAttribute('width'),height:+el.getAttribute('height')}));expect(size.height).toBeGreaterThan(112);
  const contained=await n.evaluate(el=>{const b=el.querySelector('.node-back').getBoundingClientRect(),t=el.querySelector('.node-text').getBoundingClientRect();return t.left>=b.left&&t.right<=b.right&&t.top>=b.top&&t.bottom<=b.bottom;});expect(contained).toBeTruthy();
  const lines=await n.locator('.node-description tspan').count();await page.locator('[data-list-node="submit"]').click();
  const p=await point(page,'[data-node="submit"]',size.width/2,0),q=await point(page,'[data-node="submit"]',size.width/2+200,0);
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:12});await page.mouse.up();
  await expect.poll(()=>n.locator('.node-description tspan').count()).toBeLessThan(lines);expect((await saved(page)).nodes[0].width).toBeGreaterThan(350);
  await page.keyboard.press('F2');expect(+(await page.locator('.node-inline-editor').getAttribute('width'))).toBeGreaterThan(350);expect(await page.locator('.inline-text-fields').evaluate(el=>el.clientWidth)).toBeGreaterThan(350);
  await page.locator('#inline-node-description').fill('完整内容'.repeat(45));await page.locator('#inline-node-description').press('Enter');
  await expect(n.locator('.node-description')).toHaveText('完整内容'.repeat(45));expect((await saved(page)).nodes[0].height).toBeGreaterThan(size.height);
  await page.locator('#undo').click();await expect(n.locator('.node-description')).toHaveText(longDescription);
  const arrow=await n.locator('[data-port="e"] path').evaluate(el=>{const b=el.getBBox();return{w:b.width,h:b.height};});expect(arrow).toEqual({w:22,h:16});
});

for(const mode of ['flat','spatial'])test(`edge context styles combine and persist with undo in ${mode}`,async({page})=>{
  await page.locator('#view-'+mode).click();
  for(const [field,value] of [['routing','straight'],['direction','both'],['style','dashed']]){await menu(page,'e1');await page.locator(`[data-edge-setting="${field}"][data-value="${value}"]`).click();}
  const edge=page.locator('[data-edge="e1"] .edge-line');await expect(edge).toHaveAttribute('d',/ L/);await expect(edge).toHaveAttribute('marker-start',/data-arrow/);await expect(edge).toHaveClass(/data-link-line/);await expect(page.locator('#inspector')).toBeHidden();
  expect((await saved(page)).edges[0]).toMatchObject({routing:'straight',direction:'both',style:'dashed'});
  await page.locator('#undo').click();await expect(edge).not.toHaveClass(/data-link-line/);await expect(edge).toHaveAttribute('marker-start',/flow-arrow/);
  await page.locator('#redo').click();await page.reload();await expect(page.locator('[data-edge="e1"] .edge-line')).toHaveAttribute('marker-start',/data-arrow/);
  await menu(page,'e1');await page.locator('[data-edge-setting="routing"][data-value="curved"]').click();await expect(page.locator('[data-edge="e1"] .edge-line')).toHaveAttribute('d',/ C/);
  await menu(page,'e1');await page.keyboard.press('Escape');await expect(page.locator('#edge-context-menu')).toBeHidden();
});

test('all shape labels retain full content within their contours',async({page})=>{
  const results=await page.evaluate(async()=>{
    const {renderScene}=await import('/src/scene.js');const {shapes}=await import('/src/model.js');
    const svg=document.querySelector('#scene');const results=[];
    for(const shape of Object.keys(shapes).filter(s=>s!=='actor')){
      const node={id:'n1',kind:'shape',shape,layerId:'flow',title:'标题分为多行显示完整内容',description:'中文English商品字段数量与价格及配送说明'.repeat(4),x:0,y:0,width:180,height:100};
      renderScene(svg,{version:3,layers:[{id:'flow',name:'图层'}],nodes:[node],tables:[],edges:[]},{mode:'flat'},null,true,null,'flow');
      const t=svg.querySelector('.node-text'),b=t.getBBox(),back=svg.querySelector('.node-back');
      const matrix=back.getCTM().inverse().multiply(t.getCTM());
      const inside=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].every(([x,y])=>back.isPointInFill(new DOMPoint(x,y).matrixTransform(matrix)));
      results.push({shape,inside,full:svg.querySelector('.node-description').textContent===node.description});
    }return results;
  });for(const result of results){expect(result.inside,result.shape).toBeTruthy();expect(result.full,result.shape).toBeTruthy();}
});
