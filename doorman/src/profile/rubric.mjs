/**
 * Seven dimensions, ten checks, each with a receipt.
 *
 * ── Ten, not thirty-five ─────────────────────────────────────────────────────
 *
 * Every check here is one somebody can run by hand against a real `.claude/`
 * tree and agree or disagree with. `needs.mjs` states the discipline: a
 * taxonomy that looks thorough and cannot be checked by hand is a confident
 * wrong answer waiting for a user. The table is data, so a check is a row.
 *
 * ── No ladder ────────────────────────────────────────────────────────────────
 *
 * An earlier draft mapped dimensions onto a seven rung maturity ladder with
 * named levels. The names did not exist, so inventing them would have shipped
 * vocabulary nobody chose, in a published profile format, which is the exact
 * shape of invariant 9. Dimensions carry the letter bands `harness-grade.mjs`
 * already uses, and the overall letter is CAPPED BY THE WORST DIMENSION: a
 * harness is as mature as its weakest gate. That rule was the useful half of
 * the ladder idea and it survives without the naming.
 *
 * ── Fail closed, everywhere ──────────────────────────────────────────────────
 *
 * An unreadable or unparseable file counts against the dimension it belongs
 * to. A malformed `settings.json` must not read as "no dangerous permissions
 * found", because that is the sentence a clean one produces too.
 *
 * ── n/a is not zero ──────────────────────────────────────────────────────────
 *
 * A repo with no agents has no agent exposure to measure, and scoring that
 * zero ranks it below a repo whose agents are wired badly. Invariant 3, and
 * the same `n/a` mechanism `harness-grade.mjs` uses.
 *
 * Pure apart from the surface it is handed. No file reads of its own.
 */

import { letterFor, partial, stateFor } from '../harness-grade.mjs';
import { filesUnder, fileAt, lineOf, receipt, parseFrontmatter } from './surface.mjs';

export const DIMENSIONS = [
  { id: 1, key: 'permission-hygiene', title: 'Permission hygiene' },
  { id: 2, key: 'human-gates', title: 'Human gates' },
  { id: 3, key: 'evidence', title: 'Evidence and auditability' },
  { id: 4, key: 'tool-vetting', title: 'Tool vetting' },
  { id: 5, key: 'parallelism', title: 'Parallelism safety' },
  { id: 6, key: 'memory-handoff', title: 'Memory and handoff' },
  { id: 7, key: 'registry-hygiene', title: 'Registry hygiene' },
];

/**
 * The marker `doorman fix` writes into every file it generates.
 *
 * It lives HERE rather than in `fix.mjs` because `fix.mjs` already imports
 * `agentsOf` from this module, and importing back the other way would be a
 * cycle. The grader is also the side that must not be fooled, so the constant
 * belongs to the grader and the fixer borrows it.
 */
export const GENERATED_MARKER = 'doorman:generated';

const WRITE_TOOLS = /\b(Write|Edit|MultiEdit|NotebookEdit)\b/;

/** Agents, with frontmatter parsed once so ten checks do not parse it ten times. */
export function agentsOf(surface) {
  return filesUnder(surface, '.claude/agents/').map((f) => {
    const fm = parseFrontmatter(f.raw) ?? {};
    const tools = typeof fm.tools === 'string' ? fm.tools : null;
    return {
      file: f,
      name: f.path.split('/').pop().replace(/\.md$/, ''),
      fm,
      tools,
      declaresTools: tools !== null,
      // No declaration means we do not know, and "we do not know" resolves to
      // the unsafe reading rather than the convenient one.
      canWrite: tools === null ? null : WRITE_TOOLS.test(tools) || /\*/.test(tools),
      isolated: Boolean(fm.isolation),
    };
  });
}

const mk = (id, dimension, title, o) => ({ id, dimension, title, ...o });
const NA = (id, dim, title, why) =>
  mk(id, dim, title, { state: 'n/a', points: null, max: null, receipt: null, note: why });

/* ── 1. Permission hygiene ─────────────────────────────────────────────────── */

