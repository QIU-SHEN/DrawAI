import { exampleDocument } from '../tests/fixtures/example.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const base = path.resolve('.local/memory-audit'); await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'run-'));
const filename = path.join(directory, 'benchmark.drawai');
await writeFile(filename, JSON.stringify({ format: 'drawai', version: 1, workspaceName: 'Benchmark', document: exampleDocument(), view: { mode: 'spatial' } }));
const document = JSON.parse(await readFile(filename, 'utf8')).document;
const env = { ...process.env, TEMP: directory, TMP: directory }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('releases/DrawAI-0.7.0/DrawAI-win32-x64/DrawAI.exe'), args: ['--user-data-dir=' + path.join(directory, 'profile'), filename], env });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { recordedAt: new Date().toISOString(), note: 'Single visible packaged window, automation attached. Process working sets may count shared pages more than once. GPU video memory excluded.', fixture: { layers: document.layers.length, nodes: document.nodes.length, tables: document.tables.length, edges: document.edges.length }, samples: [] };
try {
  const page = await app.firstWindow(); await expect(page.locator('#desktop-save')).toBeVisible();
  async function sample(stage) {
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, ...memory })));
    result.samples.push({ stage, workingSetMiB: metrics.reduce((s, p) => s + p.workingSetSize, 0) / 1024, privateMiB: metrics.reduce((s, p) => s + (p.privateBytes || 0), 0) / 1024, processes: metrics });
  }
  await page.locator('#view-flat').click(); await pause(2500);
  for (let i = 0; i < 5; i++) { await sample('flat-idle'); await pause(800); }
  await page.locator('#view-spatial').click(); await pause(2000);
  for (let i = 0; i < 5; i++) { await sample('spatial-idle'); await pause(800); }
  await page.locator('#tool-drag').click();
  const stage = await page.locator('#scene').boundingBox();
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(stage.x + 20, stage.y + 20); await page.mouse.down();
    await page.mouse.move(stage.x + 180, stage.y + 80, { steps: 20 }); await sample('rotating'); await page.mouse.up();
  }
  result.summary = Object.fromEntries(['flat-idle', 'spatial-idle', 'rotating'].map(stage => {
    const samples = result.samples.filter(s => s.stage === stage);
    return [stage, { processCount: samples[0].processes.length, workingSetMiB: [Math.min(...samples.map(s => s.workingSetMiB)), Math.max(...samples.map(s => s.workingSetMiB))], privateMiB: [Math.min(...samples.map(s => s.privateMiB)), Math.max(...samples.map(s => s.privateMiB))] }];
  }));
  await writeFile(path.join(directory, 'metrics.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ fixture: result.fixture, summary: result.summary, report: path.join(directory, 'metrics.json') }, null, 2));
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
