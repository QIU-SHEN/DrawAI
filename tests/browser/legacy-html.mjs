import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { exampleDocument } from '../fixtures/example.mjs';

// Old HTML files remain editable; new UI only exports .drawai. Construct a
// legacy-format fixture without restoring the removed HTML export command.
export function writeLegacyHtml(filename) {
  const assets = JSON.parse(readFileSync(new URL('../../src/portable.json', import.meta.url), 'utf8'));
  const payload = { format: 1, revision: randomUUID(), storageKey: 'drawai.file.' + randomUUID(), workspaceName: '门店陈列检查', document: exampleDocument(), view: { mode: 'spatial', activeLayerId: 'flow' }, assets };
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  const boot = `window.__DRAWAI_FILE__=JSON.parse(document.getElementById('drawai-file').textContent);const s=document.createElement('script');s.textContent=window.__DRAWAI_FILE__.assets.script;document.body.append(s);`;
  writeFileSync(filename, assets.html.replace('</head>', () => '<style>' + assets.css + '</style></head>').replace('</body>', () => '<script id="drawai-file" type="application/json">' + data + '</script><script>' + boot + '</script></body>'));
}
