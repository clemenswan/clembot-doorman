/**
 * `doorman discover` - find candidates in a public MCP directory.
 *
 * MACHINES FETCH, HUMANS CURATE. This writes a candidate file and stops. It
 * never enqueues an audit, never spends, and never adds anything to a feed.
 * 13,648 entries you have not looked at is not a feed, it is a backlog, and
 * auto-promoting a directory into a grading queue would put the operator's name
 * on verdicts nobody chose to seek.
 *
 * WHAT IT CAN AND CANNOT DO, and the distinction is the whole file:
 *
 * The Smithery registry publishes each server's TOOL DESCRIPTIONS in its detail
 * record. So the static scan, the one that found instruction-shaped content in
 * a shipping product, can run over the directory's own published text without
 * calling a single server, without auth, and without spending anything.
 *
 * That is a SCAN, not a GRADE. A grade requires driving the server: does the
 * agent succeed, does it recover, does it get steered. The registry cannot tell
 * you that and neither can this command, so it reports `graded: false` on every
 * row and never emits a letter. This is `mayBeGraded()` applied to a third
 * source: when there is nothing to drive, say what was not measured rather than
 * leaving a null for a reader to fill in wrongly.
 *
 * WHY IT DOES NOT RESOLVE AN ORIGIN. The registry only ever returns its own
 * proxy (`<name>.run.tools`), which answers 401 without a Smithery token. The
 * origin endpoint is not in the record. So a candidate here carries the
 * registry identity and needs a human to supply the real endpoint before it can
 * be graded. Pretending the proxy url is the server would grade the proxy.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sniffInstructions } from '../src/injection.mjs';

export const SMITHERY_API = 'https://registry.smithery.ai';
export const PAGE_SIZE = 100;
export const UA = 'clembot-doorman/0.1 (+https://clembot-doorman.wanessalabs.com)';

/** The proxy host the registry hands out instead of an origin. */
export const PROXY_SUFFIX = '.run.tools';

/**
 * Is this url something doorman could actually grade?
 *
 * The registry's deploymentUrl is a proxy that requires a Smithery token, so it
 * is NOT a gradeable endpoint even though it is a valid https url. Saying so
 * per row is the difference between a candidate list and a list of things that
 * will 401 when somebody tries.
 */
