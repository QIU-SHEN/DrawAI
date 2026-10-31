import test from 'node:test';
import assert from 'node:assert/strict';
import { aiEndpoint, aiSettings, aiRequest, aiResult, aiResponse, fetchAI } from '../src/ai.js';
import { blankDocument, validateDocument } from '../src/model.js';
import { generated, completion, mockAPI } from './fixtures/ai.mjs';

test('API addresses normalize base/full paths and reject credential-bearing or non-HTTP URLs', () => {
  assert.equal(aiEndpoint('https://example.com/'), 'https://example.com/v1/chat/completions');
  assert.equal(aiEndpoint('http://localhost:11434/v1/'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(aiEndpoint('https://example.com/chat/completions?api-version=1'), 'https://example.com/chat/completions?api-version=1');
  for (const url of ['file:///tmp/file', 'https://user:pass@example.com/v1', 'https://example.com/#secret', 'invalid']) assert.throws(() => aiEndpoint(url));
  assert.throws(() => aiSettings({ address: 'https://example.com', model: '' }));
  assert.throws(() => aiSettings({ address: 'https://example.com', model: 'm', key: 'x\r\ny' }));
});
test('requests include current editable graph, recent history, current images, and isolate API credentials', () => {
  const request = aiRequest({ address: 'https://example.com', key: 'secret', model: 'vision' }, { name: '空间', document: generated() }, [{ role: 'user', text: '之前', images: [{}] }], '照图修改', [{ url: 'data:image/png;base64,abc' }]);
  const body = JSON.parse(request.body);
  assert.equal(body.model, 'vision'); assert.equal(body.stream, false); assert.equal(request.key, 'secret');
  assert.ok(!request.body.includes('secret')); assert.ok(body.messages.at(-2).content.includes('submit'));
  assert.equal(body.messages.at(-1).content[1].image_url.url, 'data:image/png;base64,abc');
  assert.ok(body.messages[1].content.includes('未在本轮重发'));
});
test('AI result validates whole graph atomically, accepts conversation, and rejects truncated/invalid references', () => {
  assert.deepEqual(aiResult('```json\n' + JSON.stringify({ message: '好了', document: blankDocument() }) + '\n```').document, blankDocument());
  assert.equal(aiResult('{"message":"请说明","document":null}').document, null);
  const bad = generated(); bad.edges[0].target = 'missing';
  assert.throws(() => aiResponse(JSON.stringify(completion(bad)), 200), /无效/);
  assert.throws(() => aiResult('<script>alert(1)</script>'), /JSON/);
  assert.throws(() => aiResponse(JSON.stringify({ choices: [{ finish_reason: 'length' }] }), 200), /截断/);
  assert.throws(() => aiResponse('secret', 401), /API Key/);
  assert.throws(() => aiResponse('secret', 429), /额度/);
});
test('HTTP transport posts auth, cancels, rejects oversized responses and never follows redirects', async () => {
  const api = await mockAPI();
  try {
    const request = { endpoint: api.url + '/chat/completions', key: 'secret', body: JSON.stringify({ model: 'm', messages: [] }) };
    assert.equal((await fetchAI(request)).status, 200); assert.equal(api.calls[0].headers.authorization, 'Bearer secret');
    api.setHandler((_call, res) => { res.writeHead(302, { Location: api.url + '/redirect' }); res.end(); });
    await assert.rejects(fetchAI(request)); assert.equal(api.calls.length, 2);
    api.setHandler((_call, res) => res.end('x'.repeat(2 * 1024 * 1024 + 1)));
    await assert.rejects(fetchAI(request), /过大/);
    api.setHandler(() => {}); const controller = new AbortController(); const promise = fetchAI(request, controller.signal); controller.abort(); await assert.rejects(promise);
  } finally { await api.close(); }
});

test('AI merges only identical table duplicates and preserves references and contents', () => {
  const doc = generated();
  const table = {id:'t1',layerId:'flow',title:'资料',x:-300,y:240,width:720,height:200,columns:['项目'],cells:[['内容']]};
  doc.tables.push(table); doc.nodes.push({...table,kind:'table'});
  doc.edges.push({id:'e2',source:'review',target:'t1',label:'记录',style:'dashed'});
  assert.throws(()=>validateDocument(doc), /nodes\[2\]\.kind/); // Imports stay strict.
  const result=aiResult(JSON.stringify({message:'完成',document:doc}));
  assert.equal(result.document.nodes.length,2);assert.equal(result.document.tables.length,1);
  assert.deepEqual(result.document.tables[0],table);assert.deepEqual(result.document.edges,doc.edges);assert.match(result.message,/合并 1 处/);
  assert.equal(doc.nodes.length,3);
  const mismatch=structuredClone(doc);mismatch.nodes[2].cells=[['不同内容']];
  assert.throws(()=>aiResult(JSON.stringify({message:'完成',document:mismatch})), /nodes\[2\].*tables\[0\].*不一致/);
  const collision=generated();collision.tables.push({...table,id:'submit'});
  assert.throws(()=>aiResult(JSON.stringify({message:'完成',document:collision})), /tables\[0\]\.id.*重复/);
});

test('AI validation identifies exact fields without accepting invalid geometry or dangling edges', () => {
  for (const [edit,pattern] of [
    [d=>d.nodes[0].width=20,/nodes\[0\]\.width/],
    [d=>d.nodes[0].description=null,/nodes\[0\]\.description/],
    [d=>d.edges[0].target='missing',/edges\[0\]\.target/],
    [d=>d.nodes[0].layerId='missing',/nodes\[0\]\.layerId/],
  ]) {const doc=generated();edit(doc);assert.throws(()=>aiResult(JSON.stringify({message:'完成',document:doc})),pattern);}
});
