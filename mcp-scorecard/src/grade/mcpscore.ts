/**
 * Adapter for `mcpscore --json` output (schema_version 1, mcpscore 1.11.x).
 *
 * Everything that knows the shape of mcpscore's report lives here. If mcpscore
 * changes its schema, this file is the only thing that breaks.
 *
 * Verified against mcpscore 1.11.0 on 2026-09-01 (https://mcp.deepwiki.com/mcp
 * returned score 78 / max_score 91, schema_version 1).
 */

import type { StaticLayer } from './types.js';
import { staticPct } from './grade.js';

/** The subset of the mcpscore report we depend on. */
export interface McpscoreReport {
  schema_version: number;
  mcpscore_version: string;
  generated_at: string;
  target: string;
  transport?: string;
  score: number;
  max_score: number;
  authenticated?: boolean;
  partial?: boolean;
  partial_reason?: string | null;
  server_info?: { name?: string; version?: string } | null;
  summary?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    by_severity?: Record<string, { total: number; passed: number; failed: number }>;
  };
  results?: Array<{
    rule_id: string;
    rule_name?: string;
    severity: string;
    severity_value?: number;
    passed: boolean;
    message: string;
    details?: unknown;
  }>;
  spec?: {
    negotiated_version?: string;
    latest_version?: string;
    era?: string;
  };
  /**
   * Forward-compatibility rules for a protocol version that is not yet
   * mandatory. Its own score, its own denominator, and `counted_in_main`
   * decides whether mcpscore folded it into the top-level totals.
   *
   * That flag VARIES PER SERVER, which is the whole problem. See
   * splitReadiness.
   */
  readiness?: {
    score?: number;
    max_score?: number;
    counted_in_main?: boolean;
    target_version?: string;
    results?: Array<{ rule_id: string; severity: string; passed: boolean; message: string }>;
  } | null;
}

export const SUPPORTED_SCHEMA_VERSION = 1;

/** Rules whose failure is a hard fail, capping the whole grade at F. */
export const HARD_FAIL_RULES: Record<string, string> = {
  security_tls_enabled: 'transport is not TLS-encrypted',
};

export class McpscoreSchemaError extends Error {}

/**
 * Separate the readiness block out of the top-level totals.
 *
 * This is the second, sharper form of the moving-denominator problem found in
 * session 1. Normalising `score / max_score` into a percentage does NOT make
 * two servers comparable, because the COMPOSITION of that fraction also moves:
 * mcpscore folds its forward-compatibility "readiness" rules into the main
 * totals for some servers and not others, via `readiness.counted_in_main`.
 *
 * Measured 2026-09-02 against mcpscore 1.11.0:
 *
 *   deepwiki      78/91   readiness  3/13  counted:false  ->  85.71% either way
 *   planted-bad   81/116  readiness 14/43  counted:TRUE   ->  69.83% vs 91.78%
 *   scorecard     86/116  readiness 14/43  counted:TRUE   ->  74.14% vs 98.63%
 *
 * So the deliberately hostile fixture looked WORSE than DeepWiki on the static
 * layer (69.83 vs 85.71) while actually scoring better on the rules both were
 * measured against (91.78 vs 85.71). The comparison the demo puts on screen
 * was inverted by an artifact of which rule blocks mcpscore happened to count.
 *
 * We exclude readiness from the grade and report it as information. Readiness
 * measures conformance to a spec version that is not required yet: a server is
 * not defective today for failing it, and penalising only the servers whose
 * reports happen to include it is not a comparison at all.
 */
export function splitReadiness(report: McpscoreReport): {
  score: number;
  max_score: number;
  readiness: { score: number; max_score: number; target_version?: string } | null;
} {
  const rd = report.readiness;
  const counted = Boolean(rd?.counted_in_main);
  const rdScore = typeof rd?.score === 'number' ? rd.score : 0;
  const rdMax = typeof rd?.max_score === 'number' ? rd.max_score : 0;

  const readiness = rd && rdMax > 0
    ? { score: rdScore, max_score: rdMax, target_version: rd.target_version }
    : null;

  // Only subtract what was actually added. When counted_in_main is false the
  // top-level totals never included it, and subtracting would understate the
  // server.
  if (!counted || rdMax <= 0) {
    return { score: report.score, max_score: report.max_score, readiness };
  }
  return {
    score: report.score - rdScore,
    max_score: report.max_score - rdMax,
    readiness,
  };
}

/**
 * Convert a raw mcpscore report into the normalised static layer.
 *
 * Throws on an unexpected schema_version rather than silently mis-scoring.
 * A wrong grade that looks confident is worse than a failed audit.
 */
export function toStaticLayer(report: McpscoreReport): StaticLayer {
  if (report.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new McpscoreSchemaError(
      `unsupported mcpscore schema_version ${report.schema_version} ` +
        `(expected ${SUPPORTED_SCHEMA_VERSION}); refusing to grade`,
    );
  }
  if (typeof report.score !== 'number' || typeof report.max_score !== 'number') {
    throw new McpscoreSchemaError('mcpscore report missing score/max_score');
  }

  const failed = (report.results ?? []).filter((r) => !r.passed);

  let hard_fail: string | undefined;
  for (const r of failed) {
    const reason = HARD_FAIL_RULES[r.rule_id];
    if (reason) hard_fail = reason;
  }

  const split = splitReadiness(report);
  if (split.max_score <= 0) {
    throw new McpscoreSchemaError(
      'mcpscore report has no main rules left after removing the readiness ' +
      'block; refusing to grade rather than divide by zero',
    );
  }

  const layer: StaticLayer = {
    score: split.score,
    max_score: split.max_score,
    pct: 0,
    readiness: split.readiness,
    mcpscore_version: report.mcpscore_version,
    server_name: report.server_info?.name,
    transport: report.transport,
    negotiated_version: report.spec?.negotiated_version,
    failed_rules: failed.map((r) => ({
      rule_id: r.rule_id,
      severity: r.severity,
      message: stripGlyphs(r.message),
    })),
    hard_fail,
  };
  layer.pct = staticPct(layer);
  return layer;
}

/**
 * mcpscore prefixes messages with status emoji. They render badly in a
 * one-page report and add nothing, so strip leading non-text glyphs.
 */
function stripGlyphs(msg: string): string {
  return msg.replace(/^[\p{Extended_Pictographic}️✅❌⏭\s]+/u, '').trim();
}

/**
 * Exit codes from the mcpscore CLI. The runner needs to tell "server is bad"
 * apart from "we never reached the server", because only the second one means
 * the audit itself failed.
 */
export const MCPSCORE_EXIT = {
  OK: 0,
  AUDIT_DID_NOT_RUN: 1,
  COULD_NOT_CONNECT: 2,
  BELOW_THRESHOLD: 3,
} as const;

export function describeExit(code: number): string {
  switch (code) {
    case MCPSCORE_EXIT.OK:
      return 'audit completed';
    case MCPSCORE_EXIT.AUDIT_DID_NOT_RUN:
      return 'audit never ran';
    case MCPSCORE_EXIT.COULD_NOT_CONNECT:
      return 'could not connect to server';
    case MCPSCORE_EXIT.BELOW_THRESHOLD:
      return 'audit completed, below --fail-under threshold';
    default:
      return `unknown mcpscore exit code ${code}`;
  }
}
