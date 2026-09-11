/**
 * `doorman watch` - the private half of a subscription.
 *
 * The feed is shared: a candidate is graded once and everyone reads that grade
 * for nothing. THIS half is private, and stays that way. It fetches the feed,
 * then decides which rows matter by reading YOUR inventory on YOUR machine.
 * Your agent roster, your installed servers and your allowlist are never sent
 * anywhere. The only request this makes is a GET for the feed, and that GET
 * says nothing about you.
 *
 * WHAT THIS IS NOT: it is not the fit review. `fitReview()` reads a candidate
 * against your build with a model and returns one of `redundant`, `fits`,
 * `needs-new-subagent`, `out-of-scope`. That needs a key and costs tokens.
 * What runs here is a MECHANICAL overlap check: string matching on hosts and
 * urls. It can tell you "you already have this one" and "this one hard-failed".
 * It cannot tell you whether a server you do not have would help, and it must
 * never claim to, so it never emits the word `fits`.
 *
 * Exit codes follow the rest of the CLI: 0 it ran, 2 usage, 3 could not
 * measure, 1 it broke.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { inventoryFor } from '../src/inventory.mjs';

export const DEFAULT_API = 'https://scorecard.wanessalabs.com';
export const DEFAULT_STATE = join('.doorman', 'watch.json');

/** What the mechanical check can honestly say. Deliberately not FIT_VERDICTS. */
export const WATCH_VERDICTS = ['already-installed', 'blocked', 'unreviewed', 'skipped'];

/**
 * Normalise a server url for comparison.
 *
 * Host plus path, lowercased, trailing slash and default ports removed. Host
 * alone is too coarse: openzeppelin publishes four different servers under one
 * host and treating them as one would report three of them as already
 * installed on the strength of the fourth.
 */
export function serverKey(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    const path = u.pathname.replace(/\/+$/, '');
    return (u.hostname.toLowerCase() + path.toLowerCase()) || u.hostname.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase().replace(/\/+$/, '') || null;
  }
}

/** Every server this build already knows about, from any source. */
export function installedKeys(inv) {
  const keys = new Set();
  for (const s of inv.mcpServers ?? []) {
    const k = serverKey(s.url);
    if (k) keys.add(k);
  }
  for (const a of inv.allowlisted ?? []) {
    const k = serverKey(a.url);
    if (k) keys.add(k);
  }
  return keys;
}

/**
 * Classify one feed row against one inventory. Pure, so it is testable without
 * a network or a filesystem.
 */
export function classify(candidate, keys) {
  if (candidate.is_fixture || candidate.self_graded) {
    return { verdict: 'skipped', why: candidate.is_fixture
      ? 'a deliberately hostile test fixture, not a candidate'
      : 'graded by the operator of the feed, about themselves' };
  }
  const key = serverKey(candidate.server_url);
  if (key && keys.has(key)) {
    return { verdict: 'already-installed', why: 'this build already has it' };
  }
  if (candidate.hard_fail) {
    return { verdict: 'blocked', why: candidate.hard_fail };
  }
  if (candidate.grade === 'F') {
    return { verdict: 'blocked', why: 'graded F' };
  }
  return {
    verdict: 'unreviewed',
    // Deliberately not "fits". Nothing here read the candidate against this
    // build; it only established that the build does not already have it.
    why: 'new to this build, and it passed the static layer',
  };
}

export function readState(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return { since: typeof raw.since === 'string' ? raw.since : null, seen: raw.seen ?? 0 };
  } catch {
    return { since: null, seen: 0 };
  }
}

export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * @param {object} opts
 * @param {string} opts.root        project to read the inventory from
 * @param {string} opts.api         scorecard base url
 * @param {string|null} opts.since  cursor; null for the first run
 * @param {number} opts.limit
 * @param {typeof fetch} [opts.fetchImpl]  injected in tests
 */
