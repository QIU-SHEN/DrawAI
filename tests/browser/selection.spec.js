import { test, expect } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { shapes, validateDocument } from '../../src/model.js';
const key = 'drawai.document.v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
function fixture() {
  return { version: 3, layers: [{id:'flow',name:'图形层'},{id:'back',name:'下层'}], nodes: [
    {id:'a',kind:'shape',shape:'rounded',layerId:'flow',title:'自定义 A',description:'',x:-400,y:-120},
    {id:'b',kind:'shape',shape:'hexagon',layerId:'flow',title:'自定义 B',description:'',x:0,y:-120},
    {id:'hidden',kind:'shape',shape:'rectangle',layerId:'back',title:'被遮挡',description:'',x:-400,y:-120},
  ], tables:[{id:'t',layerId:'flow',x:260,y:-160,width:320,height:160,title:'普通表格',columns:['列'],cells:[['值']]}], edges:[{id:'e',source:'a',target:'b',label:'连接',sourcePort:'e',targetPort:'w'}] };
}
async function load(page, mode = 'flat') {
  await page.goto('/'); await page.evaluate(({key,doc}) => localStorage.setItem(key, JSON.stringify(doc)),{key,doc:fixture()}); await page.reload();
  await page.locator('#view-'+mode).click();
}
async function center(page,id) { const b=await page.locator(`[data-object="${id}"] .node-back,[data-object="${id}"] .table-body`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2}; }
async function drag(page,a,b,finish=true) { await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});if(finish)await page.mouse.up(); }
async function marquee(page,ids,finish=true) {
  const boxes=await Promise.all(ids.map(id=>page.locator(`[data-object="${id}"] .node-back,[data-object="${id}"] .table-body`).boundingBox()));
  await drag(page,{x:Math.min(...boxes.map(b=>b.x))-20,y:Math.min(...boxes.map(b=>b.y))-20},{x:Math.max(...boxes.map(b=>b.x+b.width))+20,y:Math.max(...boxes.map(b=>b.y+b.height))+20},finish);
}

test('marquee selects multiple shapes, shift-click adds tables, group movement/delete undo atomically', async ({page},info) => {
  await load(page); const before=await stored(page), view=await page.locator('#scene').getAttribute('viewBox');
  await marquee(page,['a','b']); await expect(page.locator('#selection-count')).toHaveText('已选 2 项');
  expect(await page.locator('#scene').getAttribute('viewBox')).toBe(view);
  const p=await center(page,'t');await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('已选 3 项');
  const a=await center(page,'a');await drag(page,a,{x:a.x+100,y:a.y+60});
  const moved=await stored(page),dx=moved.nodes[0].x-before.nodes[0].x,dy=moved.nodes[0].y-before.nodes[0].y;
  expect(dx).not.toBe(0);expect(moved.nodes[1].x-before.nodes[1].x).toBe(dx);expect(moved.tables[0].x-before.tables[0].x).toBe(dx);expect(moved.tables[0].y-before.tables[0].y).toBe(dy);
  expect(moved.nodes[2]).toEqual(before.nodes[2]);expect(moved.edges).toEqual(before.edges);
  await page.locator('#undo').click();expect(await stored(page)).toEqual(before);await page.locator('#redo').click();expect(await stored(page)).toEqual(moved);
  await page.screenshot({path:info.outputPath('multi-select.png')});
  await page.keyboard.press('Delete');expect((await stored(page)).nodes.map(n=>n.id)).toEqual(['hidden']);expect((await stored(page)).tables).toHaveLength(0);expect((await stored(page)).edges).toHaveLength(0);
  await page.locator('#undo').click();expect(await stored(page)).toEqual(moved);
});

test('Escape cancels marquee/group changes; ctrl click toggles and blank click clears',async({page})=>{
  await load(page);await marquee(page,['a','b']);
  const p=await center(page,'b');await page.keyboard.down('Control');await page.mouse.click(p.x,p.y);await page.keyboard.up('Control');
  await expect(page.locator('[data-object].selected')).toHaveCount(1);
  await marquee(page,['a','b'],false);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('[data-object].selected')).toHaveCount(1);
  await marquee(page,['a','b']);const before=await stored(page),a=await center(page,'a');
  await drag(page,a,{x:a.x+70,y:a.y+30},false);await page.keyboard.press('Escape');await page.mouse.up();expect(await stored(page)).toEqual(before);
  const stage=await page.locator('#scene').boundingBox();await page.mouse.click(stage.x+10,stage.y+10);await expect(page.locator('[data-object].selected')).toHaveCount(0);
});

