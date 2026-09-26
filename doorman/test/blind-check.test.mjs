/**
 * A skipped check must not be able to raise a grade in silence.
 *
 * Measured 2026-09-23 against `marketing-bootstrap`, the same target in the
 * same minute, by two copies of doorman BOTH printing `0.2.1`:
 *
 *   29 commits behind   A 14/15   "no MCP servers declared, nothing to review"
 *   origin/main         C 15/20   "35 of 42 not on the trust list"
 *
 * The older copy cannot read `claude.ai` connectors or plugin-synced servers,
 * so it did not FAIL the servers-reviewed check, it SKIPPED it. A skip leaves
 * the denominator (20 becomes 15) rather than scoring zero, which is the right
 * rule for a build that genuinely has no subagents and the wrong outcome here:
 * the check it skipped was the one the build was failing. Blindness read as an A.
 *
 * `no MCP servers declared` is a POSITIVE CLAIM and it was false. That is
 * invariant 3 somewhere it was not looking: an unmeasured thing reported as a
 * measured absence, by a checker that did not know it could not look.
 *
 * Code written today cannot make yesterday's copy honest. What it can do is
 * make the two distinguishable on screen, by saying WHERE it looked. A reader
 * comparing one output that searched five paths against one that also searched
 * the user scope can see which is blind. That is the whole fix.
 */

import { check, describe } from './harness.mjs';
import { gradeBuild } from '../src/harness-grade.mjs';

/** A doctor() result with a wired gate and a readable trust list. */
const build = (over = {}) => ({
  ok: true,
  root: '/tmp/x',
  harnesses: [{ name: 'Claude Code', evidence: '.claude' }],
  gate: { installed: true, wired: true, registry: true, registryPath: 'registry/allowlist.json',
          allowed: ['known'], denied: [], plugin: { present: false }, verdict: 'installed and wired' },
  agents: { count: 0, withMcp: [], dir: null },
  runners: [],
  servers: [],
  ...over,
});

describe('a skipped servers check says where it looked');

{
  const g = gradeBuild(build({ searchedSources: ['.mcp.json', '.claude/settings.json'] }));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('it is still n/a, because a build with no servers is not a bad build',
    sr.state === 'n/a');
  check('but it names how many places it searched',
    /searched 2/i.test(sr.note), sr.note);
  check('and lists them, so two copies can be told apart',
    sr.note.includes('.mcp.json') && sr.note.includes('.claude/settings.json'), sr.note);
  check('it no longer claims bare "nothing to review"',
    !/nothing to review/i.test(sr.note), sr.note);
}

{
  // The origin/main copy searches the same files PLUS the user scope, so its
  // line differs from the stale copy's on exactly the axis that matters.
  const wide = gradeBuild(build({
    searchedSources: ['.mcp.json', '.claude/settings.json', 'claude.ai account', 'plugin scope'],
  }));
  const narrow = gradeBuild(build({ searchedSources: ['.mcp.json', '.claude/settings.json'] }));
  const noteOf = (g) => g.checks.find((c) => c.id === 'servers-reviewed').note;
  check('a wider search reads differently from a narrower one',
    noteOf(wide) !== noteOf(narrow));
  check('the wider one names the user scope',
    /claude\.ai account/.test(noteOf(wide)), noteOf(wide));
}

{
  // A copy too old to report what it searched must not silently look correct.
  // Saying so is the honest degradation; inventing a list would not be.
  const g = gradeBuild(build({}));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('an unreported search is admitted rather than glossed',
    /did not report/i.test(sr.note), sr.note);
  check('and it is still n/a, not a fabricated pass or fail', sr.state === 'n/a');
}

describe('the grade still behaves');

{
  const g = gradeBuild(build({ searchedSources: ['.mcp.json'] }));
  check('a skipped check is still out of the denominator',
    !g.checks.find((c) => c.id === 'servers-reviewed').max);
  check('the build still grades', typeof g.pct === 'number');
}

{
  // The path that actually matters: servers present and unreviewed must still
  // SCORE, never skip. This is the regression the whole file guards.
  const g = gradeBuild(build({
    servers: [{ name: 'known', gateName: 'known', source: '.mcp.json' },
              { name: 'stranger', gateName: 'stranger', source: '.mcp.json' }],
    searchedSources: ['.mcp.json'],
  }));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('with servers found, the check is scored not skipped', sr.state !== 'n/a');
  check('and it counts the unreviewed one', /1 of 2/.test(sr.note), sr.note);
  check('the denominator includes it', sr.max === 5);
}

describe('doctor actually supplies it');

{
  // Every test above hands `searchedSources` to gradeBuild directly, so all of
  // them would pass while doctor stopped supplying it and the live output went
  // back to "did not report". That is invariant 26's shape: correct logic, a
  // caller that never learned about it. So drive doctor, do not grep for it.
  const { doctor } = await import('../cli/doctor.mjs');
  const { MCP_CONFIG_SOURCES } = await import('../src/inventory.mjs');
  const { USER_SCOPE_SOURCES } = await import('../src/reachable-servers.mjs');

  const d = await doctor(process.cwd(), { env: {} });
  check('doctor returns the list it searched', Array.isArray(d.searchedSources));
  check('it covers the per-project files',
    MCP_CONFIG_SOURCES.every((f) => d.searchedSources.includes(f)),
    JSON.stringify(d.searchedSources));
  check('and the user scope, which is the half a stale copy cannot see',
    USER_SCOPE_SOURCES.every((f) => d.searchedSources.includes(f)),
    JSON.stringify(d.searchedSources));

  const g = gradeBuild(d);
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('so a real run never falls back to the "did not report" line',
    !/did not report/i.test(sr.note || ''), sr.note);
}
