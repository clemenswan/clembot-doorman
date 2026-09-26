/**
 * `doorman fix`, and mostly what it REFUSES to do.
 *
 * Two properties are worth more than the feature:
 *
 *  1. A fix may change the property, never only the text that proves it. Eight
 *     of the ten checks pass on a regex over a doc, so a generator willing to
 *     write prose could raise this repo's grade without touching the harness.
 *     The tests below pin the ratio (one generate, nine worklist) and assert
 *     that no worklist fixer carries a file to write. If somebody later adds a
 *     scaffold for `vet-declined-ledger`, these fail, which is the point.
 *
 *  2. It never writes a file that is the user's to own. `.claude/settings.json`,
 *     `registry/`, `.claude/agents/` and anything hand-written are refused by
 *     `writable()`, which is data rather than control flow so the refusal list
 *     can be read at a glance.
 *
 * ── Mutation record, because the first version of this file was vacuous ──────
 *
 * Seven mutants, all now caught. Three of them killed NOTHING on the first
 * attempt, and the reason is worth keeping: the write-refusal block used to
 * loop over NEVER_WRITE and NEVER_WRITE_PREFIX, so deleting
 * `.claude/settings.json` from the refusal list made the loop iterate one time
 * fewer and the suite stayed green. The test read its expectation out of the
 * code it was testing. Same shape as lesson-vacuous-self-referential-test, and
 * the fix is the MUST_REFUSE and MUST_STAY_WORKLIST literals below.
 *
 *   settings.json dropped from NEVER_WRITE        3 fail
 *   .claude/agents/ dropped from the prefixes     5 fail
 *   registry/ dropped from the prefixes           5 fail
 *   hand-written files made overwritable          2 fail
 *   pipe escaping removed from a table cell       1 fail
 *   a judgement check dropped from WORKLIST       3 fail
 *   a worklist fixer given a file to scaffold     2 fail
 *
 * One more thing learned while doing it: `grep -c FAIL` reports zero both for a
 * clean run and for a suite that crashed before its first assertion, so a
 * mutation harness has to count PASSES too. It read as three surviving mutants
 * that were in fact being caught.
 */

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './harness.mjs';
import { readSurface } from '../src/profile/surface.mjs';
import { gradeHarness } from '../src/profile/rubric.mjs';
import {
  planFix, FIX_CLASS, writable, regDriftContent,
  MARKER_TAG, NEVER_WRITE, NEVER_WRITE_PREFIX, PROPOSED_DENY,
} from '../src/profile/fix.mjs';
import { fix, unifiedDiff, renderWorklistMd } from '../cli/fix.mjs';
import { ignoreNote } from '../cli/profile.mjs';

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'harnesses');

// Same guard the rubric suite carries, for the same reason: readSurface fails
// closed, so an absent fixture grades identically to an empty harness and every
// negative assertion below would pass for the wrong reason.
for (const name of ['thin', 'strong']) {
  if (!existsSync(join(FIX_DIR, name, '.claude'))) {
    throw new Error(`fixture missing: ${join(FIX_DIR, name, '.claude')}`);
  }
}

const graded = (root) => {
  const surface = readSurface(root);
  return { surface, grade: gradeHarness(surface) };
};

