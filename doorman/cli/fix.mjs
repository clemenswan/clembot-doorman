/**
 * `doorman fix [check-id]`: close one open check, or say why only you can.
 *
 * Named `fix` after the field it reads. Every pattern card carries a `fix`
 * string, authored, and this command turns that sentence into either a patch or
 * a list of files. It is deliberately NOT called `adopt`: `doorman verdict`
 * already prints ADOPT for a third-party server, and a second meaning of the
 * word inside one tool is how `harness` ended up meaning three things.
 *
 * ── Output ───────────────────────────────────────────────────────────────────
 *
 * A patch at `.doorman/fix/<id>.patch` for the one check whose content is
 * derivable, a checklist at `.doorman/fix/<id>.md` for the nine that are not.
 * `.doorman/` because that is where the rest of this tool writes. It is NOT
 * necessarily ignored in the repo being fixed, and a checklist naming their
 * agent files must not land in their next commit, so `ignoreNote()` says so
 * whenever it is missing from `.gitignore`.
 *
 * The patch is a whole-file hunk rather than a minimal diff. That means no diff
 * algorithm to get wrong, and it means `git apply` REFUSES when the file has
 * changed since the patch was cut, which is the behaviour worth having.
 *
 * ── `--write` ────────────────────────────────────────────────────────────────
 *
 * Applies the patch, and only ever for the `generate` class. Every path decision
 * lives in `writable()` in src/profile/fix.mjs, as data, so the answer to "could
 * this overwrite my settings" is a list you can read rather than control flow
 * you have to trace.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readSurface } from '../src/profile/surface.mjs';
import { gradeHarness } from '../src/profile/rubric.mjs';
import { planFix, FIX_CLASS, writable } from '../src/profile/fix.mjs';
import { bundledCards, loadCards, ignoreNote, DEFAULT_API } from './profile.mjs';

/**
 * One hunk replacing the whole file. Valid unified diff, no diff algorithm.
 *
 * `git apply` matches every context line, so a file that moved since the patch
 * was cut is a refusal rather than a silent clobber.
 */
