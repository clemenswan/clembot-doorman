/**
 * Fit review: does MY system need this at all?
 *
 * The scorecard answers "is this trustworthy", which is external, paid, and
 * about the candidate. This answers "do I already have it", which is internal,
 * free, and about you. It runs FIRST, so a redundant candidate never costs a
 * cent.
 *
 * One model call, temperature 0, pinned model, strict JSON out.
 *
 * The validation below matters more than the prompt. A fit review that names a
 * subagent you do not have, or an overlap that does not exist, is worse than no
 * review at all: it reads as placement advice and it is fiction. So every name
 * the model returns is checked against the inventory it was given, and a name
 * that is not there is a rejected response, not a warning.
 */

export const FIT_VERDICTS = ['redundant', 'fits', 'needs-new-subagent', 'out-of-scope'];
export const OVERLAP_KINDS = ['agent', 'skill', 'mcp-server', 'command'];

/** Two sentences. A rationale that runs long stops being read. */
export const MAX_RATIONALE_CHARS = 400;

export class FitReviewError extends Error {
  constructor(message, { attempts, lastResponse } = {}) {
    super(message);
    this.name = 'FitReviewError';
    this.attempts = attempts;
    this.lastResponse = lastResponse;
  }
}

const SYSTEM = `You decide whether an agent system NEEDS a candidate capability.
You are not judging whether the candidate is good, safe, or well built. A
separate paid audit does that, and it only runs if you say the capability is
needed. Your job is the cheap question that comes first: does this system
already have this?

Answer with a single JSON object and nothing else. No prose, no code fence.

{
  "verdict": "redundant" | "fits" | "needs-new-subagent" | "out-of-scope",
  "owner": "<subagent name>" | null,
  "rationale": "<at most two sentences>",
  "overlaps": [ { "kind": "agent"|"skill"|"mcp-server"|"command",
                  "name": "<exact name from the inventory>",
                  "why": "<one clause: what it already covers>" } ]
}

Verdicts:
- "redundant": an existing subagent, skill or configured server already covers
  this need. Populate overlaps.
- "fits": genuinely new capability, and one EXISTING subagent should own it.
  Set owner to that subagent's exact name.
- "needs-new-subagent": genuinely new capability, but no existing subagent is
  the right home. owner must be null.
- "out-of-scope": the system has no business doing this at all. owner null.

Rules you must not break:
- Every "name" in overlaps MUST appear verbatim in the inventory below. Never
  invent one, and never guess at a plausible-sounding name.
- "owner" MUST be an exact subagent name from the inventory, and MUST be null
  unless the verdict is "fits".
- Prefer "redundant" when coverage is genuine. Declining to spend money is the
  point of this step, not a failure of it.
- If the inventory says a section is UNKNOWN rather than empty, say so in the
  rationale instead of assuming the system has nothing.`;

