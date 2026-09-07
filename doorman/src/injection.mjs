/**
 * VENDORED from mcp-scorecard/src/probes/injection_sniff.ts.
 *
 * ── Why a copy and not an import ─────────────────────────────────────────────
 *
 * This repo is the giveaway. When it is extracted to its own public repo the
 * scorecard's source is not there, and the scorecard's build artifact
 * (`runner/lib.mjs`) is gitignored, so neither an import nor a bundled copy
 * survives extraction. A vendored copy does.
 *
 * The cost of a copy is drift, and drift here is silent: a pattern tightened in
 * the scorecard would keep passing here while quietly grading skills by an
 * older rule than MCP servers. So `test/injection.test.mjs` parses the TypeScript
 * source and fails when the two diverge. That test skips itself once the source
 * is gone, which is the only moment a copy is legitimately on its own.
 *
 * If you change a pattern, change it THERE first. This file follows.
 *
 * ── What this covers, and what it does not ───────────────────────────────────
 *
 * The scorecard scans a tool SURFACE: descriptions, titles, schema field
 * descriptions. That code stays there, because only the scorecard has an
 * inventory to scan.
 *
 * This scans PROSE: a SKILL.md, a README, a gist. Same patterns, different
 * input. A skill has no tools to probe, so this is the entire security signal
 * available for a skill or repo candidate, and the report must say so rather
 * than implying a behavioural grade happened.
 */

/** Verbatim from the source. Order is preserved so hit order matches. */
export const INJECTION_PATTERNS = [
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

/**
 * A window around the match, so a reviewer can check the accusation.
 *
 * Verbatim from the source. This is a SUMMARY field. The untouched original
 * text always remains available to the caller.
 */
export function excerptAround(text, index, len) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + len + 30);
  return (start > 0 ? '...' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '...' : '');
}

/**
 * Scan one block of prose.
 *
 * Returns every pattern that fired, each with the text that fired it, verbatim.
 * An accusation that cannot be checked is not evidence.
 *
 * Deliberately conservative, for the same reason the source is: a false hit is
 * a public claim about somebody else's work.
 */
export function scanText(text, location = 'instructions') {
  const hits = [];
  if (typeof text !== 'string' || !text) return hits;
  for (const p of INJECTION_PATTERNS) {
    const m = p.re.exec(text);
    if (m) {
      hits.push({
        location,
        pattern: p.name,
        severity: p.severity,
        excerpt: excerptAround(text, m.index, m[0].length),
      });
    }
  }
  return hits;
}

/**
 * The same shape the scorecard's probe returns, so a note renderer does not
 * need to care which path produced it.
 *
 * `hard_fail` is set for exactly the same reason it is there: injection-shaped
 * content is disqualifying on its own, whatever else is true.
 */
export function sniffInstructions(text, location = 'instructions') {
  const hits = scanText(text, location);
  const hard = hits.filter((h) => h.severity === 'hard');
  const steering = hits.filter((h) => h.severity === 'steering');
  return {
    scanned_chars: typeof text === 'string' ? text.length : 0,
    hits,
    hard: hard.length,
    steering: steering.length,
    // Same severity rule as the source: only an ATTACK caps a grade. A
    // description that advertises through the agent is reported and scored,
    // never treated as a jailbreak attempt.
    score: hard.length ? 0 : (steering.length ? Math.max(25, 100 - steering.length * 15) : 100),
    failure_modes: [
      ...hard.map(
        (h) => 'injection-shaped content in ' + h.location + ' (' + h.pattern + '): "' + h.excerpt + '"',
      ),
      ...steering.map(
        (h) => 'commercial steering in ' + h.location + ' (' + h.pattern + '): "' + h.excerpt + '"',
      ),
    ],
    hard_fail: hard.length
      ? 'injection-shaped content in ' + hard.length + ' location(s): ' +
        [...new Set(hard.map((h) => h.location))].join(', ')
      : undefined,
  };
}
