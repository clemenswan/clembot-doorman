/**
 * The runner seam.
 *
 * A probe runner on a laptop claims queued work here and posts results back.
 * This is the boundary that makes the whole thing work on the free tier
 * without Durable Objects: the Worker holds state, the runner holds capability.
 *
 * Both endpoints are authenticated with a shared RUNNER_TOKEN. Without it,
 * anyone could post a grade for any server, which would make every published
 * grade worthless.
 */

import { type Env, err, json } from '../index.js';

/** A claim older than this is assumed dead and the row is offered again. */
export const CLAIM_TIMEOUT_MINUTES = 15;
export const MAX_ATTEMPTS = 3;

function authed(req: Request, env: Env): boolean {
  // Absent token means the deployment has not been configured. Fail closed:
  // an unconfigured deployment accepts nothing rather than everything.
  if (!env.RUNNER_TOKEN) return false;
  const header = req.headers.get('authorization') ?? '';
  const presented = header.replace(/^Bearer\s+/i, '');
  return timingSafeEqual(presented, env.RUNNER_TOKEN);
}

/** Constant-time compare so the token cannot be guessed a character at a time. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** GET /api/pending - claim up to `limit` queued audits. */
export async function handlePending(req: Request, url: URL, env: Env): Promise<Response> {
  if (!authed(req, env)) return err('unauthorized', 401);

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '1') || 1, 5);
  const runnerId = (url.searchParams.get('runner') ?? 'unknown').slice(0, 80);
  const now = new Date();
  const cutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MINUTES * 60_000).toISOString();

  // Unclaimed, or claimed so long ago the runner is presumed gone.
  const rows = await env.DB.prepare(
    'SELECT id, server_url, needed_for, attempts, paid_allowed FROM pending ' +
    'WHERE (claimed_at IS NULL OR claimed_at < ?) AND attempts < ? ' +
    'ORDER BY created_at LIMIT ?',
  ).bind(cutoff, MAX_ATTEMPTS, limit).all();

  const claimed: unknown[] = [];
  for (const row of rows.results ?? []) {
    const id = String((row as Record<string, unknown>).id);
    // Re-check the claim inside the UPDATE so two runners racing cannot both
    // win the same row. D1 has no SELECT FOR UPDATE, so the WHERE clause is
    // the lock.
    const res = await env.DB.prepare(
      'UPDATE pending SET claimed_at = ?, claimed_by = ?, attempts = attempts + 1 ' +
      'WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)',
    ).bind(now.toISOString(), runnerId, id, cutoff).run();

    if (res.meta.changes === 1) {
      await env.DB.prepare("UPDATE audits SET status = 'running' WHERE id = ?").bind(id).run();
      await logLedger(env, id, 'claimed', runnerId);
      claimed.push({
        audit_id: id,
        server_url: (row as Record<string, unknown>).server_url,
        needed_for: (row as Record<string, unknown>).needed_for,
        model: env.PROBE_MODEL,
        temperature: Number(env.PROBE_TEMPERATURE ?? '0'),
        runs: Number(env.PROBE_RUNS ?? '3'),
        // The inbound spend permit. 0 means this audit was queued without a
        // credential, so the runner must not spend a model token on it. The
        // runner enforces it; this is the field it enforces from.
        paid_allowed: Number((row as Record<string, unknown>).paid_allowed ?? 0),
      });
    }
  }

  return json({ claimed: claimed.length, work: claimed });
}

export interface ResultPayload {
  audit_id: string;
  status: 'complete' | 'failed';
  error?: string;
  grade?: {
    band: string;
    score: number;
    hard_fail?: string | null;
    layers?: { static?: { pct: number | null }; behavioral?: { pct: number | null }; guidance?: { pct: number | null } };
    mcpscore_version?: string;
  };
  grade_json?: unknown;
  report_md?: string;
  recipe_md?: string;
  evidence_sha256?: string;
  server_name?: string;
  transcripts?: Array<{ probe_id: string; run_index: number; score?: number; jsonl: string }>;
}

/** POST /api/result - a runner posts a finished audit back. */
export async function handleResult(req: Request, env: Env): Promise<Response> {
  if (!authed(req, env)) return err('unauthorized', 401);

  let p: ResultPayload;
  try {
    p = (await req.json()) as ResultPayload;
  } catch {
    return err('body must be JSON');
  }
  if (!p.audit_id) return err('missing audit_id');

  const exists = await env.DB.prepare('SELECT id FROM audits WHERE id = ?')
    .bind(p.audit_id).first();
  if (!exists) return err('no such audit: ' + p.audit_id, 404);

  const now = new Date().toISOString();

  if (p.status === 'failed') {
    await env.DB.prepare(
      "UPDATE audits SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
    ).bind(p.error ?? 'unknown error', now, p.audit_id).run();
    await env.DB.prepare('DELETE FROM pending WHERE id = ?').bind(p.audit_id).run();
    await logLedger(env, p.audit_id, 'error', p.error ?? 'unknown error');
    return json({ ok: true, status: 'failed' });
  }

  const g = p.grade;
  if (!g || typeof g.score !== 'number' || !g.band) {
    return err('a complete result needs grade.score and grade.band');
  }

  await env.DB.prepare(
    "UPDATE audits SET status = 'complete', grade = ?, score = ?, static_pct = ?, " +
    'behavioral_pct = ?, guidance_pct = ?, hard_fail = ?, server_name = COALESCE(?, server_name), ' +
    'mcpscore_version = ?, grade_json = ?, report_md = ?, recipe_md = ?, evidence_sha256 = ?, ' +
    'completed_at = ? WHERE id = ?',
  ).bind(
    g.band,
    g.score,
    g.layers?.static?.pct ?? null,
    g.layers?.behavioral?.pct ?? null,
    g.layers?.guidance?.pct ?? null,
    g.hard_fail ?? null,
    p.server_name ?? null,
    g.mcpscore_version ?? null,
    p.grade_json ? JSON.stringify(p.grade_json) : null,
    p.report_md ?? null,
    p.recipe_md ?? null,
    p.evidence_sha256 ?? null,
    now,
    p.audit_id,
  ).run();

  // Transcripts are evidence. Stored verbatim, one row per probe run.
  for (const t of p.transcripts ?? []) {
    await env.DB.prepare(
      'INSERT INTO transcripts (id, audit_id, probe_id, run_index, score, jsonl, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(), p.audit_id, t.probe_id, t.run_index, t.score ?? null, t.jsonl, now,
    ).run();
  }

  await env.DB.prepare('DELETE FROM pending WHERE id = ?').bind(p.audit_id).run();
  await logLedger(env, p.audit_id, 'graded', g.band + ' ' + g.score);

  return json({ ok: true, status: 'complete', audit_id: p.audit_id, grade: g.band });
}

export async function logLedger(
  env: Env, auditId: string | null, event: string, detail: string, amountUsd?: number,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO ledger (id, audit_id, event, detail, amount_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    crypto.randomUUID(), auditId, event, detail.slice(0, 500), amountUsd ?? null,
    new Date().toISOString(),
  ).run();
}
