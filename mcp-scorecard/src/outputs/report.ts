/**
 * report.md - the one-page human artifact.
 *
 * "One page" is enforced, not aspirational. A report that quietly grows to
 * three pages is the same failure as a grade that quietly stops meaning
 * anything, so buildReport TRUNCATES its own optional sections until it fits
 * and says so in the output when it had to.
 *
 * The provenance section is deliberately ungraded: it records how the audit
 * was produced so a reader can decide whether to believe it.
 */

import { BEHAVIORAL_PROBES } from '../grade/types.js';
import type { GradeResult } from '../grade/types.js';
import type { ProbeResult } from '../grade/types.js';
import type { GuidanceMeasurement } from '../probes/guidance.js';

/** A page. 60 lines of body at a readable width, plus slack for the header. */
export const MAX_REPORT_LINES = 64;
export const MAX_LINE_WIDTH = 96;

export interface ReportInput {
  grade: GradeResult;
  probes: ProbeResult[];
  server_name?: string;
  evidence_sha256?: string;
  anchor_tx?: string | null;
  audit_id: string;
  /**
   * Why the guidance layer reads as it does. Optional, and the report is
   * correct without it — but "_not measured_" with no reason is the kind of
   * blank a reader fills in with a guess.
   */
  guidance?: GuidanceMeasurement;
}

export function buildReport(input: ReportInput): string {
  const { grade: g } = input;
  const head = header(input);
  const scores = scoreTable(input);
  const prov = provenance(input);

  // Failure modes are the section that flexes. Everything else is fixed cost.
  for (let budget = 3; budget >= 0; budget--) {
    const body = [
      ...head,
      '',
      ...scores,
      '',
      ...failureSection(g, budget),
      '',
      ...prov,
    ];
    if (body.length <= MAX_REPORT_LINES) {
      return body.join('\n') + '\n';
    }
  }

  // Cannot happen with the fixed sections as written, but if the header ever
  // grows past a page on its own, say so rather than emit a silent lie.
  const forced = [...head, '', ...scores, '', ...prov, '', '> Report truncated to fit one page.'];
  return forced.slice(0, MAX_REPORT_LINES).join('\n') + '\n';
}

function header(i: ReportInput): string[] {
  const g = i.grade;
  const name = i.server_name ?? hostOf(g.server_url);
  return [
    '# ' + name + ' - Grade ' + g.band + ' (' + g.score + '/100)',
    '',
    '`' + g.server_url + '`',
    '',
    g.hard_fail
      ? '> **HARD FAIL: ' + wrap(g.hard_fail) + '** Capped at F regardless of other scores.'
      : '> Graded by being used, not by being read.',
  ];
}

function scoreTable(i: ReportInput): string[] {
  const L = i.grade.layers;
  const rows: string[] = [
    '## Score',
    '',
    '| Layer | Result | Weight | Points |',
    '|---|---|---|---|',
    row('Static (mcpscore)', L.static),
    row('Behavioral (probes)', L.behavioral),
    row('Guidance delta', L.guidance, guidanceNote(i.guidance)),
    '| **Final** | | | **' + i.grade.score + '/100** |',
    '',
    '| Probe | Score |',
    '|---|---|',
  ];
  const entries = Object.entries(i.grade.probe_scores);
  if (entries.length === 0) {
    rows.push('| _none run_ | - |');
  }
  for (const [id, score] of entries) {
    const skip = i.probes.find((p) => p.probe_id === id)?.skip_reason;
    rows.push(
      '| ' + id + ' | ' +
      (score === null ? '_skipped: ' + (skip ?? 'not applicable') + '_' : score) + ' |',
    );
  }
  return rows;
}

function row(
  label: string,
  l: { pct: number | null; weight: number; points: number },
  note?: string,
): string {
  const suffix = note ? ' - ' + note : '';
  if (l.pct === null) {
    return '| ' + label + ' | _not measured' + (note ? ': ' + note : '') + '_ | 0% | 0 |';
  }
  return '| ' + label + ' | ' + l.pct + '%' + suffix + ' | ' + l.weight + '% | ' + l.points + ' |';
}

/**
 * One cell, never a new line: the report has a hard page budget and a fact
 * worth reading is worth fitting.
 *
 * A regression is called out explicitly because `guidancePct` floors at zero,
 * so "the recipe made it worse" and "the recipe changed nothing" both render
 * as 0% and are very different findings.
 */
