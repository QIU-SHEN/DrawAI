import { exampleDocument } from '../tests/fixtures/example.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchWebView, native, processMemory, pause } from '../tests/webview2/helpers.mjs';

const base = path.resolve('.local/memory-comparison'); await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'run-'));
const file = path.join(directory, 'benchmark.drawai');
await writeFile(file, JSON.stringify({ format: 'drawai', version: 1, workspaceName: 'Benchmark', document: exampleDocument(), view: { mode: 'spatial' } }));
const report = { recordedAt: new Date().toISOString(), fixture: 'same .drawai example, 2 layers / 12 nodes / 1 table / 15 edges', measurement: 'Windows process-tree PrivateMemorySize64 and WorkingSet64; visible single window, automation attached; shared working-set pages may be counted repeatedly; GPU video memory excluded', engines: {} };
async function measure(page, pid, result) {
  await expect(page.locator('#desktop-save')).toBeVisible();
  result.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight })); result.samples = [];
  async function sample(stage) { result.samples.push({ stage, ...await processMemory(pid) }); }
  for (const mode of ['flat', 'spatial']) {
    await page.locator('#view-' + mode).click(); await pause(2000);
    for (let i=0; i<3; i++) { await sample(mode + '-idle'); await pause(500); }
    console.log(result.name + ': ' + mode + ' measured');
  }
  await page.locator('#tool-drag').click(); const box = await page.locator('#scene').boundingBox();
  const moves = [];
  for (let i=0; i<6; i++) {
    const started = performance.now();
    await page.mouse.move(box.x+20,box.y+20); await page.mouse.down(); await page.mouse.move(box.x+180,box.y+80,{steps:20}); await page.mouse.up();
    moves.push(performance.now()-started); await sample('rotation');
  }
  result.gestureDurationMs = moves;
  await pause(8000); await sample('after-rest');
  result.summary = Object.fromEntries(['flat-idle','spatial-idle','rotation','after-rest'].map(stage => {
    const values = result.samples.filter(s=>s.stage===stage);
    return [stage,{processCount:values[0].processes.length,privateMiB:[Math.min(...values.map(s=>s.privateMiB)),Math.max(...values.map(s=>s.privateMiB))],workingSetMiB:[Math.min(...values.map(s=>s.workingSetMiB)),Math.max(...values.map(s=>s.workingSetMiB))]}];
  }));
}
const env = { ...process.env, TEMP: directory, TMP: directory }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath:path.resolve('releases/DrawAI-0.6.0/DrawAI-win32-x64/DrawAI.exe'),args:['--user-data-dir='+path.join(directory,'electron-profile'),file],env });
try {
  const result = report.engines.electron = { name:'Electron',versions:await app.evaluate(()=>process.versions) };
  await measure(await app.firstWindow(),app.process().pid,result);
} finally { await app.evaluate(({app})=>app.exit(0)).catch(()=>{}); }
const webview = await launchWebView(file);
try {
  await expect(webview.page.locator('#desktop-save')).toBeVisible();
  await native(webview.page,'viewport',report.engines.electron.viewport);
  const result=report.engines.webview2={name:'WebView2',versions:await native(webview.page,'info')};
  await measure(webview.page,webview.child.pid,result);
} finally { await webview.stop(); }
const output=path.join(directory,'comparison.json');await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:output,results:Object.fromEntries(Object.entries(report.engines).map(([name,r])=>[name,{viewport:r.viewport,summary:r.summary,gestureDurationMs:r.gestureDurationMs}]))},null,2));