function permExplicit(s) {
  const f = s.files.get('.claude/settings.json');
  const local = s.files.get('.claude/settings.local.json');
  const any = f || local;
  if (!any) {
    return mk('perm-explicit', 1, 'Permissions are declared explicitly', {
      state: 'fail', points: 0, max: 4, receipt: 'absent',
      note: 'no .claude/settings.json: every tool runs on the harness default rather than a decision',
    });
  }
  if (any.problem) {
    return mk('perm-explicit', 1, 'Permissions are declared explicitly', {
      state: 'fail', points: 0, max: 4, receipt: any.path,
      note: `${any.path} did not parse (${any.problem}), so its permissions cannot be read and count against this`,
    });
  }
  const perms = any.json?.permissions;
  const allow = perms?.allow?.length ?? 0;
  const deny = perms?.deny?.length ?? 0;
  if (!perms || (!allow && !deny)) {
    return mk('perm-explicit', 1, 'Permissions are declared explicitly', {
      state: 'fail', points: 0, max: 4, receipt: receipt(any, /"permissions"/),
      note: 'no permissions block, or one with neither allow nor deny entries',
    });
  }
  const clean = allow > 0 && deny > 0;
  const points = partial(clean ? 1 : 0.5, 4, clean);
  return mk('perm-explicit', 1, 'Permissions are declared explicitly', {
    state: stateFor(points, 4, clean), points, max: 4,
    receipt: receipt(any, /"permissions"/),
    note: clean
      ? `${allow} allow and ${deny} deny entries`
      : `${allow} allow, ${deny} deny: a list with only one side states half a policy`,
  });
}

