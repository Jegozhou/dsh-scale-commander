/**
 * A tiny test harness: one file of assertions, no framework, no install.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const results = { passed: 0, failed: 0, failures: [] };

export function test(name, fn) {
  try {
    const value = fn();
    if (value instanceof Promise) {
      return value.then(() => {
        results.passed += 1;
        process.stdout.write(`  ✓ ${name}\n`);
      }, (error) => {
        results.failed += 1;
        results.failures.push({ name, error });
        process.stdout.write(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}\n`);
      });
    }
    results.passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    results.failed += 1;
    results.failures.push({ name, error });
    process.stdout.write(`  ✗ ${name}\n    ${error instanceof Error ? error.stack?.split('\n').slice(0, 4).join('\n    ') : String(error)}\n`);
  }
  return undefined;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed');
}

export function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message ?? 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function close(actual, expected, tolerance, message) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) {
    throw new Error(`${message ?? 'not close'}: expected ~${expected}, got ${actual}`);
  }
}

export function tempDir(prefix = 'sc-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export function summarize(label) {
  process.stdout.write(`\n${label}: ${results.passed} passed, ${results.failed} failed\n`);
  if (results.failed > 0) process.exitCode = 1;
}
