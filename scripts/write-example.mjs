import { writeFile } from 'node:fs/promises';
import { exampleDocument } from '../tests/fixtures/example.mjs';
if (!process.argv[2]) throw new Error('Example output filename is required');
await writeFile(process.argv[2], JSON.stringify({ format: 'drawai', version: 1, workspaceName: '门店陈列检查', document: exampleDocument(), view: { mode: 'spatial', tilt: 55, yaw: -30, gap: 640, activeLayerId: 'flow' } }, null, 2));
