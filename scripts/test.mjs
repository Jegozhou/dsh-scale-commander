/**
 * Run every suite and exit non-zero if any assertion failed.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'tests');
const suites = readdirSync(dir).filter((file) => file.endsWith('.test.mjs')).sort();
const verifiers = readdirSync(dir).filter((file) => file.startsWith('verify-'));
let failed = 0;
for (const suite of suites) {
  process.stdout.write(`\n━━ ${suite} ━━\n`);
  const result = spawnSync(process.execPath, [join(dir, suite)], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) failed += 1;
}
for (const verifier of verifiers) {
  process.stdout.write(`\n━━ ${verifier} ━━\n`);
  const result = spawnSync(process.execPath, [join(dir, verifier)], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) failed += 1;
}
process.stdout.write(`\n${failed === 0 ? 'all suites passed' : `${failed} suite(s) failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
