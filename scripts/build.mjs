/**
 * Build the two halves of the bundle.
 *
 *  - the Host half is plain ESM, copied into `package/lib/` next to its
 *    schema file;
 *  - the browser half is bundled by esbuild into the single factory-registration
 *    format the Harness module loader expects, with React resolved from the
 *    page's own module table.
 *
 * esbuild is invoked as a binary, so the build needs no installed dependency.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = join(root, 'package');
const lib = join(pkg, 'lib');

rmSync(lib, { recursive: true, force: true });
mkdirSync(join(lib, 'host'), { recursive: true });
mkdirSync(join(lib, 'shared'), { recursive: true });

// 1. Host half: copy every module, preserving the directory shape. The
//    relative imports (`../shared/...`) are the same in `lib/` as in `src/`.
for (const [source, target] of [[join(pkg, 'src', 'host'), join(lib, 'host')], [join(pkg, 'src', 'shared'), join(lib, 'shared')]]) {
  for (const entry of readdirSync(source, { recursive: true })) {
    const from = join(source, entry);
    if (!statSync(from).isFile()) continue;
    const to = join(target, entry);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}
// No default export: the Loader prefers `exports.default` and then reads
// `inject` off that value, so the module namespace itself must carry `apply`
// and `inject` side by side.
writeFileSync(join(lib, 'index.js'), `export { apply, inject, PLUGIN_ID, resolveDataDir, resolvePassphrase } from './host/index.js';\n`);
console.log('host half: copied', countFiles(join(lib, 'host')) + countFiles(join(lib, 'shared')), 'files');

// 2. Browser half: one factory-registration file.
const entry = join(pkg, 'src', 'client', 'index.jsx');
const raw = join(lib, 'client.raw.js');
const out = join(lib, 'client.js');
execFileSync('esbuild', [
  entry,
  '--bundle',
  '--format=iife',
  '--global-name=__scaleCommander',
  '--platform=browser',
  '--target=es2022',
  '--jsx=automatic',
  '--loader:.js=jsx',
  '--outfile=' + raw,
  '--minify',
  '--legal-comments=none',
  '--log-level=warning',
  '--external:react',
  '--external:react/jsx-runtime',
  '--external:react-dom',
  '--external:react-dom/client',
], { stdio: 'inherit' });

const bundle = readFileSync(raw, 'utf8');
rmSync(raw, { force: true });

// The loader factory receives `require`, and the IIFE resolves React through it,
// so the page's own module table supplies React with no duplicate copy.
const wrapped = `window.__ModuleLoader__.load({
  id: "@local/dsh-scale-commander",
  factory(require) {
    ${bundle}
    return __scaleCommander;
  },
});
`;
writeFileSync(out, wrapped);
console.log('browser half:', (wrapped.length / 1024).toFixed(1), 'KiB');

for (const required of ['cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg']) {
  readFileSync(join(pkg, required));
}
console.log('resources: ok');

function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (statSync(join(dir, entry)).isFile()) count += 1;
  }
  return count;
}