function guidanceNote(m?: GuidanceMeasurement): string | undefined {
  if (!m) return undefined;
  if (!m.measured) return m.skip_reason;
  // The runs, whenever they disagreed. A mean of 78 built from 67/100/67 is a
  // recipe that works one time in three, and it reads identically to a steady
  // 78 without this. Silent on a unanimous result, so the common case stays
  // one line.
  const spread = m.unanimous === false && m.guided_runs?.length
    ? ' [runs ' + m.guided_runs.join('/') + ', NOT unanimous]'
    : '';
  if (m.regression) {
    return '**the recipe made it WORSE** (' + m.baseline_pct + ' -> ' + m.guided_pct + ')' + spread;
  }
  return 'cold ' + m.baseline_pct + ' -> guided ' + m.guided_pct +
    ' on ' + m.rules_given + ' rule(s)' + spread;
}

function failureSection(g: GradeResult, budget: number): string[] {
  if (budget === 0 || g.worst_failure_modes.length === 0) {
    return g.worst_failure_modes.length
      ? ['## Worst failure modes', '', '_Omitted to fit one page. See grade.json._']
      : ['## Worst failure modes', '', 'None recorded.'];
  }
  const out = ['## Worst failure modes', ''];
  g.worst_failure_modes.slice(0, budget).forEach((m, n) => {
    out.push(n + 1 + '. ' + wrap(m));
  });
  return out;
}

/**
 * Ungraded on purpose. These facts do not make a server better or worse; they
 * tell you what this grade is worth. The model line matters most: the grade is
 * model-relative and comparing across models is meaningless.
 */
function provenance(i: ReportInput): string[] {
  const g = i.grade;
  // Describe what ACTUALLY ran. Claiming "3 runs per probe" on a static-only
  // audit would be a false provenance claim on an evidence document, which is
  // the one kind of error this product cannot afford.
  //
  // The model line is split off from the probe count for the same reason.
  // injection_sniff is scan-only and runs without a key, so an audit can have
  // run a probe and used no model at all. Naming the model on that audit would
  // read as "a model produced this", which would be false.
  const ran = i.probes.filter((p) => p.applicable && p.runs.length > 0);
  const modelRan = ran.filter((p) => BEHAVIORAL_PROBES.includes(p.probe_id));
  const scanRan = ran.filter((p) => !BEHAVIORAL_PROBES.includes(p.probe_id));
  const runCounts = [...new Set(modelRan.map((p) => p.runs.length))];

  const lines: string[] = [];
  if (modelRan.length === 0) {
    lines.push('no behavioural probes were run (static layer only)');
  } else {
    lines.push(
      modelRan.length +
        ' behavioural probe(s), ' +
        (runCounts.length === 1 ? runCounts[0] + ' run(s) each' : 'varying runs') +
        ', model `' + g.model + '` at temperature 0',
    );
  }
  if (scanRan.length > 0) {
    lines.push(
      scanRan.map((p) => '`' + p.probe_id + '`').join(', ') +
        ' ran scan-only: no model, no tool call',
    );
  }
  // Say that the second pass happened, and that it is not in the layer above
  // it. A reader who assumes a guided cold_open was averaged into the
  // behavioural score would read the whole table wrong.
  if (i.guidance?.measured) {
    lines.push(
      'guidance: `cold_open` re-run with ' + i.guidance.rules_given +
        ' recipe rule(s); scored separately, excluded from the behavioural mean',
    );
  }

  const out = [
    '## Provenance (ungraded)',
    '',
    '- Audit `' + i.audit_id + '` at ' + g.graded_at,
    ...lines.map((l) => '- ' + l),
    '- mcpscore `' + g.mcpscore_version + '`',
  ];
  if (i.evidence_sha256) out.push('- Evidence SHA-256 `' + i.evidence_sha256 + '`');
  out.push(
    i.anchor_tx
      ? '- Anchored `' + i.anchor_tx + '`'
      : '- Not yet anchored on-chain',
  );
  out.push('');
  out.push('_A grade is relative to the model that produced it. Replay the tape._');
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Keep a single fact on a single line so the line count stays honest. */
function wrap(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LINE_WIDTH ? flat.slice(0, MAX_LINE_WIDTH - 3) + '...' : flat;
}