/** A repo with 6 units and no doc naming any of them, so reg-drift fails. */
function driftingRepo() {
  const root = mkdtempSync(join(tmpdir(), 'doorman-fix-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# Repo\n\nNothing is listed here.\n');
  for (const a of ['reviewer', 'builder']) {
    writeFileSync(join(root, '.claude', 'agents', `${a}.md`),
      `---\nname: ${a}\ndescription: The ${a} agent.\ntools: Read, Grep\n---\n\nbody\n`);
  }
  for (const c of ['ship', 'status', 'audit', 'review']) {
    writeFileSync(join(root, '.claude', 'commands', `${c}.md`),
      `---\ndescription: The ${c} command.\n---\n\nbody\n`);
  }
  return root;
}

/* ── The ratio is the finding ──────────────────────────────────────────────── */

const generate = Object.entries(FIX_CLASS).filter(([, v]) => v === 'generate').map(([k]) => k);
const worklist = Object.entries(FIX_CLASS).filter(([, v]) => v === 'worklist').map(([k]) => k);

// Written out rather than derived, for the reason given above the MUST_REFUSE
// block. Every id below measures a human decision, so promoting any one of them
// to `generate` means claiming doorman can derive that decision from a repo that
// does not contain it. If that is ever true, this line is the place to argue it.
const MUST_STAY_WORKLIST = [
  'perm-explicit', 'perm-bash-wildcard',
  'gate-tools-declared', 'gate-write-declared',
  'evidence-convention',
  'vet-registry', 'vet-declined-ledger',
  'par-shared-writer',
  'mem-handoff',
];

check('exactly one check has a derivable fix, and it is reg-drift',
  generate.length === 1 && generate[0] === 'reg-drift',
  `generate = ${generate.join(', ')}`);

check('the nine judgement checks are all still worklists, none scaffolded',
  MUST_STAY_WORKLIST.every((id) => FIX_CLASS[id] === 'worklist'),
  `not worklist: ${MUST_STAY_WORKLIST.filter((id) => FIX_CLASS[id] !== 'worklist').join(', ')}`);

check('the two classes account for all ten checks and nothing else',
  generate.length + worklist.length === 10 && worklist.length === 9,
  `${generate.length} generate + ${worklist.length} worklist`);

check('every rubric check id has a fix class',
  (() => {
    const { grade } = graded(join(FIX_DIR, 'strong'));
    return grade.checks.every((c) => FIX_CLASS[c.id]);
  })());

// The anti-gaming assertion. A worklist fix that carried a file could satisfy a
// regex-backed check without changing the harness, which is the one behaviour
// this command exists to refuse.
check('no worklist fix carries a file to write',
  (() => {
    const { surface, grade } = graded(join(FIX_DIR, 'thin'));
    return worklist.every((id) => {
      const p = planFix(surface, grade, id);
      return !p.ok || p.done || p.file === null;
    });
  })());

check('every worklist fix states a refusal naming why doorman will not apply it',
  (() => {
    const { surface, grade } = graded(join(FIX_DIR, 'thin'));
    return worklist.every((id) => {
      const p = planFix(surface, grade, id);
      return !p.ok || p.done || (typeof p.refusal === 'string' && p.refusal.length > 40);
    });
  })());

/* ── Never widens capability ───────────────────────────────────────────────── */

check('the proposed permission entries are deny-shaped only, never an allow',
  PROPOSED_DENY.length > 0 && PROPOSED_DENY.every((d) => /^(Bash|Write|Read|WebFetch)\(/.test(d)));

check('perm-explicit proposes a deny list and still refuses to write settings',
  (() => {
    const { surface, grade } = graded(join(FIX_DIR, 'thin'));
    const p = planFix(surface, grade, 'perm-explicit');
    return p.ok && p.file === null && p.steps.some((s) => s.includes(PROPOSED_DENY[0]));
  })());

/* ── writable(): the refusal list ──────────────────────────────────────────── */

// LITERALS, deliberately. The first version of this block looped over
// NEVER_WRITE and NEVER_WRITE_PREFIX, which meant it read its own expected
// values out of the implementation: emptying either list made the loop test
// fewer paths and still pass. Two mutants that removed `.claude/settings.json`
// and `.claude/agents/` from the refusal lists killed nothing at all. Same
// shape as lesson-vacuous-self-referential-test. The paths below are written
// out so deleting one from the implementation is a red suite.
const MUST_REFUSE = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.mcp.json',
  'registry/allowlist.json',
  'registry/denylist.json',
  '.claude/agents/doorman.md',
  '.claude/agents/anything.md',
];

for (const p of MUST_REFUSE) {
  check(`writable refuses ${p} when absent`, writable(p, null).ok === false);
  check(`writable refuses ${p} even when doorman-marked`,
    writable(p, `<!-- ${MARKER_TAG} -->`).ok === false);
}

// And pin the lists themselves, so a shrunken list is red even if some other
// branch happened to refuse the path anyway.
check('NEVER_WRITE still names all three config files',
  ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json']
    .every((p) => NEVER_WRITE.includes(p)),
  `NEVER_WRITE = ${NEVER_WRITE.join(', ')}`);

check('NEVER_WRITE_PREFIX still covers the registry and the agents',
  ['registry/', '.claude/agents/'].every((p) => NEVER_WRITE_PREFIX.includes(p)),
  `NEVER_WRITE_PREFIX = ${NEVER_WRITE_PREFIX.join(', ')}`);

check('writable allows a file that does not exist yet',
  writable('.claude/rules/command-registry.md', null).ok === true);

check('writable refuses an existing file with no doorman marker',
  writable('.claude/rules/command-registry.md', '# hand written\n').ok === false);

check('writable allows regenerating a file doorman generated',
  writable('.claude/rules/command-registry.md', `<!-- ${MARKER_TAG} -->\nold\n`).ok === true);

/* ── The one generated fix actually closes its check ───────────────────────── */

{
  const root = driftingRepo();
  const before = graded(root);
  const beforeCheck = before.grade.checks.find((c) => c.id === 'reg-drift');
  check('fixture drifts before the fix', beforeCheck.state === 'fail',
    `state = ${beforeCheck.state}`);

  const content = regDriftContent(before.surface);

  // The property, not the text: every unit on disk has to appear by name. This
  // is what makes reg-drift the one fix that cannot be gamed.
  const units = ['reviewer', 'builder', 'ship', 'status', 'audit', 'review'];
  check('generated registry names every agent and command on disk',
    units.every((u) => content.includes(u)),
    `missing: ${units.filter((u) => !content.includes(u)).join(', ')}`);

  check('generated registry carries the doorman marker so it can be regenerated',
    content.includes(MARKER_TAG));

  check('generated registry escapes a pipe so the markdown table survives',
    (() => {
      const r = mkdtempSync(join(tmpdir(), 'doorman-pipe-'));
      mkdirSync(join(r, '.claude', 'commands'), { recursive: true });
      writeFileSync(join(r, '.claude', 'commands', 'piped.md'),
        '---\ndescription: Does a | b | c piping.\n---\nbody\n');
      const c = regDriftContent(readSurface(r));
      return c.includes('a \\| b \\| c');
    })());

  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'command-registry.md'), content);
  const after = graded(root).grade.checks.find((c) => c.id === 'reg-drift');
  check('applying the generated registry flips reg-drift to pass',
    after.state === 'pass' && after.points === after.max,
    `state = ${after.state}, ${after.points}/${after.max}`);
}

