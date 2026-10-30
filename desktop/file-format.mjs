import { readFile, open, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateDiagramFile } from '../src/model.js';

export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const validateFile = validateDiagramFile;
export function serializeFile(value) {
  const text = JSON.stringify(validateFile(value), null, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('图表文件超过 12 MB，请拆分工作空间。');
  return text;
}
export function contentKey(value) {
  return JSON.stringify([value.workspaceName, value.document]);
}
export async function readDiagram(filename) {
  if ((await stat(filename)).size > MAX_FILE_BYTES) throw new Error('文件超过 12 MB。');
  const text = await readFile(filename, 'utf8');
  try { return { payload: validateFile(JSON.parse(text.replace(/^\uFEFF/, ''))), text }; }
  catch (error) { throw new Error(error instanceof SyntaxError ? '文件内容不是有效的 DrawAI 图表。' : error.message); }
}
export async function readOptional(filename) {
  try { return await readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
// Write a sibling temp file and flush before replacement. Never truncate the original.
export async function writeDiagram(filename, value, expectedText) {
  const text = serializeFile(value);
  const verify = async () => {
    if (await readOptional(filename) !== expectedText) throw new Error('文件已被其他程序修改或移动，未覆盖。请另存为新文件，或重新打开原文件。');
  };
  await verify();
  const temporary = path.join(path.dirname(filename), '.' + path.basename(filename) + '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(temporary, 'wx'); await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await verify(); await rename(temporary, filename); return text;
  } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
}