export async function watch({ root, api, since, limit, fetchImpl = fetch }) {
  const inv = inventoryFor(root);
  const keys = installedKeys(inv);

  const url = new URL('/feed', api);
  if (since) url.searchParams.set('since', since);
  url.searchParams.set('limit', String(limit));

  const res = await fetchImpl(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`feed returned HTTP ${res.status}`);
    err.code = 3;                                   // could not measure, not broken
    throw err;
  }
  const feed = await res.json();

  const rows = (feed.candidates ?? []).map((c) => ({ ...c, ...classify(c, keys) }));

  return {
    api,
    since_used: since ?? null,
    next_since: feed.next_since ?? null,
    inventory: {
      root: inv.root ?? root,
      // Counts are reported ALONGSIDE what could be read, never alone. "0
      // agents" is a fact in a Claude Code project and an artefact of asking
      // the wrong question in a Cursor one, and a caller has to be able to tell
      // those apart before trusting "new to this build".
      coverage: inv.coverage ?? { agents: 'unknown', skills: 'unknown', mcpServers: 'unknown' },
      agents: (inv.agents ?? []).length,
      skills: (inv.skills ?? []).length,
      mcp_servers: (inv.mcpServers ?? []).length,
      known_keys: keys.size,
      notes: inv.notes ?? [],
    },
    counts: WATCH_VERDICTS.reduce((acc, v) => {
      acc[v] = rows.filter((r) => r.verdict === v).length;
      return acc;
    }, {}),
    candidates: rows,
  };
}

export function renderWatch(r) {
  const out = [];
  out.push(`doorman watch  ${r.api}/feed`);
  const cov = r.inventory.coverage ?? {};
  const n = (count, seen) => (seen === 'read' ? String(count) : 'unknown');
  out.push(`  inventory: ${n(r.inventory.agents, cov.agents)} agents, ` +
           `${n(r.inventory.skills, cov.skills)} skills, ` +
           `${n(r.inventory.mcp_servers, cov.mcpServers)} mcp servers, ` +
           `${r.inventory.known_keys} known urls`);
  if (cov.mcpServers !== 'read') {
    out.push('  !! No MCP config was readable here, so "new to this build" below');
    out.push('     means "not found in a config I could read", which is a weaker');
    out.push('     claim. Everything may already be installed.');
  }
  for (const note of r.inventory.notes ?? []) out.push(`  note: ${note}`);
  out.push(`  cursor:    ${r.since_used ?? '(first run: everything graded so far)'}`);
  out.push('');

  if (!r.candidates.length) {
    out.push('Nothing new since the last run.');
    out.push('Your cursor is unchanged, so nothing has been missed.');
    return out.join('\n');
  }

  const order = ['unreviewed', 'blocked', 'already-installed', 'skipped'];
  const heading = {
    'unreviewed': 'NEW TO THIS BUILD  (not yet reviewed against it)',
    'blocked': 'BLOCKED  (do not adopt)',
    'already-installed': 'ALREADY INSTALLED',
    'skipped': 'SKIPPED',
  };

  for (const v of order) {
    const group = r.candidates.filter((c) => c.verdict === v);
    if (!group.length) continue;
    out.push(`${heading[v]}  (${group.length})`);
    for (const c of group) {
      const score = c.score === null || c.score === undefined ? '  n/a' : String(c.score).padStart(6);
      out.push(`  ${String(c.grade ?? '?').padEnd(2)} ${score}  ${c.server_url}`);
      out.push(`        ${c.why}`);
      if (v === 'unreviewed') {
        const unmeasured = ['behavioral_pct', 'guidance_pct']
          .filter((k) => c.layers?.[k] === null || c.layers?.[k] === undefined);
        if (unmeasured.length) {
          out.push(`        ${unmeasured.length} of 3 layers NOT measured on this grade`);
        }
        out.push(`        tape: ${c.transcripts}`);
      }
    }
    out.push('');
  }

  out.push('This was a mechanical overlap check, not a fit review. It knows what');
  out.push('you already have. It does not know whether any of these would help,');
  out.push('and it has not spent anything to find out.');
  out.push('');
  out.push('  doorman report <url>     what it implements, free');
  out.push('  doorman eval <url> --task <file>   whether it makes YOUR agent better');
  return out.join('\n');
}
