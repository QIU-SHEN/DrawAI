import { test, expect } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { exampleDocument } from '../fixtures/example.mjs';
const base = 'drawai.document.v1';
const catalog = page => page.evaluate(key => JSON.parse(localStorage.getItem(key + '.workspaces')), base);
const stored = (page, id = 'default') => page.evaluate(({ base, id }) => JSON.parse(localStorage.getItem(id === 'default' ? base : base + '.workspace.' + id)), { base, id });
async function addWorkspace(page, name) {
  await page.locator('#add-workspace').click(); await page.locator('#workspace-name').fill(name);
  await page.locator('#workspace-name').press('Enter'); await expect(page.locator('#workspace-dialog')).not.toBeVisible();
  return await page.locator('[data-workspace][aria-pressed="true"]').getAttribute('data-workspace');
}
async function editAgent(page, text) {
  await page.locator('[data-list-node="agent2"]').click(); await page.keyboard.press('F2');
  await page.locator('#inline-node-title').fill(text);
}

test('workspaces isolate diagrams, draft commits, undo, names and reload; export only the active workspace', async ({ page, browser }, info) => {
  await page.goto('/'); await editAgent(page, '原空间的修改');
  const second = await addWorkspace(page, '产品设计');
  await expect(page.locator('.diagram-node')).toHaveCount(0); await expect(page.locator('.shared-table')).toHaveCount(0);
  await expect(page.locator('.scene-layer')).toHaveCount(1); await expect(page.locator('#undo')).toBeDisabled();
  expect((await stored(page)).nodes.find(n => n.id === 'agent2').title).toBe('原空间的修改');
  await page.locator('[data-template="rounded"]').dblclick(); await page.locator('[data-template="table"]').dblclick();
  const secondDoc = await stored(page, second); expect(secondDoc.nodes).toHaveLength(1); expect(secondDoc.tables).toHaveLength(1);
  await page.locator('[data-workspace="default"]').click();
  await expect(page.locator('[data-node="agent2"]')).toContainText('原空间的修改');
  await page.locator('#undo').click(); expect((await stored(page)).nodes.find(n => n.id === 'agent2').title).toBe('AGENT 2');
  expect(await stored(page, second)).toEqual(secondDoc);
  await page.locator(`[data-workspace="${second}"]`).click();
  await page.locator('#undo').click(); expect((await stored(page, second)).tables).toHaveLength(0);
  await page.locator('#redo').click();
  await page.locator(`[data-rename-workspace="${second}"]`).click(); await page.locator('#workspace-name').fill('产品 <设计>'); await page.locator('#workspace-name').press('Enter');
  await expect(page.locator('.project-heading strong')).toHaveText('产品 <设计>');
  await page.reload(); await expect(page.locator('#workspace-breadcrumb')).toHaveText('产品 <设计>');
  await expect(page.locator('[data-workspace]')).toHaveCount(2); expect((await catalog(page)).activeId).toBe(second);
  expect(await stored(page, second)).toEqual(secondDoc);
  await page.screenshot({ path: info.outputPath('workspaces.png') });
  const jsonEvent = page.waitForEvent('download'); await page.locator('#export').click();
  const exported = JSON.parse(readFileSync(await (await jsonEvent).path(), 'utf8'));
  expect(exported.document).toEqual(secondDoc); expect(exported.workspaceName).toBe('产品 <设计>');
  const context = await browser.newContext(), file = await context.newPage(); await file.goto('/');
  await file.locator('#import-file').setInputFiles({ name: 'workspace.drawai', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(exported)) });
  await file.locator('#confirm-ok').click();
  await expect(file.locator('.project-heading strong')).toHaveText('产品 <设计>');
  await expect(file.locator('[data-workspace]')).toHaveCount(1);
  expect(await stored(file)).toEqual(secondDoc);
  await context.close();
});

