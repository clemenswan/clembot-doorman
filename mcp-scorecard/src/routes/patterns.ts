/**
 * The authority: pattern cards, and published reference profiles.
 *
 * Both are public reads on NEVER_PAID, for the reason invariant 22 gives about
 * the tape. A pattern card tells somebody what is wrong with their own build.
 * A finding you have to pay to read is a finding you cannot act on.
 *
 * The client NEVER depends on this being reachable. `doorman profile` ships
 * the same cards bundled and falls back to them, because the room this gets
 * demoed in may have no egress and a dashboard that renders nothing because a
 * fetch failed is worse than one that renders a snapshot and says so.
 */

import { type Env, json } from '../index.js';

export interface PatternCard {
  id: string;
  dimension: number;
  title: string;
  why: string;
  fix: string;
  effort: 'S' | 'M' | 'L';
  evidence_url: string | null;
  graded_mcps: string[];
  updated_at: string;
}

const MAX_DIMS = 7;

/**
 * Parse `?dims=2,4` into a clean list.
 *
 * Anything unparseable yields an EMPTY filter, which means "no filter", not
 * "no results". A malformed query returning zero cards would look exactly
 * like a dimension with nothing wrong in it.
 */
export function parseDims(raw: string | null): number[] {
  if (!raw) return [];
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= MAX_DIMS) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** `?ids=perm-explicit,mem-handoff`. The shape the dashboard actually uses. */
export function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,64}$/.test(s)),
  )].sort();
}

function shape(row: Record<string, unknown>): PatternCard {
  let mcps: string[] = [];
  try {
    const parsed = JSON.parse(String(row.graded_mcps ?? '[]'));
    if (Array.isArray(parsed)) mcps = parsed.map(String);
  } catch {
    // A row whose JSON will not parse yields an empty list rather than a 500.
    // The card's prose is the useful part and a broken sidecar must not take
    // the whole response down with it.
    mcps = [];
  }
  return {
    id: String(row.id),
    dimension: Number(row.dimension),
    title: String(row.title),
    why: String(row.why),
    fix: String(row.fix),
    effort: String(row.effort) as PatternCard['effort'],
    evidence_url: row.evidence_url ? String(row.evidence_url) : null,
    graded_mcps: mcps,
    updated_at: String(row.updated_at),
  };
}

export async function handlePatterns(url: URL, env: Env): Promise<Response> {
  const dims = parseDims(url.searchParams.get('dims'));
  const ids = parseIds(url.searchParams.get('ids'));

  const where: string[] = [];
  const binds: unknown[] = [];
  if (dims.length) {
    where.push(`dimension IN (${dims.map(() => '?').join(',')})`);
    binds.push(...dims);
  }
  if (ids.length) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    binds.push(...ids);
  }

  const sql = 'SELECT * FROM patterns'
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + ' ORDER BY dimension, id';

  let rows: Record<string, unknown>[] = [];
  try {
    const r = await env.DB.prepare(sql).bind(...binds).all();
    rows = (r.results ?? []) as Record<string, unknown>[];
  } catch {
    // The table is absent until 0004 runs. Same defence `feed.ts` uses for
    // the popularity table: serve an empty, labelled result rather than 500
    // on a deployment that has not migrated yet.
    return json({
      generated_at: new Date().toISOString(),
      count: 0,
      patterns: [],
      note: 'pattern table not migrated on this deployment',
    });
  }

  return json({
    generated_at: new Date().toISOString(),
    count: rows.length,
    filtered_by: { dims, ids },
    patterns: rows.map(shape),
    note: 'One card per rubric check that can fail. Free, like every other read here: '
      + 'a finding you have to pay to read is a finding you cannot act on.',
  });
}

/**
 * A published reference profile.
 *
 * v1 publishes nothing: the decision was to bundle the Clembot reference
 * inside the plugin. This answers 404 so the client path is exercised and
 * final, and publishing later is a seed rather than a release.
 */
export async function handleProfile(name: string, env: Env): Promise<Response> {
  if (!/^[a-z0-9-]{1,64}$/.test(name)) {
    return json({ error: 'bad profile name' }, 400);
  }
  let row: Record<string, unknown> | null = null;
  try {
    row = await env.DB.prepare('SELECT * FROM profiles WHERE name = ?').bind(name).first();
  } catch {
    row = null;
  }
  if (!row) {
    return json({
      error: 'not found',
      name,
      note: 'No reference profile is published. The Clembot reference ships bundled '
        + 'inside the plugin for now; publishing is a separate decision.',
    }, 404);
  }
  let body: unknown = null;
  try { body = JSON.parse(String(row.body)); } catch { return json({ error: 'unreadable profile' }, 500); }
  return json({ name, version: Number(row.version), updated_at: String(row.updated_at), profile: body });
}
