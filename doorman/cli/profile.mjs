/**
 * `doorman profile`: grade a Claude Code harness the way the scorecard grades
 * an MCP server.
 *
 * Named `profile` rather than `harness` because `harness` already means two
 * other things here: `cli/harness.mjs` is the agent loop that runs inside the
 * eval sandbox, and `doctor` reports `harnesses` for the tooling it detects.
 * A third meaning on a public command would be the most confusing one.
 *
 * ── Offline, local, and it stays that way ────────────────────────────────────
 *
 * Reads the harness surface, grades it, writes two files under `.doorman/`.
 * No network unless `--online` is passed, which fetches the authority feed and
 * falls back to the bundled snapshot when it cannot. The flag is `--online`,
 * not `--patterns`: this comment said the latter for a while and cost a session
 * a wrong instruction. Nothing is uploaded on any path.
 *
 * `--export` is the ONLY way anything becomes portable, and what it writes is
 * structure with the redaction scanner over it.
 *
 * ── Why `.doorman/` and not `outputs/` ───────────────────────────────────────
 *
 * `.doorman/` is where `dashboard` already writes, and it is gitignored HERE.
 * `outputs/` is not ignored anywhere, so a report naming a prospect's file
 * paths would land in their next commit, and the first thing this tool does
 * would be to leak into their history.
 *
 * That paragraph used to end at "is already gitignored", which was true of this
 * repo and false of every other one. Measured 2026-09-24: a profile run against
 * `marketing-bootstrap` left `?? .doorman/` in its `git status`, untracked and
 * unignored, holding a report full of that repo's paths. The dot prefix hides a
 * directory from `ls`, not from `git add .`. So `ignoreNote()` checks and says
 * so, and the check is HERE rather than in `surface.mjs` because `.gitignore` is
 * not part of the graded surface and must not become part of it.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSurface } from '../src/profile/surface.mjs';
import { gradeHarness } from '../src/profile/rubric.mjs';
import { buildReport, buildProfile, renderReportMd } from '../src/profile/report.mjs';
import { renderSow } from '../src/profile/sow.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');

export const DEFAULT_API = 'https://scorecard.wanessalabs.com';

/** The bundled snapshot. The demo must survive a room with no egress. */
export function bundledCards({ dir = join(PKG, 'authority', 'patterns') } = {}) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch { return []; }
}

