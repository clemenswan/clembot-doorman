/**
 * `doorman leaks`: what this build has already sent off the machine.
 *
 * ── Why tool calls and not prompts ───────────────────────────────────────────
 *
 * `needs` reads PROMPTS, because it is asking what the operator wanted. This
 * reads TOOL CALLS, because it is asking what actually left. Those are
 * different corpora and using the prompt corpus here would be a category
 * error: a budget mentioned in a prompt leaked nothing if no request carried
 * it, and a budget in a request body leaked whether or not anyone typed it.
 *
 * So the unit is one outbound tool call, filtered by `egressReason`, and the
 * denominator is the number of calls that had an outbound channel at all.
 * Counting local `Read` and `Edit` calls would make any leak rate look better
 * than it is.
 *
 * ── Excerpts are off by default ──────────────────────────────────────────────
 *
 * `dashboard.mjs` renders matched terms and never `g.examples`, because the
 * report is a file on disk and history holds client material. The same rule
 * binds harder here: an excerpt in THIS report is, by construction, the leaked
 * content itself. `--evidence` opts in, and the header says what that means.
 *
 * ── It measures, it does not advise ──────────────────────────────────────────
 *
 * The pattern table is not validated against a merchant corpus (see
 * `src/leaks.mjs`). A row that never fires is reported as silent rather than
 * hidden, because which guesses the real world does not contain is the most
 * useful thing an unvalidated table can tell you.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { historyDirFor } from '../src/needs.mjs';
import { egressReason, scanToolInput, summarise, LEAK_PATTERNS } from '../src/leaks.mjs';
import { vaultHistoryDirs } from './needs.mjs';

/**
 * Pull every outbound tool call out of one transcript directory.
 *
 * Only `assistant` records carry `tool_use`. A tool RESULT is not a call and
 * counting one would double every figure, which is the same trap invariant 28
 * describes on the prompt side.
 */
