/**
 * `doorman needs` - the CLI half. Reads the history, fetches the free feed,
 * and hands both to the pure functions in ../src/needs.mjs.
 *
 * The only request made here is the same anonymous `GET /feed` that `watch`
 * makes. The prompts are read, matched and discarded locally. Nothing about
 * this build is sent anywhere, which is the whole reason the expensive half of
 * the product is the shared grade and the cheap half is the private fit.
 */

import { readFileSync, existsSync } from 'node:fs';
import { inventoryFor } from '../src/inventory.mjs';
import { installedKeys, serverKey } from './watch.mjs';
import {
  readPrompts, historyDirFor, suggest, renderNeeds, NEEDS,
} from '../src/needs.mjs';

export const DEFAULT_API = 'https://scorecard.wanessalabs.com';

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
} = {}) {
  const inv = inventoryFor(root);
  const installed = installedKeys(inv);

  const dir = historyDir ?? historyDirFor(root);
  let prompts = [];
  let historyNote;
  if (!dir) {
    historyNote = 'No readable prompt history for this path. Claude Code keeps it under ' +
      '~/.claude/projects/<path-with-dashes>; other harnesses keep none that doorman can read. ' +
      'Pass --history DIR if yours lives elsewhere.';
  } else {
    prompts = readPrompts(dir);
    historyNote = `history: ${dir}`;
  }

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
    // rankCandidates compares against whatever url a candidate carries, so the
    // installed set has to be keyed the same way the inventory was.
    installed: new Set([...candidates.map((c) => c.server_url).filter(Boolean)]
      .filter((u) => installedUrls.has(serverKey(u)))),
  });

  return {
    ...report,
    api,
    history_dir: dir,
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
