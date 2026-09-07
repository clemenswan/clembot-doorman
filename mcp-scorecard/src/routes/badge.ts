/**
 * GET /badge/{server}.svg
 *
 * The badge is the most portable claim this service makes, so it must never
 * imply a grade that does not exist. An ungraded server gets an explicit
 * "ungraded" badge, not a blank or a default letter.
 */

import { type Env, CORS } from '../index.js';
import { buildBadge, buildUnknownBadge } from '../outputs/badge.js';
import type { Band } from '../grade/types.js';

export async function handleBadge(serverKey: string, env: Env): Promise<Response> {
  const server = decodeURIComponent(serverKey);

  const row = await env.DB.prepare(
    "SELECT grade, score, model, hard_fail, completed_at FROM audits " +
    "WHERE (server_url = ? OR server_name = ?) AND status = 'complete' " +
    'ORDER BY created_at DESC LIMIT 1',
  ).bind(server, server).first();

  const svg = row?.grade
    ? buildBadge({
        band: String(row.grade) as Band,
        score: Number(row.score ?? 0),
        model: String(row.model ?? 'unknown'),
        graded_at: String(row.completed_at ?? new Date().toISOString()),
        hard_fail: Boolean(row.hard_fail),
      })
    : buildUnknownBadge();

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Short cache: a re-grade should show up the same day, and badges are
      // cheap. Long-lived immutable caching here would freeze a stale grade.
      'cache-control': 'public, max-age=3600',
      ...CORS,
    },
  });
}
