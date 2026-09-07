/**
 * /grade - enqueue an audit and read results back.
 *
 * POST /grade is asynchronous and says so. It returns 202 with an id, because
 * the audit runs on a machine that can execute Python. Pretending to be
 * synchronous and timing out would be worse than being honest about the queue.
 */

import { type Env, err, json } from '../index.js';

export interface GradeRequestItem {
  name?: string;
  url: string;
  needed_for?: string;
}

/** Cached grades older than this are stale enough to want a re-run. */
export const CACHE_TTL_DAYS = 30;

export async function handleGrade(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err('body must be JSON');
  }

  const items = normaliseRequest(body);
  if (!items.ok) return err(items.error);

  const owner = (req.headers.get('x-owner') ?? 'anonymous').slice(0, 120);
  const now = new Date().toISOString();
  const queued: Array<Record<string, unknown>> = [];

  for (const item of items.value) {
    const id = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO audits (id, server_url, server_name, needed_for, status, model, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, item.url, item.name ?? null, item.needed_for ?? null, 'queued', env.PROBE_MODEL, now),
      env.DB.prepare(
        'INSERT INTO pending (id, server_url, needed_for, requested_by, created_at) ' +
        'VALUES (?, ?, ?, ?, ?)',
      ).bind(id, item.url, item.needed_for ?? null, owner, now),
      env.DB.prepare(
        'INSERT INTO ledger (id, audit_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), id, 'queued', item.url, now),
    ]);

    queued.push({ audit_id: id, server_url: item.url, status: 'queued', poll: '/grade/' + id });
  }

  return json(
    {
      status: 'queued',
      count: queued.length,
      audits: queued,
      note:
        'Grading runs on a probe runner, not in the Worker: the static layer ' +
        'shells out to mcpscore (Python). Poll the per-audit URL.',
    },
    202,
  );
}

export async function handleGetAudit(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, server_url, server_name, status, grade, score, static_pct, behavioral_pct, ' +
    'guidance_pct, hard_fail, model, mcpscore_version, grade_json, report_md, recipe_md, ' +
    'evidence_sha256, anchor_tx, error, created_at, completed_at FROM audits WHERE id = ?',
  ).bind(id).first();

  if (!row) return err('no such audit: ' + id, 404);
  return json(shapeAudit(row));
}

/**
 * The tape.
 *
 * `/api/result` has stored every probe turn since day one and nothing could
 * read it back. "Do not trust the letter, replay the tape" is the product's
 * one sentence, and it was not true through the service: a caller could see
 * the verdict and the excerpt we chose to show them, and had no way to check
 * either against what the server actually said.
 *
 * Public and unauthenticated, deliberately. A grade is an accusation; the
 * evidence behind it cannot sit behind the token held by the party making it.
 *
 * Served as JSONL, verbatim, in probe and run order. Never paginated and never
 * sampled: a truncated tape is worse than no tape, because it looks complete.
 */
export async function handleTranscripts(id: string, url: URL, env: Env): Promise<Response> {
  const audit = await env.DB.prepare(
    'SELECT id, status FROM audits WHERE id = ?',
  ).bind(id).first();
  if (!audit) return err('no such audit: ' + id, 404);

  const { results } = await env.DB.prepare(
    'SELECT probe_id, run_index, score, jsonl FROM transcripts ' +
    'WHERE audit_id = ? ORDER BY probe_id, run_index',
  ).bind(id).all();

  const rows = (results ?? []) as Array<{
    probe_id: string; run_index: number; score: number | null; jsonl: string;
  }>;

  if (url.searchParams.get('format') === 'json') {
    return json({
      audit_id: id,
      status: audit.status,
      // An empty array is a real answer: a static-only audit of a server with
      // no tools has nothing to replay. It is not an error and must not 404.
      runs: rows.map((r) => ({
        probe_id: r.probe_id,
        run_index: r.run_index,
        score: r.score,
        turns: r.jsonl.split('\n').filter(Boolean).map(parseTurn),
      })),
    });
  }

  const body = rows.map((r) => r.jsonl).filter(Boolean).join('\n');
  return new Response(body ? body + '\n' : '', {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'access-control-allow-origin': '*',
      'x-audit-id': id,
      'x-transcript-runs': String(rows.length),
    },
  });
}

/**
 * A turn that will not parse is surfaced as-is rather than dropped.
 *
 * Distinct from `safeParse` below, which returns null on failure. Null is the
 * right answer for a cached grade_json blob and the wrong one for evidence:
 * silently dropping a malformed turn shortens the tape, and a shortened tape
 * that still looks complete is the failure mode this whole file exists to
 * avoid.
 */
function parseTurn(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return { unparsed: line };
  }
}

export async function handleGetLatest(url: URL, env: Env): Promise<Response> {
  const server = url.searchParams.get('server');
  if (!server) return err('missing ?server=<url>');

  const row = await env.DB.prepare(
    'SELECT id, server_url, server_name, status, grade, score, static_pct, behavioral_pct, ' +
    'guidance_pct, hard_fail, model, mcpscore_version, grade_json, report_md, recipe_md, ' +
    'evidence_sha256, anchor_tx, error, created_at, completed_at FROM audits ' +
    "WHERE server_url = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1",
  ).bind(server).first();

  if (!row) return json({ server_url: server, graded: false, reason: 'never graded' }, 404);

  const shaped = shapeAudit(row);
  return json({ ...shaped, graded: true, stale: isStale(String(row.completed_at ?? row.created_at)) });
}

export function isStale(iso: string, ttlDays = CACHE_TTL_DAYS): boolean {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return true;
  return Date.now() - then > ttlDays * 24 * 60 * 60 * 1000;
}

function shapeAudit(row: Record<string, unknown>) {
  return {
    audit_id: row.id,
    server_url: row.server_url,
    server_name: row.server_name,
    status: row.status,
    grade: row.grade,
    score: row.score,
    layers: {
      static_pct: row.static_pct,
      behavioral_pct: row.behavioral_pct,
      guidance_pct: row.guidance_pct,
    },
    hard_fail: row.hard_fail,
    model: row.model,
    mcpscore_version: row.mcpscore_version,
    evidence_sha256: row.evidence_sha256,
    anchor_tx: row.anchor_tx,
    report_md: row.report_md,
    recipe_md: row.recipe_md,
    grade_json: row.grade_json ? safeParse(String(row.grade_json)) : null,
    error: row.error,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Accept a single item or a list, per the spec's `[{name, url, needed_for}]`. */
export function normaliseRequest(
  body: unknown,
): { ok: true; value: GradeRequestItem[] } | { ok: false; error: string } {
  const raw = Array.isArray(body) ? body : [body];
  if (raw.length === 0) return { ok: false, error: 'no servers supplied' };
  if (raw.length > 20) return { ok: false, error: 'at most 20 servers per request' };

  const out: GradeRequestItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'each item must be an object' };
    const item = r as Record<string, unknown>;
    const url = item.url ?? item.server_url;
    if (typeof url !== 'string' || !url) return { ok: false, error: 'each item needs a url' };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'not a valid url: ' + url };
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      // A plaintext server is a hard fail anyway. Refuse before we queue work.
      return { ok: false, error: 'server url must be https: ' + url };
    }

    out.push({
      url,
      name: typeof item.name === 'string' ? item.name : undefined,
      needed_for: typeof item.needed_for === 'string' ? item.needed_for : undefined,
    });
  }
  return { ok: true, value: out };
}
