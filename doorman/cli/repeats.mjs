/**
 * `doorman repeats`: procedures this build keeps retyping.
 *
 * Offline, keyless, no network. Reads the same transcripts `needs` reads and
 * asks a different question of them: not what capability is missing, but what
 * PROCEDURE has been run by hand enough times to deserve a command.
 *
 * ── It cross-references what you already have ────────────────────────────────
 *
 * Every cluster is checked against the build's own agents, skills and
 * commands. A repeated procedure that already has a command is not a finding,
 * it is a command nobody is using, and saying so is more useful than counting
 * it as a gap. This is also the falsification test for the idea: if every
 * cluster is already covered, repetition is not evidence of missing
 * scaffolding and this file should be deleted.
 *
 * ── Excerpts are off by default ──────────────────────────────────────────────
 *
 * Same rule as `leaks` and `dashboard`. A cluster example is a verbatim prompt
 * and history holds client material.
 */

import { join, resolve, basename } from 'node:path';
import { readPrompts, historyDirFor } from '../src/needs.mjs';
import { findInventoryRoot } from '../src/inventory.mjs';
import { gatherUnits } from '../src/units.mjs';
import { clusterPrompts, coveredByUnit, summariseClusters, DEFAULT_THRESHOLD } from '../src/repeats.mjs';
import { vaultHistoryDirs } from './needs.mjs';

export function repeats({
  root = process.cwd(),
  vault = false,
  evidence = false,
  threshold = DEFAULT_THRESHOLD,
} = {}) {
  root = resolve(root);
  const dirs = vault
    ? vaultHistoryDirs(root)
    : (historyDirFor(root) ? [historyDirFor(root)] : []);

  if (!dirs.length) {
    return {
      ok: false,
      root,
      why: `no Claude Code transcript directory found for "${basename(root)}". ` +
        'repeats reads prompt history, so it has nothing to work from. ' +
        'Pass a path whose history exists, or --vault to read the whole workspace.',
    };
  }

  // dedupe:false on purpose. A collapsed duplicate is a deleted observation.
  const prompts = [];
  for (const d of dirs) prompts.push(...readPrompts(d, { limit: 1e6, dedupe: false }));

  const clusters = clusterPrompts(prompts, { threshold });
  const inventoryRoot = findInventoryRoot(root) ?? root;
  const units = gatherUnits(inventoryRoot);

  for (const c of clusters) c.covered = coveredByUnit(c, units);

  return {
    ok: true,
    root,
    inventoryRoot,
    vault,
    evidence,
    threshold,
    dirs,
    units: units.length,
    clusters,
    ...summariseClusters(clusters, { prompts: prompts.length }),
  };
}

export function renderRepeats(res) {
  if (!res.ok) return `repeats: ${res.why}`;

  const L = [];
  const uncovered = res.clusters.filter((c) => c.kind === 'cross-session' && !c.covered);
  const covered = res.clusters.filter((c) => c.kind === 'cross-session' && c.covered);
  const within = res.clusters.filter((c) => c.kind === 'within-session');

  L.push('');
  L.push(`  Repeated procedures: ${res.root}`);
  L.push(`  ${res.prompts} prompts, ${res.dirs.length} transcript director${res.dirs.length === 1 ? 'y' : 'ies'}` +
    `, ${res.units} existing units, overlap threshold ${res.threshold}`);
  L.push('');

  if (!res.clusters.length) {
    L.push('  NOTHING REPEATS. No procedure was run enough times to cluster.');
    L.push('');
    L.push('  A measurement, not a compliment. Three readings fit it:');
    L.push('    1. this build genuinely does different work every session;');
    L.push('    2. the threshold is too strict for this corpus;');
    L.push('    3. the procedures repeat but the words do not.');
    L.push('  Try --threshold 0.45 before believing the first one.');
    return L.join('\n');
  }

  L.push(`  ${res.crossSession} procedure(s) repeat ACROSS sessions, covering ${res.promptsInCross} prompts.`);
  L.push(`  ${res.withinSession} repeat WITHIN one session only, covering ${res.promptsInWithin}.`);
  L.push('  These are never added together: repetition inside one session is');
  L.push('  usually a retry loop, which is a debugging story rather than a');
  L.push('  missing command.');
  L.push('');

  if (uncovered.length) {
    L.push(`  NO UNIT COVERS THESE (${uncovered.length}). Scaffold candidates:`);
    L.push('');
    for (const c of uncovered) {
      L.push(`    ${String(c.size).padStart(3)}x  across ${c.sessions} sessions   ${c.core}`);
      if (res.evidence) for (const e of c.examples) L.push(`           "${e.replace(/\s+/g, ' ').slice(0, 110)}"`);
    }
    L.push('');
  }

  if (covered.length) {
    L.push(`  ALREADY COVERED (${covered.length}). A unit exists, and it is still being`);
    L.push('  done by hand, which is a discoverability problem not a gap:');
    L.push('');
    for (const c of covered) {
      L.push(`    ${String(c.size).padStart(3)}x  ${c.core}`);
      L.push(`           -> ${c.covered.kind} \`${c.covered.name}\` via ${c.covered.via} (${c.covered.matched.join(', ')})`);
    }
    L.push('');
  }

  if (within.length) {
    L.push(`  WITHIN ONE SESSION (${within.length}), reported separately and not counted above:`);
    for (const c of within) L.push(`    ${String(c.size).padStart(3)}x  ${c.core}`);
    L.push('');
  }

  if (!res.evidence) {
    L.push('  Examples withheld. They are verbatim prompts. Re-run with --evidence.');
  }
  L.push('  Nothing here was generated or installed. `repeats` measures only:');
  L.push('  a cluster is evidence a procedure was retyped, never proof that a');
  L.push('  command is the right answer to it.');

  return L.join('\n');
}
