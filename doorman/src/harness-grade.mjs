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
export function partial(ratio, max, clean) {
  if (clean) return max;
  return Math.max(0, Math.min(Math.round(ratio * max), max - 1));
}

export function stateFor(points, max, clean) {
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

/** Sub-totals over one group, renormalised the same way the whole grade is. */
function tally(checks) {
  const scored = checks.filter((c) => c.state !== 'n/a');
  const earned = scored.reduce((n, c) => n + c.points, 0);
  const possible = scored.reduce((n, c) => n + c.max, 0);
  const pct = possible ? Math.round((earned / possible) * 100) : null;
  return { earned, possible, pct, letter: letterFor(pct), measured: scored.length };
}

/**
 * @param {object} d - a `doctor()` result (ok:true).
 * @param {object|null} p - `practiceFacts()` from src/units.mjs, or null.
 *
 * TWO HALVES, REPORTED SEPARATELY.
 *
 * `posture` is whether this build is gated: the five checks this project was
 * originally built around. `practice` is whether it is a worked setup or a bare
 * one. They are different questions and a single letter hides that, so both
 * sub-totals are returned alongside the combined one. Same instinct as
 * invariant 17: a layer measured separately does not get folded back in and
 * quietly paid for twice.
 *
 * The combined letter is still the headline, because a report needs one, and it
 * renormalises over measured checks exactly as before.
 *
 * WHEN `p` IS NULL the practice checks are `n/a`, not zero. That is invariant 3
 * and it is also what keeps `doctor` honest: doctor promises offline and under
 * five milliseconds, clustering a few hundred prompts is neither, so doctor
 * passes nothing and the checks say they were not measured rather than failed.
 *
 * @returns {{checks: Array, earned: number, possible: number, pct: number|null,
 *            letter: string|null, posture: object, practice: object}}
 */
export function gradeBuild(d, p = null) {
  if (!d || !d.ok) {
    return {
      checks: [], earned: 0, possible: 0, pct: null, letter: null,
      posture: tally([]), practice: tally([]),
    };
  }

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
    // "No servers declared" is a POSITIVE CLAIM, and a checker that cannot read
    // a config format it has never heard of will make it confidently. On
    // 2026-09-23 two copies of doorman both printing 0.2.1 graded the same
    // build A 14/15 and C 15/20, because the older one could not see claude.ai
    // connectors or plugin-synced servers and so SKIPPED the check it was
    // failing. A skip leaves the denominator, so blindness read as an A.
    //
    // Code written now cannot make an older copy honest. It can make the two
    // distinguishable, by saying where it looked. A reader comparing a run that
    // searched two paths against one that also searched the user scope can see
    // which is blind. Invariant 3: unmeasured is not a measured zero.
    const searched = Array.isArray(d.searchedSources) ? d.searchedSources : null;
    checks.push(na('servers-reviewed', 'Declared servers reviewed',
      searched
        ? `no MCP servers found, searched ${searched.length}: ${searched.join(', ')}. `
          + 'Zero here means none were declared in those places, not that none exist'
        : 'no MCP servers found, and this build of doorman did not report which '
          + 'places it searched, so blindness and an empty build are '
          + 'indistinguishable from this line'));
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

  // Everything above is POSTURE: is this build gated. Everything below is
  // PRACTICE: is it a worked setup or a bare one. Marked before the practice
  // checks are pushed so the split cannot drift as checks are added.
  for (const c of checks) c.group = 'posture';

  // ── 6. Are repeated procedures scaffolded? ─────────────────────────────────
  //
  // The one check that measures ops maturity rather than counting artifacts.
  // "Do you have commands" rewards accumulating them; this asks whether the
  // procedures you actually repeat have one, which cannot be gamed by adding
  // units nobody runs.
  const s = p && p.scaffolded;
  if (!s) {
    checks.push(na('scaffolded', 'Repeated work is scaffolded',
      'not measured here: it reads prompt history, which doctor deliberately does not. Run doorman dashboard.'));
  } else if (s.total === 0) {
    checks.push(na('scaffolded', 'Repeated work is scaffolded',
      s.prompts
        ? `no procedure repeated across sessions in ${s.prompts} prompts, so there is nothing to scaffold`
        : 'no readable prompt history, so repetition could not be measured'));
  } else {
    const ratio = s.covered / s.total;
    const clean = s.covered === s.total;
    const points = partial(ratio, 5, clean);
    checks.push(check('scaffolded', 'Repeated work is scaffolded',
      stateFor(points, 5, clean), points, 5, 'prompt history',
      `${s.covered} of ${s.total} procedure(s) that repeat across sessions have a command, skill or agent`));
  }

  // ── 7. Is there reusable structure at all? ─────────────────────────────────
  //
  // Full marks need MORE THAN ONE KIND, not more units. A build with fifty
  // commands and no subagents has not discovered subagents, and a build with
  // three hundred of anything is not thereby mature. Counting units would make
  // this a bloat score, which is the opposite of what it is for.
  const units = (p && p.units) || null;
  if (!units) {
    checks.push(na('reuse', 'Reusable units exist',
      'not measured here. Run doorman dashboard.'));
  } else if (!units.length) {
    checks.push(check('reuse', 'Reusable units exist', 'fail', 0, 3, null,
      'no commands, agents or skills: every procedure is retyped from scratch'));
  } else {
    const kinds = (p.kinds && p.kinds.length) || 0;
    const clean = kinds >= 2;
    const points = partial(kinds / 2, 3, clean);
    checks.push(check('reuse', 'Reusable units exist',
      stateFor(points, 3, clean), points, 3,
      [...new Set(units.map((u) => u.source.split('/').slice(0, -1).join('/')))].slice(0, 3).join(', '),
      `${units.length} unit(s) across ${kinds} kind(s): ${(p.kinds || []).join(', ')}`));
  }

  for (const c of checks) if (!c.group) c.group = 'practice';

  const scored = checks.filter((c) => c.state !== 'n/a');
  const earned = scored.reduce((n, c) => n + c.points, 0);
  const possible = scored.reduce((n, c) => n + c.max, 0);
  const pct = possible ? Math.round((earned / possible) * 100) : null;

  return {
    checks,
    earned,
    possible,
    pct,
    letter: letterFor(pct),
    posture: tally(checks.filter((c) => c.group === 'posture')),
    practice: tally(checks.filter((c) => c.group === 'practice')),
  };
}
