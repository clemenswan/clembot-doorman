/**
 * The report, the exportable profile, and the renderer for both.
 *
 * Three artifacts, one source:
 *
 *   report.json   everything measured. LOCAL ONLY, never leaves the machine.
 *   report.md     the same thing for a human, same renderer family as L1.
 *   profile.json  structure only, written by --export, gated by redaction.
 *
 * The split is the whole privacy story. `report.json` may carry receipts that
 * name files; `profile.json` carries counts, booleans, scores and receipts that
 * have been through the scanner, and nothing else. Notes are dropped from the
 * export entirely rather than filtered, because a note is prose assembled from
 * the repo's own contents and the cheapest way to never leak prose is to never
 * put prose in the file.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { sanitise } from './redaction.mjs';

export const REPORT_VERSION = 1;

/**
 * A stable, non-identifying name for a repo.
 *
 * Hashed by default: an exported profile that names the prospect is a document
 * about the prospect, and the demo hands it to them rather than keeping it.
 * `--name` overrides when somebody wants a readable label.
 */
export function repoSlug(root, { name = null } = {}) {
  if (name) return String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return 'repo-' + createHash('sha256').update(basename(String(root))).digest('hex').slice(0, 8);
}

export function buildReport(surface, grade, { root, name = null, now = () => new Date() } = {}) {
  const at = now();
  return {
    version: REPORT_VERSION,
    slug: repoSlug(root, { name }),
    generated_at: at.toISOString(),
    // Local only. Stripped from the export by `buildProfile`.
    root: String(root),
    letter: grade.letter,
    average_letter: grade.averageLetter,
    pct: grade.pct,
    earned: grade.earned,
    possible: grade.possible,
    counts: grade.counts,
    problems: grade.problems,
    dimensions: grade.dimensions.map((d) => ({
      id: d.id,
      key: d.key,
      title: d.title,
      letter: d.letter,
      pct: d.pct,
      earned: d.earned,
      possible: d.possible,
      measured: d.measured,
      checks: d.checks.map((c) => ({
        id: c.id, title: c.title, state: c.state,
        points: c.points, max: c.max, receipt: c.receipt, note: c.note,
      })),
    })),
  };
}

/**
 * The structure-only profile, then the scanner over it.
 *
 * What is deliberately absent: `root`, every `note`, and anything derived from
 * file CONTENTS. What survives: counts, states, scores, and receipts, which are
 * repo-relative paths and are what makes a gap checkable by the person who owns
 * the repo.
 */
export function buildProfile(report) {
  const bare = {
    version: REPORT_VERSION,
    kind: 'harness-profile',
    slug: report.slug,
    generated_at: report.generated_at,
    letter: report.letter,
    average_letter: report.average_letter,
    pct: report.pct,
    counts: report.counts,
    problem_count: report.problems.length,
    dimensions: report.dimensions.map((d) => ({
      id: d.id, key: d.key, letter: d.letter, pct: d.pct,
      earned: d.earned, possible: d.possible, measured: d.measured,
      checks: d.checks.map((c) => ({
        id: c.id, state: c.state, points: c.points, max: c.max, receipt: c.receipt,
      })),
    })),
  };
  return sanitise(bare);
}

const MARK = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', 'n/a': ' -- ' };

export function renderReportMd(report) {
  const L = [];
  L.push(`# Harness profile: ${report.slug}`);
  L.push('');
  L.push(`**${report.letter}** overall. ${report.earned} of ${report.possible} points (${report.pct}%), ` +
    `average band ${report.average_letter}.`);
  L.push('');
  L.push('The overall letter is the WORST dimension, not the average. A harness is as');
  L.push('mature as its weakest gate, so a strong build with one failing dimension');
  L.push('reads as that dimension. Both numbers are above so neither can hide.');
  L.push('');
  L.push(`Read on ${report.generated_at}. ` +
    `${report.counts.agents} agent(s), ${report.counts.commands} command(s), ` +
    `${report.counts.skills} skill(s), ${report.counts.rules} rule file(s), ` +
    `${report.counts.hooks} hook(s).`);
  L.push('');

  L.push('| Dimension | Band | Score |');
  L.push('|---|---|---|');
  for (const d of report.dimensions) {
    L.push(`| ${d.title} | ${d.letter ?? 'n/a'} | ${d.measured ? `${d.earned}/${d.possible}` : 'not measured'} |`);
  }
  L.push('');

  for (const d of report.dimensions) {
    L.push(`## ${d.id}. ${d.title}`);
    L.push('');
    for (const c of d.checks) {
      const score = c.state === 'n/a' ? 'skipped' : `${c.points}/${c.max}`;
      L.push(`- **${MARK[c.state]}** \`${c.id}\` ${c.title} (${score})`);
      L.push(`  - receipt: \`${c.receipt ?? 'absent'}\``);
      if (c.note) L.push(`  - ${c.note}`);
    }
    L.push('');
  }

  if (report.problems.length) {
    L.push('## Files that would not parse');
    L.push('');
    L.push('Each one counted AGAINST the dimension it belongs to. A file that will not');
    L.push('parse cannot be shown to be safe, and reading it as safe is how a malformed');
    L.push('settings file comes out looking like a clean one.');
    L.push('');
    for (const p of report.problems) L.push(`- \`${p.path}\`: ${p.problem}`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('Read from the harness surface only: settings, agents, commands, skills, rules,');
  L.push('hook names, CLAUDE.md and .mcp.json. No source code, no environment files, no');
  L.push('secrets, nothing outside the repo. This report stays on this machine unless');
  L.push('`--export` is run, and an export carries structure only.');
  return L.join('\n');
}
