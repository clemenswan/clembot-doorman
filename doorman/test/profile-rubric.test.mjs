/**
 * The ten checks, against two real `.claude/` trees.
 *
 * The fixtures are the oracle: `thin` is a harness two days old and `strong`
 * is a worked one. Neither is sabotaged. A fixture built to fail a specific
 * regex tests the regex; a fixture built to look like a real repo tests the
 * check, and only the second kind catches a check that is measuring the wrong
 * thing.
 *
 * `strong` is deliberately NOT this vault. If the only passing fixture were
 * our own conventions, every check would encode "looks like ClemVault" and
 * pass nothing else.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, describe } from './harness.mjs';
import { readSurface, lineOf, receipt } from '../src/profile/surface.mjs';
import { gradeHarness, DIMENSIONS, CHECKS, weakest, DRIFT_FLOOR } from '../src/profile/rubric.mjs';

// Resolve from THIS FILE, never from process.cwd().
//
// This was `join(process.cwd(), '..', 'fixtures', 'harnesses')`, which is
// correct only when the suite is run from `doorman/` and wrong under the
// `npm test` at the repo root that every other human will use. The damage was
// not the twenty red lines it produced. `readSurface` fails closed, so a
// fixture root that does not exist grades as an empty harness: every `strong`
// assertion failed, and every `thin` assertion PASSED for the wrong reason,
// because "scores zero" and "bands F" are exactly what an absent repo scores.
// Half this file was vacuous and still green. Hence the existence assert below.
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'harnesses');
const grade = (name) => gradeHarness(readSurface(join(FIX, name)));

// FAIL LOUDLY ON A MISSING FIXTURE, before a single check runs.
//
// Every assertion below reads a graded fixture, and a fail-closed grader
// answers "absent" and "present but empty" identically. Without this, a broken
// path does not break the suite: it silently converts the negative half into a
// tautology. Assert the oracle exists before trusting anything it says.
for (const name of ['thin', 'strong']) {
  if (!existsSync(join(FIX, name, '.claude'))) {
    throw new Error(
      `fixture missing: ${join(FIX, name, '.claude')}\n`
      + 'The rubric fixtures are the oracle for this suite. Refusing to run '
      + 'rather than report a pass earned by an empty directory.',
    );
  }
}

const thin = grade('thin');
const strong = grade('strong');
const byId = (g, id) => g.checks.find((c) => c.id === id);

describe('profile rubric: the table');

check('seven dimensions', DIMENSIONS.length === 7);
check('ten checks', CHECKS.length === 10);
check('every check lands in a declared dimension',
  thin.checks.every((c) => DIMENSIONS.some((d) => d.id === c.dimension)));
check('check ids are unique', new Set(thin.checks.map((c) => c.id)).size === 10);
check('every check carries a receipt or says absent',
  thin.checks.every((c) => c.state === 'n/a' || typeof c.receipt === 'string'),
  'a finding nobody can look up is an assertion');
check('every scored check has points within its max',
  strong.checks.filter((c) => c.state !== 'n/a').every((c) => c.points >= 0 && c.points <= c.max));

describe('profile rubric: the fixtures separate');

check('thin scores zero of everything measurable', thin.earned === 0);
check('strong scores full marks', strong.earned === strong.possible && strong.possible > 0);
check('thin bands F', thin.letter === 'F');
check('strong bands A', strong.letter === 'A');
check('no check passes on thin', !thin.checks.some((c) => c.state === 'pass'));
check('no check fails on strong', !strong.checks.some((c) => c.state === 'fail'));

describe('profile rubric: per check');

check('perm-explicit fails with no settings file', byId(thin, 'perm-explicit').state === 'fail');
check('perm-explicit passes with both lists', byId(strong, 'perm-explicit').state === 'pass');
check('perm-bash-wildcard is n/a when there is no settings file to read',
  byId(thin, 'perm-bash-wildcard').state === 'n/a',
  'nothing to inspect is not the same as nothing found');
check('perm-bash-wildcard passes on scoped Bash entries',
  byId(strong, 'perm-bash-wildcard').state === 'pass');

check('gate-tools-declared fails on an agent with no tools field',
  byId(thin, 'gate-tools-declared').state === 'fail');
check('gate-tools-declared passes when all declare',
  byId(strong, 'gate-tools-declared').state === 'pass');
check('gate-write-declared fails when tools are undeclared', (() => {
  // An undeclared tool set resolves to write-capable, so the agent counts as
  // an ungated writer rather than being skipped. Fail closed.
  const c = byId(thin, 'gate-write-declared');
  return c.state === 'fail' && c.points === 0;
})(), 'unknown resolves to the unsafe reading, not the convenient one');

check('evidence-convention fails with no checkpoint command',
  byId(thin, 'evidence-convention').state === 'fail');
check('evidence-convention passes with a command AND a reference',
  byId(strong, 'evidence-convention').state === 'pass');

check('vet-registry fails when a server is declared and nothing registers it',
  byId(thin, 'vet-registry').state === 'fail');
check('vet-registry passes when every server is in a rules file',
  byId(strong, 'vet-registry').state === 'pass');

// The regression that scored our own gated vault 0/4 on tool vetting.
//
// A harness that installs the gate records its servers in doorman's registry,
// not in prose under .claude/rules/. The check searched only the prose
// surfaces, so the more thoroughly a repo adopted doorman, the worse it
// scored, and the "fix" would have been to hand-copy an existing registry into
// a rules file. A registry is a registry whatever format it is in.
check('vet-registry accepts doorman\'s OWN registry as a registry', (() => {
  const dir = tmpRepo({
    '.mcp.json': JSON.stringify({ mcpServers: { scorecard: { url: 'https://example.test/mcp' } } }),
    'registry/allowlist.json': JSON.stringify({ version: 1, servers: { scorecard: { grade: 'A' } } }),
  });
  try {
    const c = byId(gradeHarness(readSurface(dir)), 'vet-registry');
    // The receipt must name the registry that actually holds the server, not
    // merely the first file the check happened to search.
    return c.state === 'pass' && c.points === c.max
      && c.receipt === 'registry/allowlist.json';
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'a gated harness must not be penalised for using the gate\'s own registry');

check('the vet-registry receipt points at a file that names the server', (() => {
  const dir = tmpRepo({
    '.mcp.json': JSON.stringify({ mcpServers: { scorecard: {} } }),
    // Sorts first and is NOT the evidence. The old code cited this file.
    '.claude/rules/aaa-unrelated.md': 'nothing about any server here',
    '.claude/rules/zzz-registry.md': '| scorecard | Approved |',
  });
  try {
    const c = byId(gradeHarness(readSurface(dir)), 'vet-registry');
    return c.state === 'pass' && /zzz-registry/.test(c.receipt);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'a receipt is a thing a human looks up; the wrong file spends trust before it fails');

check('vet-registry still fails when NO registry of any kind names the server', (() => {
  const dir = tmpRepo({
    '.mcp.json': JSON.stringify({ mcpServers: { scorecard: {} } }),
    'registry/allowlist.json': JSON.stringify({ version: 1, servers: { somethingelse: {} } }),
  });
  try {
    const c = byId(gradeHarness(readSurface(dir)), 'vet-registry');
    return c.state === 'fail' && c.points === 0;
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'widening the search must not make the check unfailable');
check('vet-declined-ledger fails with no declined record',
  byId(thin, 'vet-declined-ledger').state === 'fail');
check('vet-declined-ledger passes with one', byId(strong, 'vet-declined-ledger').state === 'pass');

check('par-shared-writer is n/a below two writers',
  byId(thin, 'par-shared-writer').state === 'n/a',
  'two of them cannot collide when there is one');
check('par-shared-writer passes when all writers are isolated',
  byId(strong, 'par-shared-writer').state === 'pass');

check('mem-handoff fails with no state convention', byId(thin, 'mem-handoff').state === 'fail');
check('mem-handoff passes when named and implemented', byId(strong, 'mem-handoff').state === 'pass');

check(`reg-drift is n/a below ${DRIFT_FLOOR} units`, byId(thin, 'reg-drift').state === 'n/a');
check('reg-drift passes when the registry is split across files',
  byId(strong, 'reg-drift').state === 'pass',
  'agents listed in CLAUDE.md while INSTALLED.md covers skills is filing, not drift');

describe('profile rubric: the weakest gate caps the letter');

check('weakest picks the worst letter', weakest(['A', 'A', 'F', 'B']) === 'F');
check('weakest ignores nulls', weakest(['A', null, 'B']) === 'B');
check('weakest of nothing is null', weakest([null, null]) === null);
check('an all-n/a set has no letter', weakest([]) === null);

check('one failing dimension caps an otherwise strong build', (() => {
  // The rule that makes the letter mean something. Verified by construction
  // rather than by finding a fixture that happens to show it.
  const g = { dimensions: [{ letter: 'A' }, { letter: 'A' }, { letter: 'F' }] };
  return weakest(g.dimensions.map((d) => d.letter)) === 'F';
})());

check('the average is still reported alongside', (() => {
  return typeof strong.pct === 'number' && strong.averageLetter === 'A';
})(), 'showing only the capped letter would hide the rule');

describe('profile rubric: fail closed');

function tmpRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'doorman-profile-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

check('unparseable settings.json counts AGAINST permission hygiene', (() => {
  const dir = tmpRepo({ '.claude/settings.json': '{ this is not json' });
  try {
    const g = gradeHarness(readSurface(dir));
    const c = byId(g, 'perm-explicit');
    return c.state === 'fail' && c.points === 0 && /did not parse/.test(c.note);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'a malformed file must not read as "no dangerous permissions found"');

check('the unparseable file is named in problems', (() => {
  const dir = tmpRepo({ '.mcp.json': 'nope' });
  try {
    const g = gradeHarness(readSurface(dir));
    return g.problems.some((p) => p.path === '.mcp.json' && p.problem === 'unparseable-json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('unparseable .mcp.json fails tool vetting rather than skipping it', (() => {
  const dir = tmpRepo({ '.mcp.json': '{{{' });
  try {
    const c = byId(gradeHarness(readSurface(dir)), 'vet-registry');
    return c.state === 'fail';
  } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('an empty repo grades without throwing', (() => {
  const dir = tmpRepo({ 'README.md': 'nothing here' });
  try {
    const g = gradeHarness(readSurface(dir));
    return Array.isArray(g.checks) && g.checks.length === 10;
  } finally { rmSync(dir, { recursive: true, force: true }); }
})());

describe('profile surface: what it refuses to read');

check('a .env inside the surface is never opened', (() => {
  const dir = tmpRepo({ '.claude/rules/.env': 'SECRET=1', '.claude/rules/ok.md': 'fine' });
  try {
    const s = readSurface(dir);
    return !s.files.has('.claude/rules/.env') && s.files.has('.claude/rules/ok.md');
  } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('source code outside the surface is not read', (() => {
  const dir = tmpRepo({ 'src/index.js': 'const secret = 1', 'CLAUDE.md': 'hi' });
  try {
    const s = readSurface(dir);
    return [...s.files.keys()].every((p) => !p.startsWith('src/'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('a symlink escaping the repo is refused, not followed', (() => {
  const outside = mkdtempSync(join(tmpdir(), 'doorman-outside-'));
  writeFileSync(join(outside, 'secrets.md'), 'TOP SECRET');
  const dir = tmpRepo({ 'CLAUDE.md': 'hi' });
  try {
    mkdirSync(join(dir, '.claude', 'rules'), { recursive: true });
    try { symlinkSync(join(outside, 'secrets.md'), join(dir, '.claude', 'rules', 'link.md')); }
    catch { return true; } // no symlink permission on this machine; not a failure
    const s = readSurface(dir);
    const f = s.files.get('.claude/rules/link.md');
    return f && f.problem === 'symlink-escapes-repo' && !String(f.raw ?? '').includes('TOP SECRET');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
})(), 'a symlink is how an allowed path names a file the surface never declared');

describe('profile surface: receipts');

check('lineOf is one-based', lineOf({ lines: ['a', 'b', 'c'] }, /^b$/) === 2,
  'every editor counts from one');
check('lineOf returns null when absent', lineOf({ lines: ['a'] }, /zzz/) === null);
check('receipt of a missing file is absent', receipt(null, /x/) === 'absent');
check('receipt falls back to the path when no line matches',
  receipt({ path: 'a.md', lines: ['x'] }, /zzz/) === 'a.md');
check('a real receipt points at a line', (() => {
  const c = byId(strong, 'perm-explicit');
  return /^\.claude\/settings\.json:\d+$/.test(c.receipt);
})());

describe('profile rubric: a gate is not one mechanism');

// The correction that mattered most in the first real run. The check used to
// demand `isolation:` and scored a vault where all 21 write-capable agents are
// documented in a dispatch table as though none were gated. Worse, acting on
// that finding would have meant stamping `isolation: worktree` onto nineteen
// agents that write in place, stranding every output. A check whose fix breaks
// the build is measuring the wrong thing.
function agentRepo(frontmatter, docs = {}) {
  return tmpRepo({
    '.claude/agents/writer.md': `---\n${frontmatter}\n---\n\nbody\n`,
    ...docs,
  });
}

const gateOf = (dir) => byId(gradeHarness(readSurface(dir)), 'gate-write-declared');

check('isolation is a gate', (() => {
  const dir = agentRepo('description: w\ntools: Read, Write\nisolation: worktree');
  try { return gateOf(dir).state === 'pass'; } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('allowed-paths is a gate', (() => {
  const dir = agentRepo('description: w\ntools: Read, Write\nallowed-paths: ./drafts/');
  try { return gateOf(dir).state === 'pass'; } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('being named in a dispatch doc is a gate', (() => {
  const dir = agentRepo('description: w\ntools: Read, Write', {
    '.claude/rules/agent-dispatch.md': '| `writer` | drafts copy | human-triggered |\n',
  });
  try { return gateOf(dir).state === 'pass'; } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'a documented dispatch says who runs it and when, which is a gate');

check('none of the three is a failure', (() => {
  const dir = agentRepo('description: w\ntools: Read, Write', {
    'CLAUDE.md': 'A project with no mention of that agent at all.',
  });
  try {
    const c = gateOf(dir);
    return c.state === 'fail' && /no dispatch doc/.test(c.note);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'the check must still fail something, or it is decoration');

check('the note says WHICH gate was found', (() => {
  const dir = agentRepo('description: w\ntools: Read, Write\nisolation: worktree');
  try { return /isolation/.test(gateOf(dir).note); } finally { rmSync(dir, { recursive: true, force: true }); }
})());

describe('profile rubric: concurrency asks a different question');

// Dimension 2 accepts documentation. Dimension 5 must not: a dispatch table
// says who STARTS an agent and nothing about what happens when two run at once.
check('a documented dispatch does NOT satisfy concurrency safety', (() => {
  const dir = tmpRepo({
    '.claude/agents/a.md': '---\ndescription: a\ntools: Read, Write\n---\n',
    '.claude/agents/b.md': '---\ndescription: b\ntools: Read, Write\n---\n',
    '.claude/rules/agent-dispatch.md': 'both `a` and `b` are human-triggered\n',
  });
  try {
    const g = gradeHarness(readSurface(dir));
    return byId(g, 'gate-write-declared').state === 'pass'
      && byId(g, 'par-shared-writer').state === 'fail';
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'the two dimensions must be able to disagree, or one of them is redundant');

check('an agent declaring NO tools counts as a concurrent writer', (() => {
  // Fail closed, consistently. It inherits whatever the parent holds, so it
  // may write anywhere, which is exactly the collision risk.
  const dir = tmpRepo({
    '.claude/agents/a.md': '---\ndescription: a\ntools: Read, Write\n---\n',
    '.claude/agents/b.md': '---\ndescription: b\n---\n',
  });
  try {
    const c = byId(gradeHarness(readSurface(dir)), 'par-shared-writer');
    return c.state === 'fail' && /2 of 2/.test(c.note);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})());

check('the note admits allowed-paths is a declaration, not an enforcement', (() => {
  const dir = tmpRepo({
    '.claude/agents/a.md': '---\ndescription: a\ntools: Read, Write\n---\n',
    '.claude/agents/b.md': '---\ndescription: b\ntools: Read, Write\n---\n',
  });
  try {
    return /enforced by review, not by the harness/.test(
      byId(gradeHarness(readSurface(dir)), 'par-shared-writer').note);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})(), 'nothing in this vault enforces allowed-paths, and the report should not imply otherwise');