/** A bundled reference profile, by name. */
export function referenceProfile(name, { dir = join(PKG, 'doorman', 'profiles') } = {}) {
  const p = join(dir, `${String(name).replace(/[^a-z0-9-]/gi, '')}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Pattern cards, from the authority when asked and reachable, else bundled.
 *
 * Failure is not an error here. An enterprise demo runs in a room where egress
 * may be blocked, and a dashboard that renders nothing because a fetch failed
 * is a worse outcome than one that renders a snapshot and says so.
 */
export async function loadCards({ api = DEFAULT_API, online = false, fetchImpl = globalThis.fetch } = {}) {
  if (!online) return { cards: bundledCards(), source: 'bundled', note: null };
  try {
    const r = await fetchImpl(`${api.replace(/\/+$/, '')}/patterns`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    const cards = body.patterns ?? body.cards ?? [];
    if (!Array.isArray(cards) || !cards.length) throw new Error('no patterns in response');
    return { cards, source: 'authority', note: null };
  } catch (e) {
    return {
      cards: bundledCards(),
      source: 'bundled',
      note: `authority unreachable (${e.message}), using the bundled snapshot`,
    };
  }
}

/**
 * Warn when `.doorman/` is not ignored, because the report names their paths.
 *
 * Deliberately crude: a literal scan for a `.doorman` line rather than a
 * gitignore-semantics implementation. A false "you are fine" is the only
 * dangerous answer here, and matching less than git does can only produce a
 * warning nobody needed. Returns null when it has nothing to say.
 */
export function ignoreNote(root, { readFile = readFileSync } = {}) {
  const gi = join(root, '.gitignore');
  if (!existsSync(join(root, '.git')) && !existsSync(gi)) return null; // not a repo
  let raw = '';
  try { raw = readFile(gi, 'utf8'); } catch { raw = ''; }
  const ignored = raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .some((l) => l.replace(/^\/+/, '').replace(/\/+$/, '') === '.doorman');
  if (ignored) return null;
  return 'this report names YOUR file paths and `.doorman/` is not in .gitignore. '
    + 'Add `.doorman/` to it before your next commit.';
}

export function outDir(root, report, { base = null } = {}) {
  const day = report.generated_at.slice(0, 10);
  return join(base ?? join(root, '.doorman'), 'profile', report.slug, day);
}

export async function profile({
  root = process.cwd(),
  name = null,
  exportProfile = false,
  sow = false,
  reference = null,
  online = false,
  api = DEFAULT_API,
  selected = null,
  write = true,
  now = () => new Date(),
} = {}) {
  root = resolve(root);
  if (!existsSync(root)) return { ok: false, why: `no such path: ${root}` };

  const surface = readSurface(root);
  const grade = gradeHarness(surface);
  const report = buildReport(surface, grade, { root, name, now });

  const ref = reference ? referenceProfile(reference) : null;
  if (reference && !ref) {
    return { ok: false, why: `no bundled reference profile named "${reference}"` };
  }

  const exported = exportProfile || sow ? buildProfile(report) : null;
  const { cards, source, note } = sow ? await loadCards({ api, online }) : { cards: [], source: null, note: null };

  const dir = outDir(root, report);
  const written = [];
  if (write) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    written.push(join(dir, 'report.json'));
    writeFileSync(join(dir, 'report.md'), renderReportMd(report) + '\n');
    written.push(join(dir, 'report.md'));
    if (exportProfile) {
      writeFileSync(join(dir, 'profile.json'), JSON.stringify(exported, null, 2) + '\n');
      written.push(join(dir, 'profile.json'));
    }
    if (sow) {
      const md = renderSow(report, cards, { reference: ref, selected, profile: exported });
      writeFileSync(join(dir, 'sow.md'), md + '\n');
      written.push(join(dir, 'sow.md'));
    }
  }

  return { ok: true, root, dir, report, profile: exported, reference: ref, cards, cardSource: source, cardNote: note, written,
    ignoreNote: write ? ignoreNote(root) : null };
}

export function renderProfile(res) {
  if (!res.ok) return `profile: ${res.why}`;
  const r = res.report;
  const L = [];
  L.push('');
  L.push(`  Harness profile: ${r.slug}`);
  L.push(`  ${r.letter}  ${r.earned}/${r.possible} (${r.pct}%), average band ${r.average_letter}`);
  L.push('');
  L.push('  The letter is the WORST dimension, not the average. A harness is as mature');
  L.push('  as its weakest gate, and both numbers are shown so neither can hide.');
  L.push('');
  for (const d of r.dimensions) {
    const band = d.letter ?? 'n/a';
    const score = d.measured ? `${d.earned}/${d.possible}` : 'not measured';
    L.push(`  ${band.padEnd(4)} ${d.title.padEnd(28)} ${score}`);
    for (const c of d.checks) {
      if (c.state === 'pass') continue;
      const mark = c.state === 'n/a' ? '  --' : c.state.toUpperCase().padStart(4);
      L.push(`       ${mark}  ${c.id.padEnd(22)} ${c.receipt ?? 'absent'}`);
    }
  }
  L.push('');
  if (r.problems.length) {
    L.push(`  ${r.problems.length} file(s) would not parse and counted AGAINST their dimension:`);
    for (const p of r.problems) L.push(`       ${p.path}: ${p.problem}`);
    L.push('');
  }
  if (res.profile && !res.profile.complete) {
    L.push(`  Export is REDACTED: ${res.profile.redacted_count} value(s) dropped ` +
      `(${res.profile.redacted_rules.join(', ')}).`);
    L.push('');
  }
  if (res.cardNote) {
    L.push(`  ${res.cardNote}`);
    L.push('');
  }
  for (const f of res.written) L.push(`  wrote ${f}`);
  if (res.ignoreNote) {
    L.push('');
    L.push(`  WARNING: ${res.ignoreNote}`);
  }
  L.push('');
  L.push('  Read from the harness surface only. Nothing left this machine.');
  return L.join('\n');
}
