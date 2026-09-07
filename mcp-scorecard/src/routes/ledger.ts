/**
 * GET /api/ledger - the demo site polls this every 2s.
 *
 * Polling, not streaming: Durable Objects are off the table on the free tier
 * and a WebSocket would need one. A small, cheap, cacheable JSON response is
 * the right shape for a 2s poll.
 */

import { type Env, json } from '../index.js';

export const LEDGER_PAGE = 50;

export async function handleLedger(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? LEDGER_PAGE) || LEDGER_PAGE, 200);
  const since = url.searchParams.get('since');

  const rows = since
    ? await env.DB.prepare(
        'SELECT id, audit_id, event, detail, amount_usd, created_at FROM ledger ' +
        'WHERE created_at > ? ORDER BY created_at DESC LIMIT ?',
      ).bind(since, limit).all()
    : await env.DB.prepare(
        'SELECT id, audit_id, event, detail, amount_usd, created_at FROM ledger ' +
        'ORDER BY created_at DESC LIMIT ?',
      ).bind(limit).all();

  const totals = await env.DB.prepare(
    'SELECT ' +
    "  (SELECT COUNT(*) FROM audits WHERE status = 'complete') AS audits, " +
    '  (SELECT COALESCE(SUM(amount_usd), 0) FROM ledger) AS spent, ' +
    "  (SELECT COUNT(*) FROM audits WHERE grade = 'F') AS denied, " +
    "  (SELECT COUNT(*) FROM pending WHERE claimed_at IS NULL) AS queued",
  ).first();

  return json(
    { totals, entries: rows.results ?? [] },
    200,
    // A 2s poll does not need a cache, but it must not be cached STALE either.
    { 'cache-control': 'no-store' },
  );
}
