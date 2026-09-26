/**
 * `doorman needs` - the CLI half. Reads the history, fetches the free feed,
 * and hands both to the pure functions in ../src/needs.mjs.
 *
 * The only request made here is the same anonymous `GET /feed` that `watch`
 * makes. The prompts are read, matched and discarded locally. Nothing about
 * this build is sent anywhere, which is the whole reason the expensive half of
 * the product is the shared grade and the cheap half is the private fit.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { inventoryFor } from '../src/inventory.mjs';
import { installedKeys, serverKey } from './watch.mjs';
import {
  readPrompts, historyDirFor, suggest, renderNeeds, NEEDS,
} from '../src/needs.mjs';

export const DEFAULT_API = 'https://scorecard.wanessalabs.com';

/**
 * Every transcript directory belonging to this project's wider workspace.
 *
 * A vault is rarely one directory. This one has ten: the root plus nine
 * worktrees, each with its own slug under ~/.claude/projects, and a need that
 * shows up once in each reads as nine small asks instead of one large one.
 *
 * THE MATCH IS DERIVED FROM THE ROOT, never hardcoded. Claude Code slugs a path
 * by replacing every non-alphanumeric character with a dash, so a worktree of
 * `.../ClemVault/x` slugs to something containing `ClemVault`. Taking the root's
 * own directory name as the needle makes `--vault` mean the same thing for a
 * build this tool has never seen, which is the only version worth shipping in
 * something other people install.
 *
 * It is a substring match on a dashed slug, so it is deliberately generous:
 * a directory named `vault` would sweep in anything with `vault` in its path.
 * The report says which directories it read for exactly that reason.
 */
export function vaultHistoryDirs(root, { home = homedir() } = {}) {
  const needle = basename(String(root ?? '')).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
  if (needle.length < 3) return [];
  const base = join(home, '.claude', 'projects');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((d) => d.toLowerCase().includes(needle))
    .map((d) => join(base, d))
    .filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
    .sort();
}

/**
 * Tokens processed per session, read from the transcripts Claude Code wrote.
 *
 * WHAT IS AND IS NOT IN THESE FILES. There is no cost field anywhere in a
 * transcript. What exists is `message.usage`, with input, output, cache
 * creation and cache read counts. So this returns tokens and a permanently null
 * `cost_usd`: turning tokens into money needs a price table, CodeBurn already
 * owns that math against these same files, and a second one here would drift
 * from it the first time a rate moved.
 *
 * All four counts are summed. In this vault that total is 98.1% cache reads, so
 * it measures context carried rather than money spent, and every surface that
 * shows it says "tokens processed" rather than anything about cost.
 *
 * Keyed on `sessionId`, which is what `readPrompts` attaches to a prompt.
 * Transcripts also carry a `session_id`, and the two are not always both
 * present on a record; `sessionId` was on 100% of 30,801 user records across
 * this vault's ten directories, and `session_id` alone on none, so keying on
 * the other one would silently attribute nothing.
 */
export function readSessionTokens(dirs, { fs = { readdirSync, readFileSync } } = {}) {
  const map = new Map();
  for (const dir of [].concat(dirs).filter(Boolean)) {
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const file of files) {
      let body;
      try { body = fs.readFileSync(join(dir, file), 'utf8'); } catch { continue; }
      for (const line of body.split('\n')) {
        if (!line.startsWith('{')) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        const u = rec?.message?.usage;
        const id = rec?.sessionId;
        if (!id || !u || typeof u !== 'object') continue;
        const t = (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
          + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        const prev = map.get(id);
        if (prev) prev.tokens += t;
        else map.set(id, { tokens: t, cost_usd: null });
      }
    }
  }
  return map;
}

/**
 * Candidates from a local `doorman discover` sweep, if one has been run.
 *
 * These are UNGRADED by construction: discover scans published text and never
 * drives anything, and it writes `graded: false` on every row. They are
 * included because a need with only ungraded options is still better
 * information than a need with none, and every row says which it is.
 */
export function readCandidateFile(file) {
  if (!file || !existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.candidates ?? []);
    return rows.map((c) => ({ ...c, source: c.source ?? 'candidates' }));
  } catch {
    return [];
  }
}