test('existing diagram remains in the default workspace; invalid workspace storage does not replace it', async ({ page }) => {
  const old = exampleDocument(); old.nodes[0].title = '保留旧内容';
  await page.goto('/'); await page.evaluate(({ base, old }) => localStorage.setItem(base, JSON.stringify(old)), { base, old }); await page.reload();
  const second = await addWorkspace(page, '另一项目'); await page.locator('[data-workspace="default"]').click();
  expect(await stored(page)).toEqual(old);
  await page.evaluate(({ base, second }) => localStorage.setItem(base + '.workspace.' + second, 'bad data'), { base, second }); await page.reload();
  await page.locator(`[data-workspace="${second}"]`).click(); await expect(page.locator('#toast')).toContainText('无法读取');
  expect(await stored(page)).toEqual(old); await expect(page.locator('[data-workspace="default"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(base => localStorage.setItem(base + '.workspaces', 'broken index'), base); await page.reload();
  expect(await stored(page)).toEqual(old);
  expect(await page.evaluate(base => Object.keys(localStorage).some(k => k.startsWith(base + '.workspaces.recovery-')), base)).toBe(true);
});

test('workspace creation can cancel and works in memory when storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Blocked'); }; });
  await page.goto('/'); await page.locator('#add-workspace').click(); await page.locator('#workspace-cancel').click();
  await expect(page.locator('[data-workspace]')).toHaveCount(1);
  const second = await addWorkspace(page, '临时空间'); await page.locator('[data-template="rounded"]').dblclick();
  await expect(page.locator('#save-status')).toContainText('自动保存不可用');
  await page.locator('[data-workspace="default"]').click(); await expect(page.locator('.diagram-node')).toHaveCount(0);
  await page.locator(`[data-workspace="${second}"]`).click(); await expect(page.locator('.diagram-node')).toHaveCount(1);
});

for (const mode of ['flat', 'spatial']) test(`layers move up/down without changing contents or active layer in ${mode}`, async ({ page }, info) => {
  await page.goto('/'); await page.locator('#view-' + mode).click();
  await page.locator('[data-select-layer="flow"]').click();
  const beforeTransform = await page.locator('[data-layer-content="flow"]').evaluate(el => el.querySelector('svg[data-projection]')?.dataset.projection || null);
  const before = exampleDocument();
  await expect(page.locator('[data-move-layer="flow"][data-offset="-1"]')).toBeDisabled();
  await expect(page.locator('[data-move-layer="data"][data-offset="1"]')).toBeDisabled();
  await page.locator('[data-move-layer="data"][data-offset="-1"]').click();
  const moved = await stored(page);
  expect(moved.layers.map(l => l.id)).toEqual(['data', 'flow']);
  expect(moved.nodes).toEqual(before.nodes); expect(moved.tables).toEqual(before.tables); expect(moved.edges).toEqual(before.edges);
  await expect(page.locator('[data-select-layer="flow"]')).toHaveClass(/active/);
  if (mode === 'spatial') expect(await page.locator('[data-layer-content="flow"]').evaluate(el => el.querySelector('svg[data-projection]')?.dataset.projection || null)).not.toBe(beforeTransform);
  else { await expect(page.locator('.scene-layer')).toHaveCount(1); await expect(page.locator('[data-node="agent2"]')).toBeVisible(); }
  await page.locator('#undo').click(); expect((await stored(page)).layers.map(l => l.id)).toEqual(['flow', 'data']);
  await page.locator('#redo').click(); expect((await stored(page)).layers.map(l => l.id)).toEqual(['data', 'flow']);
  await page.reload(); expect((await stored(page)).layers.map(l => l.id)).toEqual(['data', 'flow']);
  await expect(page.locator('[data-select-layer="flow"]')).toHaveClass(/active/);
  await page.screenshot({ path: info.outputPath('layer-order.png') });
  await page.locator('[data-move-layer="data"][data-offset="1"]').click(); expect((await stored(page)).layers.map(l => l.id)).toEqual(['flow', 'data']);
});
