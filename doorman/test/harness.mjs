/**
 * Assertions, kept separate from the runner on purpose.
 *
 * The first version put `check` in run.mjs and had run.mjs `await import()` the
 * test files. Every test file then imported run.mjs, which was still sitting on
 * that await, so the module graph deadlocked and node reported
 * "unsettled top-level await" with zero tests run and no failures. A suite that
 * reports nothing is worse than one that reports failures.
 *
 * Separating the two breaks the cycle: both sides import this, this imports
 * nobody.
 */

export const state = { passed: 0, failed: 0, failures: [] };

export function check(name, cond, detail = '') {
  if (cond) {
    state.passed++;
    console.log(`  PASS  ${name}`);
  } else {
    state.failed++;
    state.failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ' - ' + detail : ''}`);
  }
}

/** Assert that a promise rejects, and hand the error back for inspection. */
export async function rejects(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/**
 * The synchronous twin of `rejects`. Returns the error, or null when the call
 * did NOT throw, so `check(e instanceof SomeError)` fails on a silent success
 * rather than passing vacuously.
 */
export function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

export function describe(name) {
  console.log(`\n${name}`);
}