export async function needs({
  root, api, historyDir, candidateFile, limit = 200, fetchImpl = fetch,
  vault = false, historyDirs = null,
} = {}) {
  const inv = inventoryFor(root);
  const installed = installedKeys(inv);

  // Per-project is unchanged and still the default: one root, one directory.
  // `--vault` widens to the whole workspace, and an explicit historyDirs wins
  // over both so a caller can say exactly what to read.
  const dirs = historyDirs
    ?? (vault ? vaultHistoryDirs(root) : [historyDir ?? historyDirFor(root)].filter(Boolean));

  let prompts = [];
  let historyNote;
  if (!dirs.length) {
    historyNote = 'No readable prompt history for this path. Claude Code keeps it under ' +
      '~/.claude/projects/<path-with-dashes>; other harnesses keep none that doorman can read. ' +
      'Pass --history DIR if yours lives elsewhere.';
  } else if (dirs.length === 1) {
    prompts = readPrompts(dirs[0]);
    historyNote = `history: ${dirs[0]}`;
  } else {
    // Merged before deduplication on purpose. readPrompts already drops a
    // repeated sentence by text prefix, and a resumed session copies its whole
    // prior transcript into a new file, so the same ask lands in several of
    // these directories. Deduplicating per directory and summing afterwards
    // would count it once per worktree.
    const seen = new Set();
    for (const d of dirs) {
      for (const p of readPrompts(d)) {
        const key = p.text.trim().slice(0, 400);
        if (seen.has(key)) continue;
        seen.add(key);
        prompts.push(p);
      }
    }
    historyNote = `history: ${dirs.length} directories under ~/.claude/projects`;
  }

  // Tokens come from the same files the prompts did, so a session that has
  // prompts always has a cost entry unless its usage records are unreadable.
  const sessionCosts = dirs.length ? readSessionTokens(dirs) : null;

  // The feed is free and anonymous. A failure here is "could not measure",
  // never a reason to invent a suggestion, so an empty candidate list flows
  // straight through to a GAP line that says so.
  let feed = [];
  let feedNote = null;
  try {
    const url = new URL('/feed', api);
    url.searchParams.set('limit', String(limit));
    const res = await fetchImpl(url.toString(), { headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = await res.json();
      feed = (body.candidates ?? []).map((c) => ({ ...c, source: 'feed' }));
    } else {
      feedNote = `feed returned HTTP ${res.status}; candidates below are local only`;
    }
  } catch (e) {
    feedNote = `feed unreachable (${e.message}); candidates below are local only`;
  }

  const candidates = [...feed, ...readCandidateFile(candidateFile)];
  const installedUrls = new Set([...installed]);

  const report = suggest({
    prompts,
    inventory: inv,
    candidates,
    sessionCosts,
    // rankCandidates compares against whatever url a candidate carries, so the
    // installed set has to be keyed the same way the inventory was.
    installed: new Set([...candidates.map((c) => c.server_url).filter(Boolean)]
      .filter((u) => installedUrls.has(serverKey(u)))),
  });

  return {
    ...report,
    api,
    history_dir: dirs[0] ?? null,
    history_dirs: dirs,
    vault_wide: dirs.length > 1,
    sessions_priced: sessionCosts ? sessionCosts.size : 0,
    history_note: historyNote,
    feed_note: feedNote,
    feed_rows: feed.length,
    local_candidates: candidates.length - feed.length,
    taxonomy: NEEDS.map((n) => n.id),
    inventory: {
      root: inv.root ?? root,
      coverage: inv.coverage ?? { agents: 'unknown', skills: 'unknown', mcpServers: 'unknown' },
      mcp_servers: (inv.mcpServers ?? []).length,
    },
  };
}

export function render(r) {
  const head = [r.history_note, r.feed_note,
    `feed: ${r.feed_rows} graded rows` + (r.local_candidates ? `, plus ${r.local_candidates} local` : ''),
  ].filter(Boolean).join('\n  ');
  let out = renderNeeds(r, { historyNote: head });
  if (r.inventory.coverage.mcpServers !== 'read') {
    out += '\n\n!! No MCP config was readable here, so "already covered" below is a' +
           '\n   weaker claim than it looks: a server you have may be invisible to this run.';
  }
  return out;
}
