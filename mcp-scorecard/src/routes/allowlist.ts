/**
 * GET /allowlist/{owner} - the published trust list.
 *
 * This is a READ surface only. The doorman hook never calls it: the hook reads
 * a local JSON file, because a security gate that depends on the network fails
 * open the moment the network does. This endpoint is what the human syncs FROM.
 */

import { type Env, json } from '../index.js';

export async function handleAllowlist(owner: string, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    'SELECT a.server_url, a.decision, a.grade, a.audit_id, a.note, a.updated_at, ' +
    '       au.score, au.model, au.evidence_sha256 ' +
    'FROM allowlist a LEFT JOIN audits au ON au.id = a.audit_id ' +
    'WHERE a.owner = ? ORDER BY a.server_url',
  ).bind(owner).all();

  const entries = (rows.results ?? []) as Array<Record<string, unknown>>;

  return json({
    owner,
    generated_at: new Date().toISOString(),
    count: entries.length,
    allow: entries.filter((e) => e.decision === 'allow').map(shape),
    deny: entries.filter((e) => e.decision === 'deny').map(shape),
    note:
      'Snapshot for syncing into a local registry file. The doorman hook reads ' +
      'the local file, never this endpoint: an offline gate must fail closed.',
  });
}

function shape(e: Record<string, unknown>) {
  return {
    server_url: e.server_url,
    grade: e.grade,
    score: e.score,
    model: e.model,
    audit_id: e.audit_id,
    evidence_sha256: e.evidence_sha256,
    note: e.note,
    updated_at: e.updated_at,
  };
}
