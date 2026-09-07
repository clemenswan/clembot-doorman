#!/usr/bin/env node
/**
 * The whole test runner. Zero dependencies.
 *
 * This repo is the giveaway: someone clones it and expects a security gate to
 * start working. A suite that needs an install before it can tell them whether
 * the gate works is a worse trade than a runner this small.
 *
 * Matches the reporting style already used by test-gate.sh and test-poller.mjs
 * so the three read as one suite.
 *
 * Assertions live in harness.mjs, not here. Putting them here creates a cycle
 * (runner awaits the test file, test file imports the runner) that deadlocks
 * the module graph and reports zero tests with zero failures.
 *
 * Never calls process.exit(). On Node 25 / Windows, exiting while sockets are
 * open trips a libuv assertion during teardown that REPLACES the real exit code
 * with 127, turning a clean pass into an inexplicable CI failure.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { state } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  // A suite that finds no tests must not print a pass. That is the exact shape
  // of a green run that proves nothing.
  console.log('\n  no test files found. Something is wrong with the runner.');
  process.exitCode = 1;
} else {
  // A file that THROWS while loading is a failure, not a crash.
  //
  // Without this the process dies mid-run: no count, no failing list, and the
  // files after it never load. It looks like an infrastructure problem rather
  // than a broken test, and it hides however many failures were still to come.
  // Found while mutation-testing the spend cap, where several mutants killed
  // the runner instead of being reported.
  for (const f of files) {
    try {
      await import(pathToFileURL(join(HERE, f)).href);
    } catch (e) {
      state.failed++;
      state.failures.push(`${f} (failed to load)`);
      console.log(`
${f}
  FAIL  the file threw while loading: ${e && e.message}`);
    }
  }

  console.log(`\n  ${state.passed} passed, ${state.failed} failed  (${files.length} files)`);
  if (state.failed) {
    console.log('  failing: ' + state.failures.join(', '));
    process.exitCode = 1;
  }
}
