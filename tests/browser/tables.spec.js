import { test, expect } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { validateDocument } from '../../src/model.js';
import { exampleDocument } from '../fixtures/example.mjs';
const key = 'drawai.document.v1';
const legacy = JSON.parse(readFileSync(new URL('../fixtures/v2.json', import.meta.url), 'utf8'));
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function load(page, doc) {
  await page.goto('/'); await page.evaluate(({ key, doc }) => localStorage.setItem(key, JSON.stringify(doc)), { key, doc }); await page.reload();
}
async function flat(page, layer = 'flow') { await page.locator('#view-flat').click(); await page.locator(`[data-select-layer="${layer}"]`).click(); }
async function edit(page, id) { await page.locator(`[data-list-node="${id}"]`).click(); await page.keyboard.press('F2'); }

test('multiple independent blank tables, custom title/columns/cells, row/column changes and persistence', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await load(page, { ...exampleDocument(), nodes: [], tables: [], edges: [] }); await flat(page);
  await page.locator('[data-template="table"]').dblclick();
  await expect(page.locator('[data-table-title]')).toHaveValue('表格');
  await expect(page.locator('.table-inline-editor select,.table-inline-editor input[type="checkbox"]')).toHaveCount(0);
  await page.locator('[data-table-title]').fill('项目排期');
  await page.locator('[data-column="0"]').fill('任务'); await page.locator('[data-column="1"]').fill('负责人');
  await page.locator('[data-cell="0,0"]').fill('自由内容 <b>不是标签</b>');
  await page.locator('[data-cell="0,1"]').fill('小林');
  await page.locator('[data-table-add]').click(); await page.locator('[data-table-add-column]').click();
  await page.locator('[data-column="3"]').fill('截止日期'); await page.locator('[data-cell="3,3"]').fill('周五');
  await page.locator('[data-delete-column="2"]').click(); await page.locator('[data-delete-row="1"]').click();
  await page.locator('[data-table-save]').click();
  const first = (await stored(page)).tables[0];
  expect(first.title).toBe('项目排期'); expect(first.columns).toEqual(['任务', '负责人', '截止日期']);
  expect(first.cells).toEqual([['自由内容 <b>不是标签</b>', '小林', ''], ['', '', ''], ['', '', '周五']]);
  await page.locator('[data-template="table"]').dblclick(); await page.locator('[data-table-title]').fill('会议记录');
  await page.locator('[data-cell="0,0"]').fill('第二张表'); await page.locator('[data-table-save]').click();
  const two = await stored(page); expect(two.tables).toHaveLength(2); expect(two.tables[0]).toEqual(first);
  expect(two.tables[1].id).not.toBe(first.id); expect(two.tables[1].columns).toEqual(['', '', '']);
  await page.reload(); await flat(page); await expect(page.locator('[data-table]')).toHaveCount(2);
  expect((await stored(page)).tables).toEqual(two.tables);
  await page.screenshot({ path: 'test-results/multiple-tables.png' });
  await edit(page, first.id); await expect(page.locator('[data-cell="0,0"]')).toHaveValue('自由内容 <b>不是标签</b>');
  await page.screenshot({ path: 'test-results/generic-table-edit.png' });
  expect(errors).toEqual([]);
});

test('table drafts cancel together, accept IME, save outside, undo and redo one edit', async ({ page }) => {
  await load(page, exampleDocument()); await flat(page, 'data');
  const before = (await stored(page)) || exampleDocument();
  await edit(page, 'table-shared'); await page.locator('[data-table-title]').fill('取消修改');
  await page.locator('[data-table-add-column]').click(); await page.locator('[data-delete-row="0"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.table-inline-editor')).toHaveCount(0); expect((await stored(page)).tables).toEqual(before.tables);
  await edit(page, 'table-shared'); await page.locator('[data-cell="0,0"]').fill('中文确认');
  await page.locator('[data-cell="0,0"]').dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(page.locator('.table-inline-editor')).toBeVisible();
  await page.locator('[data-cell="0,0"]').press('Shift+Enter'); await page.keyboard.type('second line');
  await page.locator('#zoom-in').click();
  expect((await stored(page)).tables[0].cells[0][0]).toContain('\nsecond line');
  await page.locator('#undo').click(); expect((await stored(page)).tables).toEqual(before.tables);
  await page.locator('#redo').click(); await page.reload(); expect((await stored(page)).tables[0].cells[0][0]).toContain('中文确认');
});