export function readToolCalls(dir, { limit = 100000, fs = { readdirSync, readFileSync } } = {}) {
  const out = [];
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return out;
  }

  for (const f of files) {
    let body;
    try { body = fs.readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const line of body.split('\n')) {
      if (!line.startsWith('{')) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec.type !== 'assistant') continue;
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        out.push({
          name: block.name,
          input: block.input ?? {},
          session: rec.sessionId ?? null,
          id: block.id ?? null,
        });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/**
 * Scan a set of transcript directories.
 *
 * `calls` counts every tool call seen; `egress` counts the ones with an
 * outbound channel. Both are reported because their ratio is the honest
 * statement of how much of a build's activity this even looks at.
 */
export function scanHistory(dirs, opts = {}) {
  const hits = [];
  const byTool = new Map();
  let calls = 0;
  let egress = 0;
  let truncatedCalls = 0;

  for (const dir of dirs) {
    for (const call of readToolCalls(dir, opts)) {
      calls++;
      const reason = egressReason(call.name, call.input);
      if (!reason) continue;
      egress++;
      byTool.set(reason, (byTool.get(reason) ?? 0) + 1);
      const r = scanToolInput(call.name, call.input);
      if (r.truncated) truncatedCalls++;
      for (const h of r.hits) hits.push({ ...h, tool: call.name, reason, session: call.session });
    }
  }

  return {
    ...summarise(hits, { prompts: egress }),
    hits,
    calls,
    egress,
    truncatedCalls,
    byTool: [...byTool.entries()].map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    dirs,
  };
}

/** Resolve which history directories to read. Same precedence as `needs`. */
export function historyDirsFor(root, { vault = false, home } = {}) {
  if (vault) return vaultHistoryDirs(root, home ? { home } : {});
  const one = historyDirFor(root);
  return one ? [one] : [];
}

export function leaks({ root = process.cwd(), vault = false, evidence = false } = {}) {
  // Resolve before deriving anything. Both directory lookups key on the path
  // string: `historyDirFor` slugs it, and `vaultHistoryDirs` takes its needle
  // from the basename. A relative `..` slugs to `--` and matches nothing, which
  // returns the same "no transcripts" message as a genuinely unknown project.
  root = resolve(root);
  const dirs = historyDirsFor(root, { vault });
  if (!dirs.length) {
    return {
      ok: false,
      why: 'no Claude Code transcript directory found for this project. `leaks` reads what was actually sent, so it has nothing to read.',
      root,
    };
  }
  const res = scanHistory(dirs);
  return { ok: true, root, vault, evidence, ...res };
}

/** Terminal rendering. Terse on purpose; the interesting case is a zero. */
export function renderLeaks(res) {
  if (!res.ok) return `leaks: ${res.why}`;

  const L = [];
  L.push('');
  L.push(`  Outbound leak scan: ${res.root}`);
  L.push(`  ${res.dirs.length} transcript director${res.dirs.length === 1 ? 'y' : 'ies'}` +
    (res.vault ? ' (workspace-wide)' : ''));
  L.push('');
  L.push(`  ${res.calls} tool calls seen, ${res.egress} with an outbound channel.`);
  L.push('  Local file tools are not scanned: they disclose to nobody, and counting');
  L.push('  them would flatter the rate.');
  if (res.truncatedCalls) {
    L.push(`  ${res.truncatedCalls} call(s) had argument trees past the node cap and were`);
    L.push('  scanned only in part. Reported, not silent.');
  }
  L.push('');

  if (res.byTool.length) {
    L.push('  Channels read:');
    for (const t of res.byTool) L.push(`    ${String(t.count).padStart(6)}  ${t.reason}`);
    L.push('');
  }

  if (res.total === 0) {
    L.push(`  NO LEAKS MATCHED. 0 hits across ${res.egress} outbound calls.`);
    L.push('');
    L.push(`  All ${res.patternsTotal} patterns stayed silent. Read this as a measurement,`);
    L.push('  not as a clean bill of health. Two readings fit it equally:');
    L.push('    1. this build does not shop, so there is nothing to leak yet;');
    L.push('    2. the table is guessing at the wrong signals.');
    L.push('  Only a real shopping corpus separates them, which is the experiment.');
    return L.join('\n');
  }

  L.push(`  ${res.total} hit(s) across ${res.egress} outbound calls.`);
  L.push('');
  L.push('  By category:');
  for (const [cat, n] of Object.entries(res.byCategory)) {
    if (n) L.push(`    ${String(n).padStart(6)}  ${cat}`);
  }
  L.push('');
  L.push('  By what it would cost to stop:');
  const cost = {
    local: 'redaction on this machine is enough',
    relay: 'carried by the connection, needs an exit identity',
    neither: 'cannot be masked, only not sent',
  };
  for (const [m, n] of Object.entries(res.byMaskability)) {
    if (n) L.push(`    ${String(n).padStart(6)}  ${m}  (${cost[m]})`);
  }
  L.push('');
  L.push('  Patterns that fired:');
  for (const p of res.byPattern) {
    const row = LEAK_PATTERNS.find((x) => x.name === p.pattern);
    L.push(`    ${String(p.count).padStart(6)}  ${p.pattern}  [${row ? row.category : '?'}]`);
  }
  L.push('');

  if (res.evidence) {
    L.push('  Evidence. These excerpts ARE the leaked content. Do not paste this');
    L.push('  section anywhere you would not paste the original request.');
    L.push('');
    for (const h of res.hits.slice(0, 40)) {
      L.push(`    ${h.pattern} @ ${h.location}`);
      L.push(`      "${h.excerpt}"`);
    }
    if (res.hits.length > 40) L.push(`    ... and ${res.hits.length - 40} more.`);
    L.push('');
  } else {
    L.push('  Excerpts withheld. An excerpt here is the leaked content itself.');
    L.push('  Re-run with --evidence to see them.');
    L.push('');
  }

  if (res.silent.length) {
    L.push(`  Silent rows (${res.silent.length} of ${res.patternsTotal}), never matched:`);
    L.push('    ' + res.silent.join(', '));
    L.push('  An unvalidated table reporting which guesses missed is the point.');
  }

  return L.join('\n');
}
