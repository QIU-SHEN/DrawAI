import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { exampleDocument } from '../fixtures/example.mjs';
import { validateFile, readDiagram, writeDiagram, contentKey } from '../../desktop/file-format.mjs';
const fixture = () => ({ format: 'drawai', version: 1, workspaceName: '中文流程', document: exampleDocument(), view: { mode: 'spatial', tilt: 75, yaw: -40 } });
const base = path.resolve('.local/desktop-tests'); await mkdir(base, { recursive: true });
test('native file round trip preserves graph, tables, and view using Chinese paths', async () => {
  const dir = await mkdtemp(path.join(base, 'drawai-format-'));
  const file = path.join(dir, '我的 图表.drawai'), payload = validateFile(fixture());
  const first = await writeDiagram(file, payload, null);
  assert.deepEqual((await readDiagram(file)).payload, payload);
  payload.document.nodes[0].title = '修改后的标题';
  const second = await writeDiagram(file, payload, first);
  assert.equal(await readFile(file, 'utf8'), second);
  assert.deepEqual(await readdir(dir), ['我的 图表.drawai']);
});
test('external changes refuse overwrite and invalid documents do not touch original', async () => {
  const dir = await mkdtemp(path.join(base, 'drawai-conflict-')), file = path.join(dir, 'test.drawai');
  const original = await writeDiagram(file, fixture(), null);
  await writeFile(file, 'EXTERNAL');
  await assert.rejects(writeDiagram(file, fixture(), original), /其他程序/);
  assert.equal(await readFile(file, 'utf8'), 'EXTERNAL');
  await assert.rejects(writeDiagram(file, { ...fixture(), version: 999 }, 'EXTERNAL'), /不支持|不是支持/);
  assert.equal(await readFile(file, 'utf8'), 'EXTERNAL');
});
test('rejects unsupported format and keeps plain text without code evaluation', () => {
  assert.throws(() => validateFile({ ...fixture(), format: 'html' }));
  const value = fixture(); value.document.nodes[0].title = '<script>alert(1)</script>';
  assert.equal(validateFile(value).document.nodes[0].title, '<script>alert(1)</script>');
  assert.equal(contentKey(value), contentKey({ ...value, view: { tilt: 42 } }));
});