/* ── The patch is a real patch ─────────────────────────────────────────────── */

check('a new-file diff declares /dev/null and the right line count',
  (() => {
    const d = unifiedDiff('a/b.md', null, 'one\ntwo\n');
    return d.includes('--- /dev/null') && d.includes('@@ -0,0 +1,2 @@')
      && d.includes('+one') && d.includes('+two');
  })());

check('a replacement diff removes every old line and adds every new one',
  (() => {
    const d = unifiedDiff('x.md', 'old\n', 'new\n');
    return d.includes('@@ -1,1 +1,1 @@') && d.includes('-old') && d.includes('+new');
  })());

/* ── The CLI surface ──────────────────────────────────────────────────────── */

check('an unknown check id is refused and the message lists the real ones',
  (() => {
    const { surface, grade } = graded(join(FIX_DIR, 'thin'));
    const p = planFix(surface, grade, 'not-a-check');
    return p.ok === false && p.why.includes('reg-drift');
  })());

check('a passing check reports done rather than emitting a fix',
  (() => {
    const { surface, grade } = graded(join(FIX_DIR, 'strong'));
    const passing = grade.checks.find((c) => c.state === 'pass');
    if (!passing) return false;
    const p = planFix(surface, grade, passing.id);
    return p.done === true && !p.file;
  })());

check('no id lists every check with its class',
  await (async () => {
    const r = await fix({ root: join(FIX_DIR, 'thin'), emit: false });
    return r.ok && r.listing && r.rows.length === 10
      && r.rows.every((x) => x.cls === 'generate' || x.cls === 'worklist');
  })());

check('--write on a worklist check applies nothing and says so',
  await (async () => {
    const r = await fix({ root: join(FIX_DIR, 'thin'), id: 'vet-registry', write: true, emit: false });
    return r.ok && r.applied && r.applied.ok === false && r.applied.path === null;
  })());

check('--write refuses a hand-written file and leaves it byte-identical',
  await (async () => {
    const root = driftingRepo();
    const target = join(root, '.claude', 'rules', 'command-registry.md');
    mkdirSync(dirname(target), { recursive: true });
    const mine = '# my notes, naming nothing\n';
    writeFileSync(target, mine);
    const r = await fix({ root, id: 'reg-drift', write: true });
    return r.ok && r.applied.ok === false && readFileSync(target, 'utf8') === mine;
  })());

check('--write creates the registry when nothing is in the way',
  await (async () => {
    const root = driftingRepo();
    const r = await fix({ root, id: 'reg-drift', write: true });
    const target = join(root, '.claude', 'rules', 'command-registry.md');
    return r.ok && r.applied.ok === true && existsSync(target)
      && readFileSync(target, 'utf8').includes('reviewer');
  })());

check('a fix writes nothing outside .doorman/ unless --write was passed',
  await (async () => {
    const root = driftingRepo();
    const r = await fix({ root, id: 'reg-drift' });
    const target = join(root, '.claude', 'rules', 'command-registry.md');
    return r.ok && !existsSync(target) && r.written.every((w) => w.includes('.doorman'));
  })());

