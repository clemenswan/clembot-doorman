/**
 * A letter grade for YOUR BUILD, computed only from what `doorman doctor`
 * actually observed.
 *
 * Invariant 9 says never fabricate a grade. That is not a ban on grading, it is
 * a ban on a number nobody can argue with, so every rule here is arithmetic over
 * a fact doctor already reported, and every check carries the file that proved
 * it. The renderer prints the whole scorecard, never the letter alone: a letter
 * you cannot recompute by hand is the thing invariant 9 is actually about.
 *
 * Invariant 3 applies too, and it is the reason this file is longer than a sum.
 * A project with no `.claude/agents/` has not FAILED the exposure check, it has
 * no exposure to measure, and scoring that 0 would rank a build with no agents
 * below one with agents that are wired correctly. Those checks return `n/a` and
 * drop out of the denominator.
 *
 * What is deliberately NOT graded: `doorman needs`. A capability gap is a
 * recommendation about tools you do not have, not a defect in the build you do
 * have, and folding it in would mean a build loses points for asking questions.
 *
 * Pure. No file reads, no network, no clock.
 */

/** Bands. Ordered high to low; the first hit wins. */
const BANDS = [
  [90, 'A'],
  [80, 'B'],
  [70, 'C'],
  [60, 'D'],
];

export function letterFor(pct) {
  if (pct === null || Number.isNaN(pct)) return null;
  for (const [floor, letter] of BANDS) if (pct >= floor) return letter;
  return 'F';
}

/**
 * Partial credit that cannot round its way to full marks.
 *
 * 35 of 36 subagents contained is 97%, and `Math.round(0.97 * 3)` is 3, so the
 * page printed "3/3" beside a warning triangle and a note naming the agent that
 * was still exposed. A full score that arrives with a caveat is the kind of
 * number a reader stops believing, and rightly: either nothing is wrong or the
 * score should not be perfect. Full marks now require a clean check, and
 * everything short of that caps one below.
 */
function partial(ratio, max, clean) {
  if (clean) return max;
  return Math.max(0, Math.min(Math.round(ratio * max), max - 1));
}

function stateFor(points, max, clean) {
  if (clean) return 'pass';
  return points === 0 ? 'fail' : 'warn';
}

/** Five names and a count. The full list is the servers table, not a check note. */
const nameList = (names) => names.length > 5
  ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`
  : names.join(', ');

/** `n/a` checks never reach here; they carry no points and no max. */
function check(id, label, state, points, max, evidence, note = null) {
  return { id, label, state, points, max, evidence, note };
}

function na(id, label, why) {
  return { id, label, state: 'n/a', points: null, max: null, evidence: null, note: why };
}

/**
 * @param {object} d - a `doctor()` result (ok:true).
 * @returns {{checks: Array, earned: number, possible: number, pct: number|null, letter: string|null}}
 */
export function gradeBuild(d) {
  if (!d || !d.ok) return { checks: [], earned: 0, possible: 0, pct: null, letter: null };

  const checks = [];

  // 1. Harness. Without one, nothing else in this report has a consumer.
  const harnesses = d.harnesses || [];
  checks.push(harnesses.length
    ? check('harness', 'Harness detected', 'pass', 4, 4,
        harnesses.flatMap((h) => h.evidence).join(', '),
        harnesses.map((h) => h.harness).join(', '))
    : check('harness', 'Harness detected', 'fail', 0, 4, null,
        'no .claude, CLAUDE.md, AGENTS.md, .cursor, .windsurf or .gemini found'));

  // 2. The gate. Installed-and-not-wired scores above absent but nowhere near
  //    wired, because the two look identical from the outside: both are quiet.
  const g = d.gate || {};
  const gateWired = Boolean(g.wired || g.plugin?.present);
  checks.push(gateWired
    ? check('gate', 'Gate wired', 'pass', 5, 5,
        g.plugin?.present && !g.installed ? g.plugin.record : '.claude/settings.json',
        g.verdict)
    : g.installed
      ? check('gate', 'Gate wired', 'warn', 1, 5, '.claude/hooks/mcp-gate.sh',
          'hook present but no entry in settings.json, so it is not running')
      : check('gate', 'Gate wired', 'fail', 0, 5, null, 'no gate installed'));

  // 3. The trust list. A wired gate with no registry blocks everything, which is
  //    a different failure from having no gate, and both are worth 0 here.
  checks.push(g.registry
    ? check('registry', 'Trust list present', 'pass', 3, 3, g.registryPath || 'registry/allowlist.json')
    : check('registry', 'Trust list present', 'fail', 0, 3, null,
        'no registry/allowlist.json: a wired gate would refuse every call'));

  // 4. Declared servers that appear on the trust list. This is the check the
  //    whole project exists for, so it carries the most points.
  const servers = d.servers || [];
  // Reviewed means a human decided, either way. A denylisted server was reviewed
  // and refused; counting it as unreviewed would tell the user to go review it.
  const decided = new Set([...(g.allowed || []), ...(g.denied || [])]);
  const key = (s) => s.gateName ?? s.name;
  if (!servers.length) {
    checks.push(na('servers-reviewed', 'Declared servers reviewed',
      'no MCP servers declared, so there is nothing to review'));
  } else if (!g.allowed) {
    checks.push(na('servers-reviewed', 'Declared servers reviewed',
      'trust list unreadable, so review status is unknown rather than failed'));
  } else {
    const unreviewed = servers.filter((s) => !decided.has(key(s)));
    const ratio = (servers.length - unreviewed.length) / servers.length;
    const points = partial(ratio, 5, unreviewed.length === 0);
    checks.push(check('servers-reviewed', 'Declared servers reviewed',
      stateFor(points, 5, unreviewed.length === 0),
      points, 5,
      servers.map((s) => s.source).filter((v, i, a) => a.indexOf(v) === i).join(', '),
      unreviewed.length
        ? `${unreviewed.length} of ${servers.length} not on the trust list: ${nameList(unreviewed.map(key))}`
        : `all ${servers.length} on the trust list`));
  }

  // 5. Exposure. A tool handed to every agent costs every agent. Scored as the
  //    share of subagents NOT carrying MCP tool names, because the cheap build
  //    is the one where the blast radius is small, not the one with no tools.
  const agents = d.agents || { count: 0, withMcp: [] };
  if (!agents.count) {
    checks.push(na('exposure', 'Agent exposure contained',
      'no .claude/agents/ directory, so there is no exposure to measure'));
  } else {
    const exposed = (agents.withMcp || []).length;
    const contained = (agents.count - exposed) / agents.count;
    const points = partial(contained, 3, exposed === 0);
    checks.push(check('exposure', 'Agent exposure contained',
      stateFor(points, 3, exposed === 0),
      points, 3, agents.dir,
      `${exposed} of ${agents.count} subagent(s) reference an MCP tool by name`));
  }

  const scored = checks.filter((c) => c.state !== 'n/a');
  const earned = scored.reduce((n, c) => n + c.points, 0);
  const possible = scored.reduce((n, c) => n + c.max, 0);
  const pct = possible ? Math.round((earned / possible) * 100) : null;

  return { checks, earned, possible, pct, letter: letterFor(pct) };
}