for (const mode of ['flat','spatial']) test(`drag tool selects and moves shapes/tables but blank drags only control the camera in ${mode}`,async({page})=>{
  await load(page,mode);await page.locator('#tool-drag').click();
  const before=await stored(page),view=await page.locator('#scene').getAttribute('viewBox'),tilt=await page.locator('#tilt').inputValue();
  const p=await center(page,'a');await page.mouse.click(p.x,p.y);
  await expect(page.locator('[data-object="a"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-object="a"] [data-resize="se"]')).toBeVisible();
  await drag(page,p,{x:p.x+65,y:p.y+25});
  expect((await stored(page)).nodes[0].x).not.toBe(before.nodes[0].x);
  expect(await page.locator('#scene').getAttribute('viewBox')).toBe(view);expect(await page.locator('#tilt').inputValue()).toBe(tilt);
  await page.locator('#undo').click();expect(await stored(page)).toEqual(before);
  const t=await center(page,'t');await drag(page,t,{x:t.x+40,y:t.y+10});expect((await stored(page)).tables[0].x).not.toBe(before.tables[0].x);
  await page.locator('#undo').click();expect(await stored(page)).toEqual(before);
  const stage=await page.locator('#scene').boundingBox(),blank={x:stage.x+10,y:stage.y+10};
  await drag(page,blank,{x:blank.x+80,y:blank.y+40},false);await expect(page.locator('.selection-marquee')).toHaveCount(0);await page.mouse.up();
  if(mode==='flat')expect(await page.locator('#scene').getAttribute('viewBox')).not.toBe(view);
  else expect(await page.locator('#tilt').inputValue()).not.toBe(tilt);
  expect(await stored(page)).toEqual(before);
  await page.locator('#fit').click();const q=await center(page,'a');await page.mouse.click(q.x,q.y);await page.mouse.click(blank.x,blank.y);await expect(page.locator('[data-object].selected')).toHaveCount(0);
  const editPoint=await center(page,'a');await page.mouse.dblclick(editPoint.x,editPoint.y);await expect(page.locator('#inline-node-title')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('#tool-drag')).toHaveAttribute('aria-pressed','true');
});

test('spatial marquee respects layer occlusion and group movement preserves layer membership',async({page})=>{
  await load(page,'spatial');await page.locator('#camera-toggle').click();await page.locator('#tilt').fill('0');await page.locator('#camera-close').click();
  await marquee(page,['a','b','t']);await expect(page.locator('#selection-count')).toHaveText('已选 3 项');await expect(page.locator('[data-object="hidden"]')).not.toHaveClass(/selected/);
  const before=await stored(page),p=await center(page,'a');await drag(page,p,{x:p.x+50,y:p.y+30});
  const after=await stored(page);expect(after.nodes.map(n=>n.layerId)).toEqual(before.nodes.map(n=>n.layerId));expect(after.nodes[2]).toEqual(before.nodes[2]);
  expect(after.nodes[0].x).not.toBe(before.nodes[0].x);expect(after.nodes[1].x-before.nodes[1].x).toBe(after.nodes[0].x-before.nodes[0].x);
});

test('palette contains neutral shapes with editable text and new polygons survive export/reload',async({page},info)=>{
  await page.goto('/');await page.locator('#add-workspace').click();await page.locator('#workspace-name').fill('形状库');await page.locator('#workspace-name').press('Enter');
  await expect(page.locator('.palette-item')).toHaveCount(Object.keys(shapes).length+1);
  await expect(page.locator('.shape-palette')).not.toContainText(/Agent|判断|输入输出/);
  for(const [shape,name] of Object.entries(shapes)){
    await page.locator(`[data-template="${shape}"]`).dblclick();await expect(page.locator('#inline-node-title')).toHaveValue(name);await page.locator('#inline-node-title').press('Enter');
  }
  const pending=page.waitForEvent('download');await page.locator('#export').click();const value=validateDocument(JSON.parse(readFileSync(await(await pending).path(),'utf8')).document);
  expect(value.nodes).toHaveLength(Object.keys(shapes).length);expect(value.nodes.every(n=>n.kind==='shape'&&n.description==='')).toBe(true);
  expect(value.nodes.map(n=>n.shape)).toEqual(Object.keys(shapes));await page.reload();await expect(page.locator('.diagram-node')).toHaveCount(Object.keys(shapes).length);
  await page.screenshot({path:info.outputPath('neutral-shapes.png')});
});