check('the worklist markdown carries files, steps and a re-runnable acceptance line',
  (() => {
    const { surface, grade } = graded(join(FIX_DIR, 'thin'));
    const p = planFix(surface, grade, 'gate-tools-declared');
    const md = renderWorklistMd(p);
    return md.includes('## Files') && md.includes('## Steps')
      && md.includes('doorman profile') && md.includes('## Why doorman will not apply this');
  })());

/* ── Writing into a repo that is not this one ──────────────────────────────── */

/**
 * `.doorman/` is gitignored in THIS repo, and both cli headers used to claim
 * that as though it were a property of the directory name. Measured against
 * `marketing-bootstrap` on 2026-09-24: `?? .doorman/` sat untracked and
 * unignored, holding a report naming that repo's own paths. A dot prefix hides
 * a directory from `ls`, not from `git add .`.
 */
{
  const repo = (gitignore) => {
    const root = mkdtempSync(join(tmpdir(), 'doorman-ign-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    if (gitignore !== null) writeFileSync(join(root, '.gitignore'), gitignore);
    return root;
  };

  check('warns when .doorman/ is not ignored',
    (ignoreNote(repo('node_modules/\ndist/\n')) ?? '').includes('.gitignore'));

  check('warns when the repo has no .gitignore at all',
    ignoreNote(repo(null)) !== null);

  check('silent when .doorman/ is ignored',
    ignoreNote(repo('node_modules/\n.doorman/\n')) === null);

  // The forms git treats the same. A warning that fires on a repo already
  // protected is noise, and noise is what gets a real warning ignored.
  for (const form of ['.doorman', '.doorman/', '/.doorman', '/.doorman/', '  .doorman/  ']) {
    check(`silent for the ignore form ${JSON.stringify(form)}`,
      ignoreNote(repo(`x\n${form}\ny\n`)) === null);
  }

  check('a commented-out ignore does NOT count as ignored',
    ignoreNote(repo('# .doorman/\n')) !== null);

  check('a directory that is not a git repo is left alone',
    ignoreNote(mkdtempSync(join(tmpdir(), 'doorman-norepo-'))) === null);
}

/* ── The grader must not accept the tool's own output as testimony ─────────── */

/**
 * Measured on a fresh build, 2026-09-24, and it was a defect in `fix` itself.
 *
 * Applying the reg-drift patch moved the overall grade 2/38 -> 9/38, which is
 * +7 for a check worth 3. The extra 4 were `gate-write-declared` flipping 0/4
 * to 4/4, because that check counts "documented dispatch" as ANY file under
 * `.claude/rules/` naming the agent, and the generated registry names every
 * one of them.
 *
 * The distinction that resolves it: `reg-drift` measures ENUMERATION, so a
 * generated enumeration is a real fix. `gate-write-declared` measures REVIEW,
 * and a document the tool wrote to itself is not review. Invariant 38 pointed
 * at the grader rather than at the fixer.
 */
{
  // driftingRepo's agents are Read/Grep only, so gate-write-declared is n/a
  // there and every assertion below would compare null to null and pass
  // vacuously. These agents can WRITE, which is what the check is about.
  const root = driftingRepo();
  for (const a of ['reviewer', 'builder']) {
    writeFileSync(join(root, '.claude', 'agents', `${a}.md`),
      `---
name: ${a}
description: The ${a} agent.
tools: Read, Write, Edit
---

body
`);
  }
  const before = graded(root).grade.checks.find((c) => c.id === 'gate-write-declared');
  check('the fixture actually exercises the check rather than scoring n/a',
    before.points !== null && before.state !== 'n/a',
    `gate-write-declared = ${before.state}, points ${before.points}`);

  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'command-registry.md'),
    regDriftContent(readSurface(root)));

  const after = graded(root);
  const gate = after.grade.checks.find((c) => c.id === 'gate-write-declared');
  const drift = after.grade.checks.find((c) => c.id === 'reg-drift');

  check('the generated registry DOES close reg-drift, which measures enumeration',
    drift.state === 'pass', `reg-drift = ${drift.state}`);

  check('the generated registry does NOT close gate-write-declared, which measures review',
    gate.points === before.points,
    `gate-write-declared moved ${before.points} -> ${gate.points}; a generated doc counted as a human gate`);

  // And the exclusion must be about the MARKER, not about the filename: a
  // hand-written file at the same path is legitimate evidence of review.
  writeFileSync(join(root, '.claude', 'rules', 'command-registry.md'),
    '# Dispatch\n\nreviewer, builder, ship, status, audit, review are dispatched by hand.\n');
  const handWritten = graded(root).grade.checks.find((c) => c.id === 'gate-write-declared');
  check('a HAND-WRITTEN doc at the same path still counts as a gate',
    handWritten.points > before.points,
    `hand-written doc scored ${handWritten.points}, expected more than ${before.points}`);
}
