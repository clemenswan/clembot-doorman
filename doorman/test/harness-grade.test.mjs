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

/* ── The practice half ─────────────────────────────────────────────────────── */

/** Facts as `practiceFacts()` returns them. */
function facts(over = {}) {
  return {
    units: [
      { kind: 'command', name: 'deploy', description: '', source: '.claude/commands/deploy.md' },
      { kind: 'skill', name: 'humanize', description: '', source: '.claude/skills/humanize/SKILL.md' },
    ],
    kinds: ['command', 'skill'],
    scaffolded: { total: 4, covered: 4, prompts: 657 },
    ...over,
  };
}

describe('harness-grade: practice is n/a when nothing measured it');
{
  const g = gradeBuild(perfect());
  const s = g.checks.find((c) => c.id === 'scaffolded');
  const r = g.checks.find((c) => c.id === 'reuse');
  check('both practice checks exist', Boolean(s && r));
  check('and both are n/a', s.state === 'n/a' && r.state === 'n/a');
  check('n/a carries no points and no max', s.points === null && s.max === null);
  check('the note says where to get it measured', /dashboard/i.test(s.note));
  // The whole reason practice is optional: doctor must stay fast and its
  // numbers must not move because a new check was added elsewhere.
  check('the posture score is untouched by their presence',
    g.posture.earned === g.earned && g.posture.possible === g.possible,
    'doctor grades exactly what it did before');
  check('practice tallies to nothing measurable', g.practice.pct === null);
}

describe('harness-grade: repeated work is scaffolded');
{
  const clean = gradeBuild(perfect(), facts()).checks.find((c) => c.id === 'scaffolded');
  check('all covered is full marks', clean.points === 5 && clean.state === 'pass');

  const half = gradeBuild(perfect(), facts({ scaffolded: { total: 4, covered: 2, prompts: 657 } }))
    .checks.find((c) => c.id === 'scaffolded');
  check('half covered scores partially', half.points > 0 && half.points < 5);
  check('and is a warning, not a failure', half.state === 'warn');

  const none = gradeBuild(perfect(), facts({ scaffolded: { total: 4, covered: 0, prompts: 657 } }))
    .checks.find((c) => c.id === 'scaffolded');
  check('none covered scores zero', none.points === 0 && none.state === 'fail');

  // Rounding must never reach full marks while something is still uncovered.
  const nearly = gradeBuild(perfect(), facts({ scaffolded: { total: 40, covered: 39, prompts: 657 } }))
    .checks.find((c) => c.id === 'scaffolded');
  check('39 of 40 does not round up to a clean pass', nearly.points < 5);

  const quiet = gradeBuild(perfect(), facts({ scaffolded: { total: 0, covered: 0, prompts: 657 } }))
    .checks.find((c) => c.id === 'scaffolded');
  check('nothing repeating is n/a, not a zero', quiet.state === 'n/a');
  check('and the note says how much was read', /657/.test(quiet.note));

  const blind = gradeBuild(perfect(), facts({ scaffolded: { total: 0, covered: 0, prompts: null } }))
    .checks.find((c) => c.id === 'scaffolded');
  check('no history reads differently from no repeats',
    /no readable prompt history/i.test(blind.note),
    'a build nobody could measure is not a build with nothing to fix');
}

describe('harness-grade: reusable units exist');
{
  const two = gradeBuild(perfect(), facts()).checks.find((c) => c.id === 'reuse');
  check('two kinds is full marks', two.points === 3 && two.state === 'pass');

  const one = gradeBuild(perfect(), facts({
    units: [{ kind: 'command', name: 'a', description: '', source: '.claude/commands/a.md' }],
    kinds: ['command'],
  })).checks.find((c) => c.id === 'reuse');
  check('one kind is capped below full marks', one.points < 3 && one.points > 0);

  const none = gradeBuild(perfect(), facts({ units: [], kinds: [] }))
    .checks.find((c) => c.id === 'reuse');
  check('no units at all is a fail', none.points === 0 && none.state === 'fail');
  check('and says what that means', /retyped/i.test(none.note));

  // The check must not become a bloat score: more units of the same kind is
  // not more maturity.
  const many = gradeBuild(perfect(), facts({
    units: Array.from({ length: 300 }, (_, i) => ({
      kind: 'command', name: `c${i}`, description: '', source: '.claude/commands/c.md',
    })),
    kinds: ['command'],
  })).checks.find((c) => c.id === 'reuse');
  check('300 units of ONE kind still scores below two kinds',
    many.points < two.points,
    'counting units would reward accumulating them');
}

describe('harness-grade: the two halves');
{
  const g = gradeBuild(perfect(), facts());
  check('every check declares its group', g.checks.every((c) => c.group === 'posture' || c.group === 'practice'));
  check('the groups partition the checks',
    g.checks.filter((c) => c.group === 'posture').length
    + g.checks.filter((c) => c.group === 'practice').length === g.checks.length);
  check('posture and practice sum to the combined total',
    g.posture.earned + g.practice.earned === g.earned
    && g.posture.possible + g.practice.possible === g.possible);
  check('each half carries its own letter',
    g.posture.letter !== null && g.practice.letter !== null);
  check('a half can differ from the combined letter, which is the point', (() => {
    const split = gradeBuild(
      perfect({ gate: { installed: false, wired: false, registry: false, allowed: null, verdict: 'not installed' } }),
      facts(),
    );
    return split.practice.letter === 'A' && split.posture.letter === 'F';
  })(), 'a worked setup with no gate, and a gated setup with no structure, are different builds');
  check('a failed doctor still returns both halves', (() => {
    const g2 = gradeBuild({ ok: false });
    return g2.posture.pct === null && g2.practice.pct === null && g2.letter === null;
  })());
}

describe('harness-grade: a sub-tally counts what it measured');
{
  // `servers: []` makes ONE posture check n/a. The points and max of an n/a
  // check are null, so a tally that adds them with `?? 0` reaches the same
  // total either way: `measured` is the only field that can tell an excluded
  // check from a zero one, which is why it is asserted rather than returned
  // and forgotten.
  const g = gradeBuild(perfect({ servers: [] }), facts());
  const posture = g.checks.filter((c) => c.group === 'posture');
  const na = posture.filter((c) => c.state === 'n/a');

  check('the fixture really does produce an n/a posture check', na.length === 1);
  check('measured counts only the scored checks',
    g.posture.measured === posture.length - 1);
  check('and the practice half counts its own', g.practice.measured === 2);
  check('an n/a check contributes nothing to the possible total',
    g.posture.possible === posture.filter((c) => c.state !== 'n/a')
      .reduce((n, c) => n + c.max, 0));
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
