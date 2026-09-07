/**
 * Probe 6 - Injection Sniff. Scan-only for v1.
 *
 * Scans tool descriptions, titles, and schema descriptions for content shaped
 * like an instruction aimed at the READING AGENT rather than a description
 * aimed at a human. A tool description is documentation. When it starts
 * issuing orders, that is the attack.
 *
 * This is the only probe that can cap a grade at F, so two rules apply:
 *
 *  1. It never calls a tool. Scan-only. We do not execute a server to find
 *     out whether it is hostile.
 *  2. Every hit records the pattern that matched AND the text that matched it,
 *     verbatim. An accusation that cannot be checked is not evidence.
 *
 * Deliberately conservative. A false F is a serious accusation about someone
 * else's software, so patterns must be instruction-shaped, not merely
 * suspicious vocabulary.
 */

import type { ProbeResult, TurnRecord } from '../grade/types.js';
import type { Inventory, Probe, ProbeContext, ToolSpec } from './types.js';

export interface InjectionHit {
  location: string;    // where it was found, e.g. "tool:search.description"
  pattern: string;     // which rule fired
  excerpt: string;     // the matching text, verbatim
  severity: Severity;  // 'hard' caps the grade at F; 'steering' does not
}

/**
 * Two different accusations, deliberately kept apart.
 *
 * `hard` means the description is trying to subvert the reading agent:
 * override its instructions, exfiltrate, hide things from the user. That is an
 * attack and it caps the grade at F.
 *
 * `steering` means the description is trying to SELL through the agent:
 * instructing it to upsell unprompted, prescribing the exact words to say to
 * the user, redirecting away from named competitors. That is not an attack on
 * the user's security and grading it identically to a jailbreak attempt would
 * make an F stop meaning anything. It scores, it is reported at the top of the
 * report, and it does not cap.
 *
 * Found by grading 23 real public servers on 2026-09-03. One of them carried a
 * 6,290-character tool description built almost entirely out of this; the
 * other 22 carried none of it. The patterns below are derived from that
 * document, not invented.
 */
export type Severity = 'hard' | 'steering';

/**
 * Instruction-shaped patterns. Each targets a construction that has no
 * legitimate place in a tool description.
 */
