import { packager } from '@electron/packager';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.6.0';
const temporaryRoot = path.join(root, '.local', 'desktop-temp');
await mkdir(temporaryRoot, { recursive: true });
process.env.TEMP = temporaryRoot; process.env.TMP = temporaryRoot;
const stage = path.join(root, '.local', 'desktop-source');
await mkdir(path.join(stage, 'src'), { recursive: true });
await mkdir(path.join(stage, 'desktop'), { recursive: true });
// Explicit allowlist: never package the repository, test data, tokens, or user diagrams.
for (const file of ['index.html', 'src/app.js', 'src/model.js', 'src/scene.js', 'src/styles.css', 'src/portable.json', 'desktop/main.mjs', 'desktop/preload.cjs', 'desktop/file-format.mjs', 'desktop/icon.ico']) {
  await cp(path.join(root, file), path.join(stage, file));
}
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'drawai-desktop', productName: 'DrawAI', author: 'DrawAI', version, type: 'module', main: 'desktop/main.mjs' }, null, 2));
const electronVersion = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'))).version;
const [output] = await packager({ dir: stage, name: 'DrawAI', platform: 'win32', arch: 'x64', electronVersion, electronZipDir: process.env.ELECTRON_ZIP_DIR, out: path.join(root, 'releases', `DrawAI-${version}`), overwrite: true, asar: false, prune: false, icon: path.join(root, 'desktop/icon.ico'), appVersion: version, win32metadata: { ProductName: 'DrawAI', FileDescription: 'DrawAI spatial diagram editor', OriginalFilename: 'DrawAI.exe' } });
await cp(path.join(root, 'desktop/使用说明.txt'), path.join(output, '使用说明.txt'));
const zip = path.join(root, 'releases', `DrawAI-${version}-Windows-x64.zip`);
// PowerShell receives paths as arguments rather than interpolated executable code.
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/zip-desktop.ps1'), '-Source', output, '-Destination', zip], { windowsHide: true, stdio: 'inherit' });
console.log('Portable application: ' + output);
console.log('Distribution ZIP: ' + zip);
