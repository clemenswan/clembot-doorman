/**
 * The build grade. Five checks, two of which can be `n/a`.
 *
 * The tests that matter here are the ones about the DENOMINATOR, not the sum.
 * A build with no agents and no declared servers must not be punished for
 * having nothing to measure, and that is the whole reason this module is not
 * three lines of addition.
 */

import { check, describe } from './harness.mjs';
import { gradeBuild, letterFor } from '../src/harness-grade.mjs';

/** A build that passes everything it can be measured on. */
function perfect(over = {}) {
  return {
    ok: true,
    root: '/p',
    harnesses: [{ harness: 'Claude Code', evidence: ['CLAUDE.md'] }],
    servers: [{ name: 'deepwiki', source: '.mcp.json' }],
    agents: { count: 2, withMcp: [], dir: '.claude/agents' },
    gate: { installed: true, wired: true, registry: true, allowed: ['deepwiki'], verdict: 'installed and wired' },
    runners: [],
    ...over,
  };
}

describe('harness-grade: bands');
check('90 is an A', letterFor(90) === 'A');
check('89 is a B', letterFor(89) === 'B');
check('60 is a D', letterFor(60) === 'D');
check('59 is an F', letterFor(59) === 'F');
check('no measurable checks has no letter', letterFor(null) === null);

describe('harness-grade: a clean build');
{
  const g = gradeBuild(perfect());
  check('scores full marks', g.earned === g.possible && g.possible === 20, `${g.earned}/${g.possible}`);
  check('grades A', g.letter === 'A');
  check('every check cites evidence',
    g.checks.filter((c) => c.state === 'pass').every((c) => Boolean(c.evidence)));
}

describe('harness-grade: invariant 3 - unmeasured is n/a, never 0');
{
  // No agents dir and no declared servers. Both checks drop out entirely.
  const g = gradeBuild(perfect({
    servers: [],
    agents: { count: 0, withMcp: [], dir: null },
  }));
  const naIds = g.checks.filter((c) => c.state === 'n/a').map((c) => c.id);
  check('exposure is n/a with no agents', naIds.includes('exposure'));
  check('servers-reviewed is n/a with no servers', naIds.includes('servers-reviewed'));
  check('denominator shrinks to the checks that ran', g.possible === 12, `possible=${g.possible}`);
  check('still grades A rather than being punished for having nothing to measure',
    g.letter === 'A', `got ${g.letter} at ${g.pct}%`);
}
{
  // The mutation that matters: if n/a ever scored 0 against a full denominator,
  // this build would land at 12/20 = 60% = D.
  const g = gradeBuild(perfect({ servers: [], agents: { count: 0, withMcp: [], dir: null } }));
  check('n/a checks contribute no max', g.checks.filter((c) => c.state === 'n/a').every((c) => c.max === null));
}

describe('harness-grade: an unreadable trust list is unknown, not failed');
{
  const g = gradeBuild(perfect({ gate: { installed: true, wired: true, registry: true, allowed: null, verdict: 'installed and wired' } }));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('servers-reviewed goes n/a when the allowlist could not be read', sr.state === 'n/a');
}

describe('harness-grade: the gate');
{
  const wired = gradeBuild(perfect()).checks.find((c) => c.id === 'gate');
  const inert = gradeBuild(perfect({
    gate: { installed: true, wired: false, registry: true, allowed: ['deepwiki'], verdict: 'INSTALLED BUT NOT RUNNING' },
  })).checks.find((c) => c.id === 'gate');
  const absent = gradeBuild(perfect({
    gate: { installed: false, wired: false, registry: false, allowed: null, verdict: 'not installed' },
  })).checks.find((c) => c.id === 'gate');

  check('installed-but-inert scores strictly below wired', inert.points < wired.points);
  check('installed-but-inert scores strictly above absent', inert.points > absent.points);
  check('an inert gate is not reported as a pass', inert.state !== 'pass');

  // A plugin gate is wired by the plugin, so a project with no local hook is
  // still gated. Reporting that as a failure was a real bug in doctor.
  const plugin = gradeBuild(perfect({
    gate: { installed: false, wired: false, registry: true, allowed: ['deepwiki'],
            plugin: { present: true, name: 'clembot-doorman', record: 'installed_plugins.json' },
            verdict: 'installed as a PLUGIN' },
  })).checks.find((c) => c.id === 'gate');
  check('a plugin-wired gate scores the same as a locally wired one', plugin.points === wired.points);
}