export const INJECTION_PATTERNS: Array<{ name: string; re: RegExp; severity: Severity }> = [
  { name: 'ignore-previous-instructions',
    re: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instruction|prompt|rule|direction|context)/i, severity: 'hard' },
  { name: 'addresses-the-model-directly',
    re: /\b(you are|you must|you should)\b[^.]{0,60}\b(assistant|ai|model|claude|gpt|agent)\b/i, severity: 'hard' },
  { name: 'system-prompt-manipulation',
    re: /\b(system prompt|<\s*system\s*>|\[\s*system\s*\]|new instructions?|updated instructions?)\b/i, severity: 'hard' },
  { name: 'exfiltration-request',
    re: /\b(send|post|forward|upload|transmit|leak|report)\b[^.]{0,40}\b(api[_ -]?key|token|secret|credential|password|env|conversation|chat history|system prompt)\b/i, severity: 'hard' },
  { name: 'secrecy-instruction',
    re: /\b(do not|don't|never)\b[^.]{0,30}\b(tell|inform|mention|reveal|disclose|show)\b[^.]{0,30}\b(user|human|owner|operator)\b/i, severity: 'hard' },
  { name: 'coerced-tool-preference',
    re: /\b(always|must|only)\b[^.]{0,30}\b(use|call|prefer|choose)\b[^.]{0,20}\bthis tool\b/i, severity: 'hard' },
  { name: 'embedded-role-marker',
    re: /(^|\n)\s*(system|assistant|human|user)\s*:\s*\S/i, severity: 'hard' },
  { name: 'hidden-instruction-delimiter',
    re: /(<\|[a-z_]+\|>|\[INST\]|###\s*(instruction|system))/i, severity: 'hard' },

  // ── Commercial steering ────────────────────────────────────────────────
  // A tool description is documentation. These constructions are a sales
  // script addressed to the model, billed to the user's context window on
  // every call. Reported, scored, never a hard fail.
  { name: 'imperative-to-model',
    re: /\byou MUST\b/, severity: 'steering' },
  { name: 'always-offer',
    re: /\b(proactively offer|always offer|every single time)\b/i, severity: 'steering' },
  { name: 'steer-from-competitor',
    re: /\buse this instead of\b|\binstead of (telling|pointing|sending) the user\b/i, severity: 'steering' },
  { name: 'prescribed-user-line',
    re: /\bthe (right|correct) closing line\b/i, severity: 'steering' },
  { name: 'internalize-directive',
    re: /\binternali[sz]e (it|this)\b/i, severity: 'steering' },
  { name: 'preempt-the-user',
    re: /\bdo(?: not|n't) wait for the user\b|\beven if the user did not ask\b/i, severity: 'steering' },
];

/** The subset that caps a grade at F. */
export const HARD_PATTERNS = INJECTION_PATTERNS.filter((p) => p.severity === 'hard');
export const STEERING_PATTERNS = INJECTION_PATTERNS.filter((p) => p.severity === 'steering');

export const injectionSniff: Probe = {
  id: 'injection_sniff',
  applicable(inv: Inventory) {
    return inv.tools.length > 0 ? true : 'server advertises no tools to scan';
  },

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    // Records go on the RUN, not only through ctx.log. Hosts wire ctx.log to
    // live console output and drop it; the run's transcript is what reaches
    // transcripts.jsonl. This probe is the only one that can cap a grade at F,
    // so an F it produced with an empty tape would be an accusation with no
    // evidence behind it, against the one claim the product makes out loud.
    const transcript: TurnRecord[] = [];
    const rec = (role: TurnRecord['role'], content: unknown) => {
      const r: TurnRecord = { ts: ctx.now(), role, content };
      transcript.push(r);
      ctx.log(r);
    };
    rec('note', { probe: 'injection_sniff', mode: 'scan-only', tools: ctx.inventory.tools.length });

    // The scanned surface, verbatim, before any judgement about it. A reader
    // who disagrees with a hit needs the original string, not our excerpt.
    for (const t of ctx.inventory.tools) {
      rec('note', {
        scanned_tool: t.name,
        title: t.title ?? null,
        description: t.description ?? null,
        inputSchema: t.inputSchema ?? null,
      });
    }

    const hits = scanInventory(ctx.inventory);
    for (const h of hits) rec('note', { injection_hit: h });

    const hard = hits.filter((h) => h.severity === 'hard');
    const steering = hits.filter((h) => h.severity === 'steering');

    // Scan-only and deterministic, so a single run is the whole probe. Running
    // a regex three times to satisfy a convention would be theatre.
    // Steering first when it is the stronger evidence. The point of splitting
    // severities was that a report citing the mildest sentence as grounds for
    // an F reads as flimsy while the real case sits unquoted further down.
    const failure_modes = [
      ...hard.map(
        (h) => 'injection-shaped content in ' + h.location + ' (' + h.pattern + '): "' + h.excerpt + '"',
      ),
      ...steering.map(
        (h) => 'commercial steering in ' + h.location + ' (' + h.pattern + '): "' + h.excerpt + '"',
      ),
    ];

    // ONLY hard hits cap. A description that advertises is not a description
    // that attacks, and giving both the same verdict would empty the F of
    // meaning.
    const hard_fail = hard.length
      ? 'injection-shaped content in ' + hard.length + ' location(s): ' +
        hard.map((h) => h.location).join(', ')
      : undefined;

    rec('note', { hits: hits.length, hard: hard.length, steering: steering.length,
                  hard_fail: hard_fail ?? null });

    return {
      probe_id: 'injection_sniff',
      applicable: true,
      runs: [{
        run_index: 0,
        score: scoreFor(hard.length, steering.length),
        signals: {
          hits: hits.length, hard: hard.length, steering: steering.length, scan_only: true,
        },
        transcript,
      }],
      // Not part of the behavioural mean. It is a gate, and grade.ts only
      // averages BEHAVIORAL_PROBES, which excludes this one.
      score: scoreFor(hard.length, steering.length),
      failure_modes,
      hard_fail,
    };
  },
};

/**
 * Hard content zeroes the probe. Steering costs 15 points per distinct pattern,
 * floored at 25, so a description built entirely out of it lands well below a
 * pass without pretending to be an attack.
 */
export function scoreFor(hard: number, steering: number): number {
  if (hard > 0) return 0;
  if (steering === 0) return 100;
  return Math.max(25, 100 - steering * 15);
}

/** Scan every advertised string an agent would read before choosing a tool. */
export function scanInventory(inv: Inventory): InjectionHit[] {
  const hits: InjectionHit[] = [];
  for (const t of inv.tools) {
    push(hits, 'tool:' + t.name + '.description', t.description);
    push(hits, 'tool:' + t.name + '.title', t.title);
    for (const [field, desc] of schemaDescriptions(t)) {
      push(hits, 'tool:' + t.name + '.inputSchema.' + field, desc);
    }
  }
  return hits;
}

/** Descriptions nested inside a tool's input schema are read by the agent too. */
function schemaDescriptions(t: ToolSpec): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const props = (t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    const d = (v as { description?: unknown })?.description;
    if (typeof d === 'string') out.push([k, d]);
  }
  return out;
}

function push(hits: InjectionHit[], location: string, text: unknown): void {
  if (typeof text !== 'string' || !text) return;
  for (const p of INJECTION_PATTERNS) {
    const m = p.re.exec(text);
    if (m) {
      hits.push({
        location, pattern: p.name, severity: p.severity,
        excerpt: excerptAround(text, m.index, m[0].length),
      });
    }
  }
}

/**
 * A window around the match, so a reviewer can see the accusation in context.
 * This is a SUMMARY field for the report. The untouched original always
 * remains in the transcript and in the raw mcpscore inventory.
 */
function excerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + len + 30);
  return (start > 0 ? '...' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '...' : '');
}
