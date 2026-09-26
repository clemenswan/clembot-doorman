/**
 * What moved in the harness since the last time anybody looked.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 *
 * Everything `profile` learns ends up in a report a human has to remember to
 * generate and then read. The SessionStart channel already exists and already
 * reaches the agent's context unasked, and until now it carried newly graded
 * MCP servers: useful to somebody adopting servers, and useless to a build
 * with none, which is the shape most builds are. This puts the measurement
 * that is actually about YOUR repo into the channel that actually arrives.
 *
 * ── It inherits notify's three rules, because they are right ─────────────────
 *
 * 1. SILENT WHEN NOTHING MOVED. A delta that prints "no change" every morning
 *    trains the operator to skip the morning it matters.
 * 2. THE FIRST RUN SAYS NOTHING. With no prior report every check has "moved",
 *    and announcing ten of them as news the first time is a catalogue.
 * 3. A DAY IS THE UNIT. `profile` writes one directory per local day and
 *    same-day reruns overwrite, so the comparison is against the last DAY that
 *    has a report, never against the last invocation. Running the tool twice
 *    before lunch is not news.
 *
 * ── Two points, not a trend ──────────────────────────────────────────────────
 *
 * Reads exactly one prior report, the most recent before today. The directory
 * accumulates a real series and a trend could be computed from it, but a
 * sentence somebody reads at session start is a comparison, not a chart.
 * `dashboard.mjs` made the same call for the same reason.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where `profile` keeps its reports for one repo. */
export function reportDir(root, slug) {
  return join(root, '.doorman', 'profile', slug);
}

/**
 * The most recent report STRICTLY BEFORE `today`.
 *
 * Lexical sort works because the directories are ISO dates, and it stays
 * correct across a year boundary in a way a numeric parse of the month would
 * not.
 */
export function previousReport(dir, today, { fs = { readdirSync, readFileSync } } = {}) {
  let days = [];
  try {
    days = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch { return null; }
  const before = days.filter((d) => d < today);
  for (let i = before.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(fs.readFileSync(join(dir, before[i], 'report.json'), 'utf8'));
    } catch {
      // A report that will not parse is skipped rather than fatal: the point
      // is to find SOME earlier point to compare against, and an older one is
      // still a comparison. Returning null here would turn one corrupt file
      // into a permanently silent channel.
    }
  }
  return null;
}

const flat = (r) => {
  const m = new Map();
  for (const d of r?.dimensions ?? []) for (const c of d.checks ?? []) m.set(c.id, { ...c, dimension: d });
  return m;
};

/** Ordered worst to best, so "moved which way" is a comparison of indices. */
const ORDER = ['F', 'D', 'C', 'B', 'A'];
const rank = (l) => ORDER.indexOf(l);

/**
 * Compare two reports.
 *
 * Returns null when there is nothing to say, which is what keeps the channel
 * quiet. A caller that treats null as an error will print noise forever.
 */
export function diffReports(prev, cur) {
  if (!prev || !cur) return null;

  const before = flat(prev);
  const after = flat(cur);
  const moved = [];

  for (const [id, c] of after) {
    const p = before.get(id);
    if (!p) {
      moved.push({ id, kind: 'added', to: c.state, check: c });
      continue;
    }
    if (p.state !== c.state) {
      // A check going from measured to n/a is not an improvement, and the
      // direction word has to say so rather than calling it "fixed".
      const kind = c.state === 'n/a' || p.state === 'n/a' ? 'changed'
        : (c.state === 'pass' ? 'fixed' : p.state === 'pass' ? 'broke' : 'changed');
      moved.push({ id, kind, from: p.state, to: c.state, check: c });
    }
  }
  for (const [id, p] of before) {
    if (!after.has(id)) moved.push({ id, kind: 'removed', from: p.state, check: p });
  }

  const letterMoved = prev.letter !== cur.letter;
  if (!moved.length && !letterMoved) return null;

  return {
    from: prev.generated_at?.slice(0, 10) ?? null,
    to: cur.generated_at?.slice(0, 10) ?? null,
    letterFrom: prev.letter,
    letterTo: cur.letter,
    // Positive means better. Null when either side has no letter, rather than
    // zero, which would read as "no change".
    letterDirection: prev.letter && cur.letter ? rank(cur.letter) - rank(prev.letter) : null,
    pctFrom: prev.pct,
    pctTo: cur.pct,
    moved: moved.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * A stable identity for one delta, so it is announced ONCE.
 *
 * Rule 1 said "silent when nothing moved" and the first implementation read
 * that as a question about the two reports, which it is not. The digest is
 * consumed on read and then rebuilt by the next refresh from the same two
 * files on disk, so an unchanged pair regenerated an identical delta and every
 * session start announced the same fix again. Worse than a daily "no change":
 * it looks like news.
 *
 * `moved` is already sorted by id in `diffReports`, so this string is stable
 * across runs. It deliberately includes the states, not just the ids: a check
 * that moves again is a NEW announcement, not a repeat of the old one.
 */
export function deltaSignature(diff) {
  if (!diff) return null;
  const moved = diff.moved
    .map((m) => `${m.id}:${m.kind}:${m.from ?? ''}>${m.to ?? ''}`)
    .join(',');
  return [
    `${diff.from ?? ''}>${diff.to ?? ''}`,
    `${diff.letterFrom ?? ''}>${diff.letterTo ?? ''}`,
    `${diff.pctFrom ?? ''}>${diff.pctTo ?? ''}`,
    moved,
  ].join('|');
}

/**
 * The digest section. Markdown, because it is read by a person AND lands in an
 * agent's context, and markdown is the one format both parse without help.
 *
 * Every line names a check id and a file. A session-start note that says "your
 * harness got worse" and does not say where is a note that costs attention and
 * returns nothing.
 */
export function renderDelta(diff, { slug = null } = {}) {
  if (!diff) return null;

  const out = [];
  out.push('## doorman: your harness');
  out.push('');

  if (diff.letterFrom !== diff.letterTo) {
    const word = diff.letterDirection > 0 ? 'up' : diff.letterDirection < 0 ? 'DOWN' : 'changed';
    out.push(`Band ${word} from **${diff.letterFrom ?? 'n/a'}** to **${diff.letterTo ?? 'n/a'}**`
      + `${diff.pctFrom != null && diff.pctTo != null ? ` (${diff.pctFrom}% to ${diff.pctTo}%)` : ''}`
      + `, since ${diff.from ?? 'the last run'}.`);
  } else if (diff.pctFrom !== diff.pctTo) {
    out.push(`Band held at **${diff.letterTo}**, score ${diff.pctFrom}% to ${diff.pctTo}%, `
      + `since ${diff.from ?? 'the last run'}.`);
  } else {
    out.push(`Band held at **${diff.letterTo}**, and these moved since ${diff.from ?? 'the last run'}.`);
  }
  out.push('');

  const label = { fixed: 'fixed', broke: 'BROKE', changed: 'changed', added: 'new check', removed: 'check gone' };
  for (const m of diff.moved) {
    const where = m.check?.receipt && m.check.receipt !== 'absent' ? ` \`${m.check.receipt}\`` : '';
    const arrow = m.from && m.to ? ` (${m.from} to ${m.to})` : '';
    out.push(`- **${label[m.kind]}** \`${m.id}\`${arrow}${where}`);
  }
  out.push('');
  out.push(`Run \`doorman profile${slug ? ' --name ' + slug : ''}\` for the full report, `
    + '`--sow` to turn what is open into work packages.');
  return out.join('\n');
}