describe('harness-grade: servers on the trust list');
{
  const g = gradeBuild(perfect({
    servers: [{ name: 'deepwiki', source: '.mcp.json' }, { name: 'rogue', source: '.mcp.json' }],
  }));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('half reviewed scores partial credit', sr.points > 0 && sr.points < sr.max, `${sr.points}/${sr.max}`);
  check('names the server that is not on the list', sr.note.includes('rogue'));
}
{
  const g = gradeBuild(perfect({
    servers: [{ name: 'rogue', source: '.mcp.json' }],
    gate: { installed: true, wired: true, registry: true, allowed: ['deepwiki'], verdict: 'installed and wired' },
  }));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('none reviewed is a fail, not an n/a', sr.state === 'fail' && sr.points === 0);
}

describe('harness-grade: exposure');
{
  const g = gradeBuild(perfect({
    agents: { count: 4, withMcp: [{ agent: 'a', tools: 3 }, { agent: 'b', tools: 1 }], dir: '.claude/agents' },
  }));
  const ex = g.checks.find((c) => c.id === 'exposure');
  check('half the agents exposed scores partial credit', ex.points > 0 && ex.points < ex.max);
  check('reports the count rather than only a score', ex.note.includes('2 of 4'));
}

describe('harness-grade: a failed doctor grades nothing');
{
  const g = gradeBuild({ ok: false, why: 'not a directory' });
  check('no letter', g.letter === null);
  check('no checks', g.checks.length === 0);
}

describe('harness-grade: rounding cannot buy full marks');
{
  // 35 of 36 contained rounds to 3/3, which printed a perfect score beside a
  // warning and a note naming the agent that was still exposed.
  const g = gradeBuild(perfect({
    agents: { count: 36, withMcp: [{ agent: 'one', tools: 2 }], dir: '.claude/agents' },
  }));
  const ex = g.checks.find((c) => c.id === 'exposure');
  check('a check with a shortfall never scores its max', ex.points < ex.max, `${ex.points}/${ex.max}`);
  check('and is not marked pass', ex.state === 'warn');
  check('but still earns most of the points', ex.points === ex.max - 1);
}
{
  const g = gradeBuild(perfect({
    servers: Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, source: '.mcp.json' })),
    gate: { installed: true, wired: true, registry: true,
            allowed: Array.from({ length: 19 }, (_, i) => `s${i}`), verdict: 'installed and wired' },
  }));
  const sr = g.checks.find((c) => c.id === 'servers-reviewed');
  check('19 of 20 reviewed does not score 5/5', sr.points === 4 && sr.state === 'warn', `${sr.points}/${sr.max} ${sr.state}`);
}
{
  // The other half of the rule: clean really does mean full marks.
  const ex = gradeBuild(perfect()).checks.find((c) => c.id === 'exposure');
  check('zero exposed scores the max', ex.points === ex.max && ex.state === 'pass');
}

describe('harness-grade: servers are keyed as the gate sees them');
{
  const g = gradeBuild(perfect({
    servers: [
      { name: 'claude.ai Notion', gateName: 'claude_ai_Notion', source: 'claude.ai account' },
      { name: 'canva', gateName: 'plugin_marketing_canva', source: 'plugin:marketing (synced)' },
      { name: 'slack', gateName: 'plugin_marketing_slack', source: 'plugin:marketing (synced)' },
    ],
    gate: { installed: true, wired: true, registry: true, verdict: 'installed and wired',
            allowed: ['claude_ai_Notion'], denied: ['plugin_marketing_canva'] },
  }));
  const c = g.checks.find((x) => x.id === 'servers-reviewed');
  check('allowed by gate name counts as reviewed, denied counts as reviewed', c.state === 'warn', c.note);
  check('only the undecided server is named', /1 of 3/.test(c.note) && /plugin_marketing_slack/.test(c.note), c.note);
}

describe('harness-grade: no trust list means nothing is reviewed, not n/a');
{
  const g = gradeBuild(perfect({
    gate: { installed: false, wired: false, registry: false, allowed: [], denied: [], verdict: 'not installed' },
  }));
  const c = g.checks.find((x) => x.id === 'servers-reviewed');
  check('scored, and scored zero', c.state === 'fail' && c.points === 0, `${c.state} ${c.points}`);
}

describe('harness-grade: a long unreviewed list stays one readable line');
{
  const servers = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, gateName: `s${i}`, source: 'x' }));
  const g = gradeBuild(perfect({ servers, gate: { ...perfect().gate, allowed: [] } }));
  const c = g.checks.find((x) => x.id === 'servers-reviewed');
  check('five names then a count', /s4 and 4 more/.test(c.note) && !/s5/.test(c.note), c.note);
}