export function isGradeableEndpoint(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return !u.hostname.endsWith(PROXY_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Everything a scan can see in one registry record.
 *
 * Tool descriptions are concatenated with their names, because a name can carry
 * steering too and scanning descriptions alone would miss it.
 */
export function scannableText(detail) {
  const parts = [];
  if (detail.description) parts.push(String(detail.description));
  for (const t of detail.tools ?? []) {
    if (t?.name) parts.push(String(t.name));
    if (t?.description) parts.push(String(t.description));
  }
  return parts.join('\n\n');
}

export function assess(listRow, detail) {
  const text = scannableText(detail);
  const scan = sniffInstructions(text, 'registry:tool-descriptions');
  const endpoint = detail.deploymentUrl ?? (detail.connections ?? [])[0]?.deploymentUrl ?? null;

  return {
    source: 'smithery',
    id: listRow.qualifiedName ?? detail.qualifiedName,
    name: detail.displayName ?? listRow.displayName ?? null,
    registry_url: `${SMITHERY_API}/servers/${encodeURIComponent(listRow.qualifiedName)}`,
    // What the registry hands out, and whether it is any use for grading.
    registry_endpoint: endpoint,
    endpoint_is_proxy: endpoint ? !isGradeableEndpoint(endpoint) : null,
    gradeable_endpoint: isGradeableEndpoint(endpoint) ? endpoint : null,
    homepage: listRow.homepage ?? null,
    verified: Boolean(listRow.verified),
    use_count: listRow.useCount ?? null,
    tools: (detail.tools ?? []).length,
    // The registry has a security field. On everything sampled it is null.
    registry_security: detail.security ?? null,
    scan: {
      scanned_chars: scan.scanned_chars,
      hard: scan.hard,
      steering: scan.steering,
      failure_modes: scan.failure_modes,
    },
    // Never a letter. Nothing here drove the server.
    graded: false,
    grade: null,
    behavioral: 'n/a - nothing was driven, this is a scan of published text',
  };
}

/** One page of the registry listing. */
export async function fetchPage(page, { fetchImpl = fetch, api = SMITHERY_API } = {}) {
  const r = await fetchImpl(`${api}/servers?pageSize=${PAGE_SIZE}&page=${page}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!r.ok) {
    const e = new Error(`registry listing returned HTTP ${r.status} on page ${page}`);
    e.code = 3;
    throw e;
  }
  return r.json();
}

export async function fetchDetail(qualifiedName, { fetchImpl = fetch, api = SMITHERY_API } = {}) {
  const r = await fetchImpl(`${api}/servers/${encodeURIComponent(qualifiedName)}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!r.ok) return null;                 // one bad record must not stop a sweep
  return r.json();
}

/** Servers already graded, so a sweep does not re-propose them. Free to read. */
export async function alreadyGraded(feedApi, { fetchImpl = fetch } = {}) {
  const known = new Set();
  if (!feedApi) return known;
  try {
    const r = await fetchImpl(`${feedApi.replace(/\/+$/, '')}/feed?limit=200`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return known;
    const j = await r.json();
    for (const c of j.candidates ?? []) {
      known.add(String(c.server_url).toLowerCase());
      if (c.server_name) known.add(String(c.server_name).toLowerCase());
    }
  } catch { /* a discovery run must not fail because the feed is down */ }
  return known;
}

export async function discover({
  pages = 1,
  feedApi = null,
  fetchImpl = fetch,
  api = SMITHERY_API,
  onProgress = () => {},
} = {}) {
  const known = await alreadyGraded(feedApi, { fetchImpl });
  const rows = [];
  let listed = 0;
  let detailFailed = 0;
  let totalCount = null;

  for (let page = 1; page <= pages; page++) {
    const j = await fetchPage(page, { fetchImpl, api });
    totalCount = j.pagination?.totalCount ?? totalCount;
    const servers = j.servers ?? [];
    if (!servers.length) break;

    for (const s of servers) {
      listed++;
      const detail = await fetchDetail(s.qualifiedName, { fetchImpl, api });
      if (!detail) { detailFailed++; continue; }
      const row = assess(s, detail);
      row.already_graded = known.has(String(row.id).toLowerCase()) ||
                           (row.name ? known.has(String(row.name).toLowerCase()) : false);
      rows.push(row);
      onProgress(listed, rows.length);
    }
    if (j.pagination && page >= (j.pagination.totalPages ?? page)) break;
  }

  const flagged = rows.filter((r) => r.scan.hard > 0 || r.scan.steering > 0);
  return {
    source: 'smithery',
    swept_at: new Date().toISOString(),
    registry_total: totalCount,
    listed,
    assessed: rows.length,
    detail_fetch_failed: detailFailed,
    // The numbers that decide whether this is worth a human's time.
    with_gradeable_endpoint: rows.filter((r) => r.gradeable_endpoint).length,
    already_graded: rows.filter((r) => r.already_graded).length,
    flagged_by_scan: flagged.length,
    hard_hits: rows.reduce((n, r) => n + r.scan.hard, 0),
    steering_hits: rows.reduce((n, r) => n + r.scan.steering, 0),
    registry_security_present: rows.filter((r) => r.registry_security != null).length,
    candidates: rows,
  };
}

export function writeCandidates(file, result) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
}

export function renderDiscover(r, file) {
  const out = [];
  out.push(`doorman discover  ${r.source}`);
  out.push(`  registry holds   ${r.registry_total ?? 'unknown'} servers`);
  out.push(`  swept            ${r.listed} listed, ${r.assessed} assessed` +
           (r.detail_fetch_failed ? `, ${r.detail_fetch_failed} detail fetches failed` : ''));
  out.push('');
  out.push(`  already graded by this scorecard   ${r.already_graded}`);
  out.push(`  with a gradeable endpoint          ${r.with_gradeable_endpoint} of ${r.assessed}`);
  out.push(`  registry security field populated  ${r.registry_security_present} of ${r.assessed}`);
  out.push('');
  out.push(`  NEEDS A HUMAN LOOK                 ${r.flagged_by_scan}` +
           `   (${r.hard_hits} injection-shaped, ${r.steering_hits} commercial steering)`);
  out.push('');
  out.push('  These are candidates for review, NOT findings, and the difference');
  out.push('  is not pedantry. The first sweep of 100 servers flagged fifteen');
  out.push('  and TWO survived a hand check: a Slack parameter that posts a');
  out.push('  reply to a conversation, an LLM testing tool whose job is to');
  out.push('  accept a system prompt, "system:" as a docstring parameter name,');
  out.push('  and five vendors saying "use this instead of" about another tool');
  out.push('  in their OWN server. Five patterns were tightened on 2026-09-10');
  out.push('  and the same sweep now flags those two and nothing else.');
  out.push('');
  out.push('  That is thirteen strings, not a directory. Zero false positives on');
  out.push('  a corpus that small means the KNOWN failure modes are fixed, not');
  out.push('  that the next hundred servers hold none. Read the excerpt before');
  out.push('  repeating any of it. See test/discover-precision.test.mjs.');

  const flagged = r.candidates.filter((c) => c.scan.hard || c.scan.steering)
    .sort((a, b) => (b.use_count ?? 0) - (a.use_count ?? 0));
  if (flagged.length) {
    out.push('');
    for (const c of flagged.slice(0, 12)) {
      const marks = [c.scan.hard ? `${c.scan.hard} hard` : null,
                     c.scan.steering ? `${c.scan.steering} steering` : null].filter(Boolean).join(', ');
      out.push(`  ${c.verified ? '*' : ' '} ${String(c.use_count ?? 0).padStart(7)} uses  ${c.id}`);
      out.push(`      ${marks}${c.tools ? `, ${c.tools} tools` : ''}`);
      if (c.scan.failure_modes[0]) out.push(`      ${c.scan.failure_modes[0].slice(0, 118)}`);
    }
    if (flagged.length > 12) out.push(`  ... and ${flagged.length - 12} more in the file`);
  }

  out.push('');
  out.push(`  written to ${file}`);
  out.push('');
  out.push('THIS IS A SCAN, NOT A GRADE. Nothing was driven and no letter was');
  out.push('assigned. It reads the tool descriptions the registry itself');
  out.push('publishes, which is the same surface an agent reads before deciding');
  out.push('what to call. A grade needs the origin endpoint, and the registry');
  out.push('returns only its own proxy, which answers 401 without its token.');
  out.push('');
  out.push('Nothing has been queued and nothing has been spent. Curate the file.');
  return out.join('\n');
}
