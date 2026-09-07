/**
 * Shared types. Pure data, no platform APIs — this file is imported by the
 * Worker, by the Node laptop runner, and by the tests.
 */

export type Band = 'A' | 'B' | 'C' | 'F';

export type ProbeId =
  | 'cold_open'
  | 'ambiguity'
  | 'bad_input'
  | 'chain'
  | 'injection_sniff';

/** The four scored behavioural probes. injection_sniff is a gate, not a score. */
export const BEHAVIORAL_PROBES: ProbeId[] = [
  'cold_open',
  'ambiguity',
  'bad_input',
  'chain',
];

/** One turn of one probe run. Appended to a JSONL transcript. Evidence. */
export interface TurnRecord {
  ts: string;
  role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'note';
  content: unknown;
}

/** Result of a single run of a single probe. */
export interface ProbeRun {
  run_index: number;
  score: number;              // 0-100
  signals: Record<string, number | boolean | string>;
  transcript: TurnRecord[];   // never truncated
}

/** All runs of one probe, plus whether it applied at all. */
export interface ProbeResult {
  probe_id: ProbeId;
  applicable: boolean;
  skip_reason?: string;
  runs: ProbeRun[];
  score: number | null;       // mean of runs, null when not applicable
  failure_modes: string[];    // human-readable, feeds report.md and recipe.md
  hard_fail?: string;         // set by injection_sniff, caps the grade at F
}

/** The static layer, derived from an mcpscore --json report. */
export interface StaticLayer {
  score: number;              // raw, e.g. 78
  max_score: number;          // raw denominator, e.g. 91 — VARIES per server
  pct: number;                // normalised 0-100. The only comparable number.
  mcpscore_version: string;
  server_name?: string;
  transport?: string;
  negotiated_version?: string;
  failed_rules: Array<{ rule_id: string; severity: string; message: string }>;
  hard_fail?: string;         // e.g. TLS disabled
  /**
   * Forward-compat rules for a not-yet-mandatory protocol version. UNGRADED
   * and excluded from score/max_score above: mcpscore folds these into its
   * totals for some servers and not others, which made normalised percentages
   * non-comparable. Reported because it is useful, never scored.
   */
  readiness?: { score: number; max_score: number; target_version?: string } | null;
}

/** Everything the grade math needs. */
export interface GradeInput {
  server_url: string;
  needed_for?: string;
  model: string;
  static: StaticLayer;
  probes: ProbeResult[];
  /** Cold Open re-run WITH the drafted recipe. Null when the layer was not run. */
  guidance?: { baseline_pct: number; guided_pct: number } | null;
}

export interface LayerBreakdown {
  pct: number | null;         // 0-100 within the layer, null = not measured
  weight: number;             // effective weight after renormalisation
  points: number;             // contribution to the final score
}

export interface GradeResult {
  server_url: string;
  model: string;
  score: number;              // 0-100, final
  band: Band;
  hard_fail: string | null;
  layers: {
    static: LayerBreakdown;
    behavioral: LayerBreakdown;
    guidance: LayerBreakdown;
  };
  probe_scores: Record<string, number | null>;
  worst_failure_modes: string[];
  graded_at: string;
  mcpscore_version: string;
}