function permBashWildcard(s) {
  const files = ['.claude/settings.json', '.claude/settings.local.json']
    .map((p) => s.files.get(p)).filter(Boolean).filter((f) => !f.problem);
  if (!files.length) {
    return NA('perm-bash-wildcard', 1, 'No unscoped Bash wildcard',
      'no readable settings file, so there is no allow list to inspect');
  }
  const bad = [];
  for (const f of files) {
    for (const rule of f.json?.permissions?.allow ?? []) {
      const r = String(rule);
      if (r === 'Bash' || /^Bash\(\s*\*\s*\)$/.test(r) || /^Bash\(\*/.test(r)) bad.push({ f, r });
    }
  }
  if (!bad.length) {
    return mk('perm-bash-wildcard', 1, 'No unscoped Bash wildcard', {
      state: 'pass', points: 3, max: 3, receipt: receipt(files[0], /"allow"/),
      note: 'no Bash wildcard in any allow list',
    });
  }
  return mk('perm-bash-wildcard', 1, 'No unscoped Bash wildcard', {
    state: 'fail', points: 0, max: 3,
    receipt: receipt(bad[0].f, /Bash/),
    note: `${bad.length} unscoped Bash allow entr${bad.length === 1 ? 'y' : 'ies'}: ${[...new Set(bad.map((b) => b.r))].join(', ')}. A wildcard allow makes the deny list the only control left.`,
  });
}

/* ── 2. Human gates ────────────────────────────────────────────────────────── */

function gateToolsDeclared(s) {
  const agents = agentsOf(s);
  if (!agents.length) {
    return NA('gate-tools-declared', 2, 'Every agent declares its tools',
      'no .claude/agents/, so there are no agents to classify');
  }
  const undeclared = agents.filter((a) => !a.declaresTools);
  const clean = undeclared.length === 0;
  const points = partial((agents.length - undeclared.length) / agents.length, 4, clean);
  return mk('gate-tools-declared', 2, 'Every agent declares its tools', {
    state: stateFor(points, 4, clean), points, max: 4,
    receipt: undeclared.length ? undeclared[0].file.path : agents[0].file.path,
    note: clean
      ? `all ${agents.length} agents declare a tools field`
      : `${undeclared.length} of ${agents.length} declare no tools, so what they may do is unknown and resolves to approval-gated: ${undeclared.slice(0, 3).map((a) => a.name).join(', ')}`,
  });
}

/**
 * Docs that can carry a dispatch decision: who runs this agent, and when.
 *
 * Being NAMED in one is a gate. This is the correction that mattered most in
 * the first real run: the check used to demand `isolation:` specifically, and
 * scored a vault where all 21 write-capable agents are documented in a
 * dispatch table as though none of them were gated at all.
 *
 * Demanding one mechanism is not the same as demanding a gate. Worse, taking
 * that finding at face value would have meant stamping `isolation: worktree`
 * onto nineteen agents that write to declared in-place paths, which strands
 * every output and breaks every in-place editor. A check whose fix breaks the
 * build is measuring the wrong thing.
 */
const GATE_DOCS = [
  'CLAUDE.md', 'AGENTS.md',
  '.claude/rules/agent-dispatch.md', '.claude/rules/security.md',
  '.claude/skills/INSTALLED.md',
];

function gateWriteDeclared(s) {
  const agents = agentsOf(s);
  const writers = agents.filter((a) => a.canWrite === true || a.canWrite === null);
  if (!agents.length) {
    return NA('gate-write-declared', 2, 'Write-capable agents declare a gate',
      'no .claude/agents/, so there is nothing to gate');
  }
  if (!writers.length) {
    return NA('gate-write-declared', 2, 'Write-capable agents declare a gate',
      'no agent declares a write-capable tool');
  }

  // Any one of three is a gate: run in your own tree, declare where you may
  // write, or be documented as dispatched. Nothing is not.
  //
  // A DOORMAN-GENERATED DOC IS NOT A HUMAN GATE, and this exclusion is the
  // whole reason that sentence is here. `doorman fix reg-drift` writes
  // `.claude/rules/command-registry.md` listing every agent and command on
  // disk, which is the correct fix for reg-drift because that check measures
  // ENUMERATION and a generated enumeration is a real one. This check measures
  // REVIEW: "documented dispatch" is meant to be a human having written down
  // who starts this agent. Measured on a fresh build 2026-09-24, applying the
  // reg-drift patch moved this check from 0/4 to 4/4 as a side effect, because
  // the generated table names all three agents in a rules file. The tool would
  // have been raising a review score by writing a document to itself.
  //
  // Same rule as invariant 38, pointed at the rubric rather than at the fixer:
  // a fix may change the property, never only the text that proves it. Here it
  // is the grader's job not to accept the tool's own output as testimony.
  const docs = [
    ...GATE_DOCS.map((p) => fileAt(s, p)),
    ...filesUnder(s, '.claude/rules/'),
  ].filter(Boolean).filter((d) => !d.raw.includes(GENERATED_MARKER));
  const named = (a) => docs.some((d) => d.raw.includes(a.name));
  const gateOf = (a) => (a.isolated ? 'isolation'
    : a.fm['allowed-paths'] ? 'allowed-paths'
      : named(a) ? 'documented dispatch' : null);

  const ungated = writers.filter((a) => gateOf(a) === null);
  const clean = ungated.length === 0;
  const points = partial((writers.length - ungated.length) / writers.length, 4, clean);
  const kinds = [...new Set(writers.map(gateOf).filter(Boolean))].sort();
  return mk('gate-write-declared', 2, 'Write-capable agents declare a gate', {
    state: stateFor(points, 4, clean), points, max: 4,
    receipt: ungated.length ? ungated[0].file.path : writers[0].file.path,
    note: clean
      ? `all ${writers.length} write-capable agents are gated (${kinds.join(', ')})`
      : `${ungated.length} of ${writers.length} write-capable agents declare no isolation, no allowed-paths, and appear in no dispatch doc: ${ungated.slice(0, 3).map((a) => a.name).join(', ')}`,
  });
}

/* ── 3. Evidence and auditability ──────────────────────────────────────────── */

const EVIDENCE_WORD = /\b(lineage|evidence|handoff|session-end|checkpoint|audit log|proof of work)\b/i;

function evidenceConvention(s) {
  const cmd = filesUnder(s, '.claude/commands/')
    .find((f) => /session-end|checkpoint|pow|lineage|handoff/i.test(f.path));
  const claude = fileAt(s, 'CLAUDE.md');
  const declared = claude && EVIDENCE_WORD.test(claude.raw);

  if (cmd && declared) {
    return mk('evidence-convention', 3, 'An evidence convention exists and is referenced', {
      state: 'pass', points: 5, max: 5, receipt: `${cmd.path}:1`,
      note: `a ${cmd.path.split('/').pop().replace(/\.md$/, '')} command exists and CLAUDE.md names the convention`,
    });
  }
  if (cmd || declared) {
    return mk('evidence-convention', 3, 'An evidence convention exists and is referenced', {
      state: 'warn', points: 2, max: 5,
      receipt: cmd ? `${cmd.path}:1` : receipt(claude, EVIDENCE_WORD),
      note: cmd
        ? 'a checkpoint command exists but CLAUDE.md does not name an evidence convention, so nothing tells an agent to use it'
        : 'CLAUDE.md names an evidence convention but no command implements it',
    });
  }
  return mk('evidence-convention', 3, 'An evidence convention exists and is referenced', {
    state: 'fail', points: 0, max: 5, receipt: 'absent',
    note: 'no checkpoint command and no evidence convention named in CLAUDE.md: work leaves no auditable trail',
  });
}

/* ── 4. Tool vetting ───────────────────────────────────────────────────────── */

function serversOf(s) {
  const f = s.files.get('.mcp.json');
  if (!f || f.problem) return { f, servers: null };
  return { f, servers: Object.keys(f.json?.mcpServers ?? {}) };
}

function vetRegistry(s) {
  const { f, servers } = serversOf(s);
  if (!f) {
    return NA('vet-registry', 4, 'Declared MCP servers appear in a registry',
      'no .mcp.json, so no servers are declared');
  }
  if (servers === null) {
    return mk('vet-registry', 4, 'Declared MCP servers appear in a registry', {
      state: 'fail', points: 0, max: 4, receipt: f.path,
      note: `.mcp.json did not parse (${f.problem}), so its servers cannot be checked against any registry`,
    });
  }
  if (!servers.length) {
    return NA('vet-registry', 4, 'Declared MCP servers appear in a registry',
      '.mcp.json declares no servers');
  }
  // A registry is any surface file that names the server and gives it a status.
  //
  // MEASURE THE PROPERTY, NOT ONE MECHANISM. This listed only prose surfaces
  // (.claude/rules/, INSTALLED.md) and therefore could not see doorman's own
  // registry/allowlist.json, so a harness that had actually installed the gate
  // scored 0/4 here while every one of its servers was registered. Demanding a
  // particular file is not the same as demanding that servers be vetted, and
  // the fix for the old finding was to write prose duplicating a registry that
  // already existed. Same error as gate-write-isolation.
  const haystacks = [
    ...filesUnder(s, '.claude/rules/'),
    ...(fileAt(s, '.claude/skills/INSTALLED.md') ? [fileAt(s, '.claude/skills/INSTALLED.md')] : []),
    ...(fileAt(s, 'registry/allowlist.json') ? [fileAt(s, 'registry/allowlist.json')] : []),
  ];
  const missing = servers.filter((n) => !haystacks.some((h) => h.raw.includes(n)));
  const clean = missing.length === 0 && haystacks.length > 0;
  if (!haystacks.length) {
    return mk('vet-registry', 4, 'Declared MCP servers appear in a registry', {
      state: 'fail', points: 0, max: 4, receipt: 'absent',
      note: `${servers.length} server(s) declared and no registry anywhere in .claude/rules/, INSTALLED.md or registry/allowlist.json to record a status against`,
    });
  }
  const points = partial((servers.length - missing.length) / servers.length, 4, clean);
  // Cite the registry that ACTUALLY names a server, not simply the first file
  // searched. This used to be `haystacks[0].path`, which on a pass pointed at
  // whichever rules file sorted first, usually one that does not mention the
  // server at all. A receipt exists so a human can look and see for
  // themselves; one pointing at the wrong file is worse than none, because it
  // spends their trust before it fails them.
  const matched = haystacks.find((h) => servers.some((n) => h.raw.includes(n)));
  return mk('vet-registry', 4, 'Declared MCP servers appear in a registry', {
    state: stateFor(points, 4, clean), points, max: 4,
    receipt: (matched ?? haystacks[0]).path,
    note: clean
      ? `all ${servers.length} declared server(s) appear in a registry`
      : `${missing.length} of ${servers.length} not in any registry: ${missing.slice(0, 3).join(', ')}`,
  });
}

function vetDeclinedLedger(s) {
  const installed = fileAt(s, '.claude/skills/INSTALLED.md');
  const rules = filesUnder(s, '.claude/rules/');
  const DECLINED = /\b(declined|deprecated|rejected|banned|denylist|do not use)\b/i;
  const hit = [installed, ...rules].filter(Boolean).find((f) => DECLINED.test(f.raw));
  if (hit) {
    return mk('vet-declined-ledger', 4, 'A declined-tools ledger exists', {
      state: 'pass', points: 3, max: 3, receipt: receipt(hit, DECLINED),
      note: 'a record of what was rejected, not only what was adopted',
    });
  }
  return mk('vet-declined-ledger', 4, 'A declined-tools ledger exists', {
    state: 'fail', points: 0, max: 3, receipt: 'absent',
    note: 'nothing records a declined or deprecated tool, so a rejected candidate can be re-proposed forever',
  });
}

/* ── 5. Parallelism safety ─────────────────────────────────────────────────── */

function parSharedWriter(s) {
  // canWrite === null is an agent that declares NO tools, so it inherits
  // whatever the parent holds and may write anywhere. Counting it here is the
  // same fail-closed rule dimension 2 uses; leaving it out was an
  // inconsistency, and the unbounded agent is exactly the concurrency risk.
  const writers = agentsOf(s).filter((a) => a.canWrite === true || a.canWrite === null);
  if (writers.length < 2) {
    return NA('par-shared-writer', 5, 'Concurrent writers are isolated',
      writers.length
        ? 'only one write-capable agent, so two of them cannot collide'
        : 'no write-capable agents declared');
  }
  // Bounded by a tree of its own, or by a declared path. Being DOCUMENTED is
  // a gate for dimension 2 and is not one here: a dispatch table says who
  // starts an agent, and says nothing about what happens when two of them run
  // at once. This vault has the receipts for that distinction, in two recorded
  // lessons about a shared checkout reverting edits mid-session.
  const unbounded = writers.filter((a) => !a.isolated && !a.fm['allowed-paths']);
  const clean = unbounded.length === 0;
  const points = partial((writers.length - unbounded.length) / writers.length, 4, clean);
  return mk('par-shared-writer', 5, 'Concurrent writers are bounded', {
    state: stateFor(points, 4, clean), points, max: 4,
    receipt: unbounded.length ? unbounded[0].file.path : writers[0].file.path,
    note: clean
      ? `all ${writers.length} write-capable agents are bounded by isolation or allowed-paths`
      : `${unbounded.length} of ${writers.length} write-capable agents declare neither isolation nor allowed-paths, so each may write anywhere and two runs can interleave on one file. Note that allowed-paths is a DECLARATION: it is enforced by review, not by the harness.`,
  });
}

/* ── 6. Memory and handoff ─────────────────────────────────────────────────── */

const HANDOFF_WORD = /\b(HANDOFF|STATE\.md|primer|memory\/|decisions\.md|session state)\b/i;

function memHandoff(s) {
  const claude = fileAt(s, 'CLAUDE.md');
  const referenced = claude && HANDOFF_WORD.test(claude.raw);
  const cmd = filesUnder(s, '.claude/commands/').find((f) => /handoff|resume|prime|session/i.test(f.path));
  if (referenced && cmd) {
    return mk('mem-handoff', 6, 'Cross-session state exists and is referenced', {
      state: 'pass', points: 4, max: 4, receipt: receipt(claude, HANDOFF_WORD),
      note: `CLAUDE.md names a handoff convention and ${cmd.path.split('/').pop()} implements it`,
    });
  }
  if (referenced || cmd) {
    return mk('mem-handoff', 6, 'Cross-session state exists and is referenced', {
      state: 'warn', points: 2, max: 4,
      receipt: referenced ? receipt(claude, HANDOFF_WORD) : cmd.path,
      note: referenced
        ? 'a handoff convention is named but no command maintains it, so it goes stale silently'
        : 'a session command exists but CLAUDE.md never tells an agent to read its output',
    });
  }
  return mk('mem-handoff', 6, 'Cross-session state exists and is referenced', {
    state: 'fail', points: 0, max: 4, receipt: 'absent',
    note: 'no cross-session state: every session starts from zero and re-derives what the last one decided',
  });
}

/* ── 7. Registry hygiene ───────────────────────────────────────────────────── */

/** Below this there is nothing for a registry to drift FROM. */
export const DRIFT_FLOOR = 5;

function regDrift(s) {
  const agents = filesUnder(s, '.claude/agents/').map((f) => f.path.split('/').pop().replace(/\.md$/, ''));
  const commands = filesUnder(s, '.claude/commands/').map((f) => f.path.split('/').pop().replace(/\.md$/, ''));
  const units = [...agents, ...commands];
  if (units.length < DRIFT_FLOOR) {
    return NA('reg-drift', 7, 'The registry lists what is on disk',
      `${units.length} agent(s) and command(s), below the ${DRIFT_FLOOR} where a written registry earns its keep`);
  }
  // A registry split across files is still a registry. Checking only the
  // first doc found failed a fixture whose agents are listed in CLAUDE.md
  // because an INSTALLED.md existed for skills, which is a filing decision
  // rather than drift. A unit counts as documented if ANY surface doc names it.
  const docs = [
    fileAt(s, '.claude/skills/INSTALLED.md'),
    fileAt(s, 'CLAUDE.md'),
    fileAt(s, 'AGENTS.md'),
    ...filesUnder(s, '.claude/rules/'),
  ].filter(Boolean);

  if (!docs.length) {
    return mk('reg-drift', 7, 'The registry lists what is on disk', {
      state: 'fail', points: 0, max: 3, receipt: 'absent',
      note: `${units.length} units on disk and no CLAUDE.md, AGENTS.md, INSTALLED.md or rules file listing any of them`,
    });
  }
  const undocumented = units.filter((u) => !docs.some((d) => d.raw.includes(u)));
  const clean = undocumented.length === 0;
  const points = partial((units.length - undocumented.length) / units.length, 3, clean);
  const where = docs.map((d) => d.path).join(', ');
  return mk('reg-drift', 7, 'The registry lists what is on disk', {
    state: stateFor(points, 3, clean), points, max: 3, receipt: docs[0].path,
    note: clean
      ? `all ${units.length} unit(s) named across ${docs.length} doc(s)`
      : `${undocumented.length} of ${units.length} on disk are named nowhere in ${where}: ${undocumented.slice(0, 3).join(', ')}`,
  });
}

/** The table. A check is a row; adding one is appending a function. */
export const CHECKS = [
  permExplicit, permBashWildcard,
  gateToolsDeclared, gateWriteDeclared,
  evidenceConvention,
  vetRegistry, vetDeclinedLedger,
  parSharedWriter,
  memHandoff,
  regDrift,
];

/** Tally one group the same way the build grade does. */
function tally(checks) {
  const scored = checks.filter((c) => c.state !== 'n/a');
  const earned = scored.reduce((n, c) => n + c.points, 0);
  const possible = scored.reduce((n, c) => n + c.max, 0);
  const pct = possible ? Math.round((earned / possible) * 100) : null;
  return { earned, possible, pct, letter: letterFor(pct), measured: scored.length };
}

/** Worst letter wins. A harness is as mature as its weakest gate. */
const ORDER = ['A', 'B', 'C', 'D', 'F'];
export function weakest(letters) {
  const real = letters.filter(Boolean);
  if (!real.length) return null;
  return real.sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0];
}

/**
 * Run every check against a surface.
 *
 * `problems` from the surface read are surfaced alongside, because a file that
 * would not parse already cost points somewhere and the report has to say
 * which file it was.
 */
export function gradeHarness(surface) {
  const checks = CHECKS.map((fn) => fn(surface));

  const dimensions = DIMENSIONS.map((d) => {
    const mine = checks.filter((c) => c.dimension === d.id);
    return { ...d, checks: mine, ...tally(mine) };
  });

  const overall = tally(checks);
  const capped = weakest(dimensions.map((d) => d.letter));

  return {
    dimensions,
    checks,
    problems: surface.problems,
    counts: surface.counts,
    // Both numbers are reported. `pct` is the average a reader expects to see;
    // `letter` is capped by the worst dimension, so a build cannot average its
    // way past a failing gate. Showing only one of them would hide the rule.
    pct: overall.pct,
    averageLetter: overall.letter,
    letter: capped,
    earned: overall.earned,
    possible: overall.possible,
  };
}
