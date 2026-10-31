import { test, expect } from './fixtures.mjs';
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('drawai.document.v1')));
const point = (page,id,x,y) => page.locator(`[data-node="${id}"]`).evaluate(async(el,p)=>{
  const {elementScreenPoint}=await import('/src/scene.js'); const q=elementScreenPoint(el,p); return {x:q.x,y:q.y};
},{x,y});
async function drag(page,a,b){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up();}

for(const mode of ['flat','spatial']) test(`cylinder and actor edit, resize, move and connect in ${mode}`,async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>localStorage.setItem('drawai.document.v1',JSON.stringify({version:3,layers:[{id:'flow',name:'图形'}],nodes:[],tables:[],edges:[]})));
  await page.reload(); await page.locator('#view-flat').click();
  for(const shape of ['cylinder','actor']){
    await page.locator(`[data-template="${shape}"]`).dblclick();
    await page.locator('#inline-node-title').fill(shape==='actor'?'自由人形':'自由圆柱');
    await page.locator('#inline-node-title').press('Enter');
  }
  const before=await stored(page),[cylinder,actor]=before.nodes;
  await expect(page.locator(`[data-node="${cylinder.id}"] > path.node-back`)).toHaveCount(2);
  await expect(page.locator(`[data-node="${actor.id}"] > ellipse`)).toHaveCount(1);
  await page.locator(`#view-${mode}`).click();
  await page.locator(`[data-list-node="${actor.id}"]`).click();
  await drag(page,await point(page,actor.id,50,90),await point(page,actor.id,80,120));
  let saved=await stored(page);expect(saved.nodes[1].width).toBe(130);expect(saved.nodes[1].height).toBe(210);
  await page.locator('#undo').click();
  await drag(page,await point(page,actor.id,0,0),await point(page,actor.id,70,0));
  saved=await stored(page);expect(saved.nodes[1].x).toBe(actor.x+70);
  await page.locator(`[data-list-node="${cylinder.id}"]`).click();
  await drag(page,await point(page,cylinder.id,mode==='spatial'?45:127,mode==='spatial'?-66.6-23.4*Math.sqrt(.75):0),await point(page,actor.id,-50,0));
  saved=await stored(page);expect(saved.edges).toHaveLength(1);expect(saved.edges[0].source).toBe(cylinder.id);expect(saved.edges[0].target).toBe(actor.id);
  await page.reload();expect((await stored(page)).nodes.map(n=>n.shape)).toEqual(['cylinder','actor']);
  await expect(page.locator('[data-node]')).toHaveCount(2);
});
