/**
 * The evidence bundle and its hash.
 *
 * The positioning claim is "don't trust the letter, replay the tape", which
 * only means anything if the tape is fixed. So:
 *
 *  - The bundle is built by CANONICAL serialisation (sorted keys, stable
 *    ordering). Two runs over the same evidence must produce the same hash on
 *    any machine, or the anchor proves nothing.
 *  - Transcripts go in whole. Never truncated, never edited, never sampled.
 *  - The hash covers the transcripts as well as the grade, so you cannot
 *    change what happened and keep the same grade.
 *
 * Uses WebCrypto, which exists in both Workers and Node 18+, so the Worker and
 * the laptop runner compute identical hashes.
 */

import type { GradeResult, ProbeResult } from '../grade/types.js';

export interface EvidenceBundle {
  audit_id: string;
  server_url: string;
  grade: GradeResult;
  probes: ProbeResult[];
  report_md: string;
  recipe_md: string;
}

/**
 * Deterministic JSON. JSON.stringify does NOT guarantee key order across
 * object construction paths, so we sort every key. Without this the hash is
 * reproducible only by accident.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortDeep(src[k]);
    return out;
  }
  return v;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash of the whole bundle. This is the number that gets anchored. */
export async function hashBundle(bundle: EvidenceBundle): Promise<string> {
  return sha256Hex(canonicalJson(bundle));
}

/**
 * Transcripts as JSONL, one record per line, in probe then run then turn
 * order. This is the "tape" a sceptic replays.
 */
export function transcriptsToJsonl(probes: ProbeResult[]): string {
  const lines: string[] = [];
  for (const p of probes) {
    for (const run of p.runs) {
      for (const turn of run.transcript) {
        lines.push(JSON.stringify({
          probe_id: p.probe_id,
          run_index: run.run_index,
          ...turn,
        }));
      }
    }
  }
  return lines.join('\n');
}

/**
 * Anchor stub.
 *
 * Real Hedera Consensus Service submission is a later step and needs
 * credentials that do not exist yet. This logs the hash and returns a clearly
 * marked non-transaction so nothing downstream can mistake it for a real
 * anchor. It must never return something that looks like a Hedera tx id.
 */
export interface AnchorResult {
  anchored: boolean;
  tx: string | null;
  network: string;
  note: string;
}

export async function anchor(
  hash: string,
  opts: { network?: string; log?: (m: string) => void } = {},
): Promise<AnchorResult> {
  const network = opts.network ?? 'hedera-testnet';
  const log = opts.log ?? ((m: string) => console.log(m));
  log('[anchor:STUB] would submit ' + hash + ' to ' + network);
  return {
    anchored: false,
    tx: null,
    network,
    note: 'STUB - no credentials configured, nothing was submitted on-chain',
  };
}
