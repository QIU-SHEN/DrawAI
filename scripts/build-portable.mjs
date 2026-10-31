import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const [html, css, model, scene, ai, aiPanel, app] = await Promise.all(['index.html', 'src/styles.css', 'src/model.js', 'src/scene.js', 'src/ai.js', 'src/ai-panel.js', 'src/app.js'].map(read));
// Bundle local modules into separate lexical scopes. No runtime module fetch,
// external module loader or eval is needed when opening the exported file.
function bundleModule(source) {
  const names = [...source.matchAll(/^export (?:const|(?:async )?function|class) (\w+)/gm)].map(match => match[1]);
  const code = source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm, (_, imports, filename) => {
    const module = { './model.js': 'model', './scene.js': 'scene', './ai.js': 'ai', './ai-panel.js': 'aiPanel' }[filename];
    if (!module) throw new Error('Unsupported portable import: ' + filename);
    return 'const {' + imports.replace(/\b(\w+)\s+as\s+(\w+)\b/g, '$1: $2') + '} = __drawaiBundledModules.' + module + ';';
  }).replace(/^export (?=const |(?:async )?function |class )/gm, '');
  return '(() => {\n' + code + '\nreturn {' + names.join(',') + '};\n})()';
}
const script = '"use strict";\n(() => {\nconst __drawaiBundledModules = {};\n__drawaiBundledModules.model = ' + bundleModule(model) + ';\n__drawaiBundledModules.scene = ' + bundleModule(scene) + ';\n__drawaiBundledModules.ai = ' + bundleModule(ai) + ';\n__drawaiBundledModules.aiPanel = ' + bundleModule(aiPanel) + ';\n' + bundleModule(app) + ';\n})();';
// Fail the build instead of producing a downloaded file with broken JavaScript.
new Function(script);
const shell = html.replace(/\s*<link rel="stylesheet" href="\/src\/styles.css">/, '').replace(/\s*<script type="module" src="\/src\/app.js"><\/script>/, '').replace('class="brand" href="/"', 'class="brand" href="#"');
await writeFile(path.join(root, 'src/portable.json'), JSON.stringify({ format: 1, html: shell, css, script }));
console.log('Built src/portable.json (offline editor assets only; no user data).');