test('old v1/v2 documents preserve content, geometry and links, keep a backup, and export v3', async ({ page }) => {
  const old = structuredClone(legacy); old.table.width = 1500; old.table.height = 380;
  old.rows[0].note = '保留备注'; old.rows[1].agentIds.push('agent2');
  old.nodes.find(n => n.id === 'agent2').relationLabel = '自定义关联';
  old.edges.push({ id: 'old-table-arrow', source: '@shared-table', target: 'agent4', label: '已有箭头' });
  await load(page, old); await flat(page, 'data'); await edit(page, 'table-shared');
  await expect(page.locator('[data-cell="0,3"]')).toHaveValue('保留备注');
  await expect(page.locator('[data-cell="1,2"]')).toHaveValue('AGENT 3 · AGENT 2');
  await page.locator('[data-table-save]').click(); await page.locator('[data-template="table"]').dblclick(); await page.locator('[data-table-save]').click();
  const migrated = await stored(page); expect(migrated.version).toBe(3); expect(migrated.tables).toHaveLength(2);
  expect(migrated.tables[0]).toEqual(validateDocument(old).tables[0]);
  expect(migrated.edges).toEqual(validateDocument(old).edges);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key + '.before-tables')), key)).toEqual(old);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await downloadPromise; const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(data.document).toEqual(migrated);
  await page.locator('#import-file').setInputFiles({ name: 'tables.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) }); await page.locator('#confirm-ok').click();
  expect(await stored(page)).toEqual(migrated);
  const v1 = { version: 1, nodes: legacy.nodes.map(({ layerId, shape, ...n }) => n), edges: legacy.edges, rows: legacy.rows };
  await load(page, v1); await flat(page, 'data'); await expect(page.locator('[data-table]')).toHaveCount(1);
  await edit(page, 'table-shared'); await expect(page.locator('[data-cell="0,0"]')).toHaveValue('图片差异');
});

test('deleting one table or its layer only removes its own links, and undo restores content', async ({ page }) => {
  const fixture = exampleDocument();
  fixture.tables.push({ ...structuredClone(fixture.tables[0]), id: 'second-table', layerId: 'flow', x: -700, y: 500 });
  fixture.edges.push({ id: 'table-to-table', source: 'table-shared', target: 'second-table', label: '表间连线' });
  await load(page, fixture); await flat(page, 'data');
  await page.locator('[data-list-node="table-shared"]').click(); await page.keyboard.press('Delete');
  const removed = await stored(page); expect(removed.tables.map(t => t.id)).toEqual(['second-table']);
  expect(removed.edges.every(e => e.source !== 'table-shared' && e.target !== 'table-shared')).toBe(true);
  await page.locator('#undo').click(); expect((await stored(page)).tables).toEqual(fixture.tables);
  await page.locator('[data-manage-layer="data"]').click(); await page.locator('#delete-layer').click(); await page.locator('#confirm-ok').click();
  expect((await stored(page)).tables.map(t => t.id)).toEqual(['second-table']);
  await page.locator('#undo').click(); expect(await stored(page)).toEqual(fixture);
});

test('dragging palette tables always creates new objects in the selected layer', async ({ page }) => {
  await load(page, { ...exampleDocument(), nodes: [], tables: [], edges: [] }); await flat(page);
  for (const [layer, offset] of [['flow', -150], ['flow', 200], ['data', 0]]) {
    await page.locator(`[data-select-layer="${layer}"]`).click();
    await page.locator('[data-template="table"]').scrollIntoViewIfNeeded();
    const a = await page.locator('[data-template="table"]').boundingBox(), b = await page.locator('#scene').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + offset, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
  }
  const doc = await stored(page); expect(doc.tables).toHaveLength(3); expect(new Set(doc.tables.map(t => t.id)).size).toBe(3);
  expect(doc.tables.map(t => t.layerId)).toEqual(['flow', 'flow', 'data']);
  expect(doc.tables.every(t => t.cells.flat().every(c => c === '') && t.columns.every(c => c === ''))).toBe(true);
});

test('second table moves and resizes independently and can connect to another table', async ({ page }) => {
  const base = { ...exampleDocument().tables[0], layerId: 'flow', width: 600, height: 260, y: 0 };
  const fixture = { ...exampleDocument(), nodes: [], edges: [], tables: [{ ...base, id: 'first', x: -720 }, { ...structuredClone(base), id: 'second', x: 100 }] };
  await load(page, fixture); await flat(page);
  const point = (id, x, y) => page.locator(`[data-table="${id}"]`).evaluate(async (el, p) => { const { elementScreenPoint } = await import("/src/scene.js"); const q = elementScreenPoint(el, { x: p.x, y: p.y }); return { x: q.x, y: q.y }; }, { x, y });
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up(); };
  await drag(await point('second', 300, 120), await point('second', 330, 145));
  expect((await stored(page)).tables[1].x).toBeCloseTo(130, 0);
  await drag(await point('second', 600, 260), await point('second', 670, 300));
  expect((await stored(page)).tables[1].width).toBeCloseTo(670, 0);
  expect((await stored(page)).tables[0]).toEqual(fixture.tables[0]);
  await page.locator('[data-list-node="first"]').click();
  await drag(await point('first', 637, 130), await point('second', 100, 110));
  const saved = await stored(page); expect(saved.edges).toHaveLength(1);
  expect(saved.edges[0]).toMatchObject({ source: 'first', target: 'second', sourcePort: 'e' });
  await page.reload(); await flat(page); expect(await stored(page)).toEqual(saved);
  await page.locator('[data-list-node="second"]').click(); await page.locator('#delete-table').click();
  expect((await stored(page)).tables.map(t => t.id)).toEqual(['first']); expect((await stored(page)).edges).toEqual([]);
  await page.locator('#undo').click(); expect(await stored(page)).toEqual(saved);
});