export function unifiedDiff(path, oldText, newText) {
  const newLines = newText.length ? newText.replace(/\n$/, '').split('\n') : [];
  const L = [`diff --git a/${path} b/${path}`];
  if (oldText === null) {
    L.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`);
    L.push(`@@ -0,0 +1,${newLines.length} @@`);
    for (const l of newLines) L.push(`+${l}`);
  } else {
    const oldLines = oldText.length ? oldText.replace(/\n$/, '').split('\n') : [];
    L.push(`--- a/${path}`, `+++ b/${path}`);
    L.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);
    for (const l of oldLines) L.push(`-${l}`);
    for (const l of newLines) L.push(`+${l}`);
  }
  return L.join('\n') + '\n';
}

/** The checklist a worklist fix produces. Markdown, because a human reads it. */
export function renderWorklistMd(plan) {
  const L = [];
  L.push(`# ${plan.id}`);
  L.push('');
  L.push(`${plan.check.title}. Currently **${plan.state}**, receipt \`${plan.check.receipt ?? 'absent'}\`.`);
  L.push('');
  L.push(`> ${plan.check.note}`);
  L.push('');
  if (plan.card?.fix) {
    L.push('## The fix, as the pattern card states it');
    L.push('');
    L.push(plan.card.fix);
    L.push('');
  }
  L.push('## Why doorman will not apply this');
  L.push('');
  L.push(plan.refusal);
  L.push('');
  L.push('## Files');
  L.push('');
  if (plan.targets.length) for (const t of plan.targets) L.push(`- \`${t}\``);
  else L.push('_none on disk yet_');
  L.push('');
  L.push('## Steps');
  L.push('');
  for (const s of plan.steps) L.push(s.startsWith('    ') ? `      ${s.trim()}` : `- ${s}`);
  L.push('');
  L.push('## Acceptance');
  L.push('');
  L.push(`Re-run \`doorman profile\` and confirm \`${plan.id}\` no longer reports **${plan.state}**.`);
  return L.join('\n') + '\n';
}

export async function fix({
  root = process.cwd(),
  id = null,
  write = false,
  online = false,
  api = DEFAULT_API,
  emit = true,
} = {}) {
  root = resolve(root);
  if (!existsSync(root)) return { ok: false, why: `no such path: ${root}` };

  const surface = readSurface(root);
  const grade = gradeHarness(surface);

  // No id: the menu. Every check, its class, and where it stands here.
  if (!id) {
    return {
      ok: true, root, listing: true,
      rows: grade.checks.map((c) => ({
        id: c.id, cls: FIX_CLASS[c.id] ?? 'worklist', state: c.state,
        title: c.title, receipt: c.receipt,
      })),
    };
  }

  const { cards } = online ? await loadCards({ api, online }) : { cards: bundledCards() };
  const plan = planFix(surface, grade, id, { cards });
  if (!plan.ok) return { ok: false, why: plan.why };
  if (plan.done) return { ok: true, root, plan, written: [], applied: null };

  const dir = join(root, '.doorman', 'fix');
  const written = [];
  let applied = null;
  let patch = null;

  if (plan.cls === 'generate') {
    const abs = join(root, plan.file.path);
    const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    patch = unifiedDiff(plan.file.path, existing, plan.file.content);

    if (write) {
      const w = writable(plan.file.path, existing);
      applied = w.ok
        ? { ok: true, path: plan.file.path, why: w.why }
        : { ok: false, path: plan.file.path, why: w.why };
      if (w.ok && emit) {
        mkdirSync(join(root, plan.file.path, '..'), { recursive: true });
        writeFileSync(abs, plan.file.content);
      }
    }
  } else if (write) {
    // Not an error and not a silent no-op. The refusal IS the output.
    applied = { ok: false, path: null, why: `${id} is a worklist fix: ${plan.refusal}` };
  }

  if (emit) {
    mkdirSync(dir, { recursive: true });
    if (patch) {
      const p = join(dir, `${id}.patch`);
      writeFileSync(p, patch);
      written.push(p);
    }
    if (plan.cls === 'worklist') {
      const p = join(dir, `${id}.md`);
      writeFileSync(p, renderWorklistMd(plan));
      written.push(p);
    }
  }

  return { ok: true, root, plan, patch, written, applied,
    ignoreNote: written.length ? ignoreNote(root) : null };
}

const pad = (s, n) => String(s).padEnd(n);

export function renderFix(res) {
  if (!res.ok) return `fix: ${res.why}`;
  const L = [''];

  if (res.listing) {
    L.push('  Ten checks. One of them has a fix doorman can derive; nine name a decision');
    L.push('  only you can make, and say so rather than guessing.');
    L.push('');
    for (const r of res.rows) {
      const mark = r.state === 'pass' ? ' ok ' : r.state === 'n/a' ? ' -- ' : r.state.toUpperCase().padStart(4);
      L.push(`  ${mark}  ${pad(r.id, 22)} ${pad(r.cls, 9)} ${r.title}`);
    }
    L.push('');
    L.push('  doorman fix <check-id>            write the patch or the checklist');
    L.push('  doorman fix reg-drift --write     apply (generate class only)');
    return L.join('\n');
  }

  const p = res.plan;
  if (p.done) {
    L.push(`  ${p.note}`);
    return L.join('\n');
  }

  L.push(`  ${p.id}  ${p.cls}  dimension ${p.check.dimension}  currently ${p.state}`);
  L.push('');
  L.push(`  ${p.check.note}`);
  L.push('');

  if (p.cls === 'generate') {
    L.push(`  Generated from the files on disk, so this content IS what the check looks for.`);
    L.push(`  It cannot be gamed: there is no version that passes and leaves the property false.`);
    L.push('');
    L.push(`  target  ${p.file.path}`);
  } else {
    L.push('  Doorman will not apply this:');
    L.push(`  ${p.refusal}`);
    L.push('');
    if (p.targets.length) {
      L.push(`  ${p.targets.length} file(s) to change:`);
      for (const t of p.targets.slice(0, 12)) L.push(`       ${t}`);
      if (p.targets.length > 12) L.push(`       ... and ${p.targets.length - 12} more, all in the checklist`);
      L.push('');
    }
    for (const s of p.steps) L.push(`  ${s.startsWith('    ') ? s : '- ' + s}`);
  }

  L.push('');
  if (res.applied) {
    L.push(res.applied.ok
      ? `  APPLIED  ${res.applied.path}  (${res.applied.why})`
      : `  REFUSED  ${res.applied.why}`);
    L.push('');
  }
  for (const f of res.written) L.push(`  wrote ${f}`);
  if (res.ignoreNote) L.push(`  WARNING: ${res.ignoreNote}`);
  L.push('');
  if (res.patch && !res.applied?.ok) {
    L.push(`  apply:   git apply .doorman/fix/${p.id}.patch`);
  }
  L.push(`  verify:  doorman profile    (${p.id} should stop reporting ${p.state})`);
  return L.join('\n');
}
