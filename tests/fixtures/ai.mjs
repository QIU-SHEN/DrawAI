import http from 'node:http';
import { blankDocument } from '../../src/model.js';
import { expect } from '@playwright/test';

export const imageFile = { name: '流程.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6DhsAAAAASUVORK5CYII=', 'base64') };
export function generated(title = '提交申请') {
  const doc = blankDocument();
  doc.nodes = [{ id: 'submit', kind: 'shape', shape: 'rounded', layerId: 'flow', title, description: '', x: -200, y: 0, width: 200, height: 112 }, { id: 'review', kind: 'shape', shape: 'diamond', layerId: 'flow', title: '审批', description: '', x: 180, y: 0, width: 240, height: 180 }];
  doc.edges = [{ id: 'e1', source: 'submit', target: 'review', sourcePort: 'e', targetPort: 'w', label: '送审', style: 'solid' }]; return doc;
}
export const completion = (doc = generated(), message = '已生成可编辑图表。') => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ message, document: doc }) } }] });
export async function configureAI(page, address) {
  await page.locator('#ai-toggle').click();
  await page.locator('#ai-address').fill(address);
  await page.locator('#ai-model').fill('test-vision');
  await page.locator('#ai-key').fill('test-only-secret');
  await page.locator('#ai-config-save').click();
}
export async function promptAI(page, text) { await page.locator('#ai-prompt').fill(text); await page.locator('#ai-send').click(); }
export async function mockAPI() {
  const calls = []; let handler = (_req, res) => res.end(JSON.stringify(completion()));
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'POST' }); res.end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const call = { body: JSON.parse(body), headers: req.headers, url: req.url }; calls.push(call);
    // Deliberately no CORS headers: desktop transports must perform native HTTP.
    res.setHeader('Content-Type', 'application/json'); handler(call, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { calls, url: `http://127.0.0.1:${server.address().port}/v1`, setHandler: fn => handler = fn,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
export async function nativeAIExercise(page, api) {
  await configureAI(page, api.url);
  await page.locator('#ai-image-file').setInputFiles(imageFile);
  await expect(page.locator('#ai-images img')).toHaveCount(1);
  await promptAI(page, '请按图片生成图表');
  await expect(page.locator('[data-node="submit"]')).toBeVisible();
  expect(api.calls[0].headers.authorization).toBe('Bearer test-only-secret');
  expect(api.calls[0].body.messages.at(-1).content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  expect(api.calls[0].body.model).toBe('test-vision');
  await page.locator('#ai-undo').click(); await expect(page.locator('.diagram-node')).toHaveCount(0);
  api.setHandler((_call, res) => { res.writeHead(401); res.end('{}'); });
  await promptAI(page, '再画一次'); await expect(page.locator('#ai-status')).toContainText('401');
  await expect(page.locator('.diagram-node')).toHaveCount(0);
  api.setHandler(() => {}); await promptAI(page, '等待请求');
  await expect.poll(() => api.calls.length).toBe(3);
  await page.locator('#ai-stop').click(); await expect(page.locator('#ai-send')).toBeEnabled();
  await expect(page.locator('#ai-status')).toContainText('已停止');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage })); expect(stored).not.toContain('test-only-secret');
}