function buildUserPrompt(candidate, inventoryBlock) {
  return [
    '# CANDIDATE',
    `url or path: ${candidate.id}`,
    `type: ${candidate.type}`,
    `wanted for: ${candidate.needed_for || '(not stated)'}`,
    candidate.description ? `self-described as: ${candidate.description}` : '',
    '',
    '# THE SYSTEM AS IT EXISTS TODAY',
    inventoryBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Pull the JSON object out of a response.
 *
 * Strict, with exactly one concession: a ```json fence, because models emit
 * them constantly and rejecting that would burn a retry on a formatting habit
 * rather than on a wrong answer. Anything else is malformed.
 */
export function extractJson(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty response' };

  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'response parsed but is not a JSON object' };
    }
    return { ok: true, value: parsed };
  } catch (e) {
    return { ok: false, error: 'not valid JSON: ' + e.message };
  }
}

/**
 * Check a parsed response against the inventory it was given.
 *
 * Returns a list of problems. Empty means usable. Every message is written to
 * be handed straight back to the model on the retry, so they say what was
 * wrong and what to do instead.
 */
export function validateVerdict(v, inventory) {
  const problems = [];
  const agentNames = new Set(inventory.agents.map((a) => a.name));
  const known = new Map();
  for (const a of inventory.agents) known.set(`agent:${a.name}`, true);
  for (const s of inventory.skills) known.set(`skill:${s.name}`, true);
  for (const m of inventory.mcpServers) known.set(`mcp-server:${m.name}`, true);
  for (const a of inventory.allowlisted) known.set(`mcp-server:${a.key}`, true);

  if (!FIT_VERDICTS.includes(v.verdict)) {
    problems.push(
      `"verdict" was ${JSON.stringify(v.verdict)}; it must be exactly one of ` +
      FIT_VERDICTS.map((x) => `"${x}"`).join(', ') + '.',
    );
  }

  const ownerGiven = v.owner !== null && v.owner !== undefined && v.owner !== '';
  if (v.verdict === 'fits') {
    if (!ownerGiven) {
      problems.push('"verdict" is "fits" but "owner" is null. A fit with no owner is not a placement.');
    } else if (!agentNames.has(v.owner)) {
      // The single most important check here. An invented subagent reads as
      // advice and is fiction.
      problems.push(
        `"owner" was ${JSON.stringify(v.owner)}, which is not a subagent in the ` +
        'inventory. Use an exact name from the SUBAGENTS section, or change the ' +
        'verdict to "needs-new-subagent".',
      );
    }
  } else if (ownerGiven) {
    problems.push(
      `"owner" must be null when the verdict is ${JSON.stringify(v.verdict)}; got ${JSON.stringify(v.owner)}.`,
    );
  }

  if (typeof v.rationale !== 'string' || v.rationale.trim() === '') {
    problems.push('"rationale" must be a non-empty string.');
  } else if (v.rationale.length > MAX_RATIONALE_CHARS) {
    problems.push(`"rationale" is ${v.rationale.length} chars; keep it under ${MAX_RATIONALE_CHARS}.`);
  }

  if (!Array.isArray(v.overlaps)) {
    problems.push('"overlaps" must be an array, empty if there are none.');
  } else {
    v.overlaps.forEach((o, i) => {
      if (!o || typeof o !== 'object') {
        problems.push(`overlaps[${i}] must be an object with kind, name and why.`);
        return;
      }
      if (!OVERLAP_KINDS.includes(o.kind)) {
        problems.push(
          `overlaps[${i}].kind was ${JSON.stringify(o.kind)}; must be one of ` +
          OVERLAP_KINDS.map((x) => `"${x}"`).join(', ') + '.',
        );
        return;
      }
      if (typeof o.name !== 'string' || !known.has(`${o.kind}:${o.name}`)) {
        problems.push(
          `overlaps[${i}] names ${JSON.stringify(o.name)} as a ${o.kind}, which is not ` +
          'in the inventory. Only cite things that are actually listed.',
        );
      }
      if (typeof o.why !== 'string' || o.why.trim() === '') {
        problems.push(`overlaps[${i}].why must say what that thing already covers.`);
      }
    });
  }

  if (v.verdict === 'redundant' && Array.isArray(v.overlaps) && v.overlaps.length === 0) {
    problems.push('"redundant" with no overlaps is not an answer. Name what already covers this.');
  }

  return problems;
}

/**
 * Run the review.
 *
 * ONE call, then at most one retry. The retry is fed the exact problems from
 * the first attempt, because "try again" without saying what was wrong mostly
 * produces the same answer at a different temperature, and temperature is 0.
 *
 * Failing loudly after that is deliberate. A fit review that degrades to a
 * default verdict would either spend money it should not have, or refuse a
 * capability the system genuinely needs, and both would look like a decision.
 */
export async function fitReview(candidate, inventory, { llm, renderInventory, maxAttempts = 2 } = {}) {
  if (!llm) throw new FitReviewError('fitReview needs an llm client');
  if (!renderInventory) throw new FitReviewError('fitReview needs a renderInventory function');

  const block = renderInventory(inventory);
  let user = buildUserPrompt(candidate, block);
  let lastResponse = null;
  const failures = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await llm.complete({ system: SYSTEM, user, max_tokens: 1024 });
    lastResponse = res?.text ?? '';

    const parsed = extractJson(lastResponse);
    if (!parsed.ok) {
      failures.push(`attempt ${attempt}: ${parsed.error}`);
      user = retryPrompt(candidate, block, [parsed.error]);
      continue;
    }

    const problems = validateVerdict(parsed.value, inventory);
    if (problems.length === 0) {
      const v = parsed.value;
      return {
        verdict: v.verdict,
        owner: v.verdict === 'fits' ? v.owner : null,
        rationale: v.rationale.trim(),
        overlaps: v.overlaps.map((o) => ({ kind: o.kind, name: o.name, why: o.why.trim() })),
        model: llm.model,
        attempts: attempt,
      };
    }

    failures.push(`attempt ${attempt}: ${problems.join(' ')}`);
    user = retryPrompt(candidate, block, problems);
  }

  throw new FitReviewError(
    `fit review failed after ${maxAttempts} attempts:\n  ` + failures.join('\n  '),
    { attempts: maxAttempts, lastResponse },
  );
}

function retryPrompt(candidate, block, problems) {
  return [
    'Your previous answer was rejected. Fix exactly these problems and return',
    'the corrected JSON object, nothing else:',
    ...problems.map((p) => `- ${p}`),
    '',
    buildUserPrompt(candidate, block),
  ].join('\n');
}

export const __testing = { SYSTEM, buildUserPrompt, retryPrompt };
