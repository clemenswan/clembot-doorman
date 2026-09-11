/**
 * Gemini as an alternative probe model.
 *
 * WHY THIS IS SAFE TO ADD NOW, and would not have been later. A behavioural
 * grade is only meaningful relative to the model that produced it, which is why
 * `model` is stamped on every audit and printed on every badge. Switching
 * providers normally splits a corpus into two incomparable halves. At the time
 * this was written, 0 of 26 published rows had a behavioural score at all, so
 * there is no corpus to split: whichever provider runs first simply becomes the
 * baseline.
 *
 * WHAT IS NOT CLAIMED. Gemini and Claude do not call tools identically. A
 * server that scores worse under one may be worse at being driven by THAT
 * model rather than worse in general. That is not a defect to hide, it is the
 * reason the model is recorded, and a report should never be read as a claim
 * about a server independent of the model named on it.
 *
 * The contract is `AnthropicLlmClient`'s, exactly:
 *   complete({ system, messages, tools, max_tokens })
 *     -> { stop_reason, text, tool_calls: [{id, name, args}], raw }
 * Anything that drifts from it breaks the probes silently, so the shape is
 * asserted in test/gemini-client.test.mjs rather than trusted.
 */

import { sanitizeToolName, normaliseSchema } from './host-node.mjs';

// PINNED, and verified callable WITH A TOOL against the live API on 2026-09-11.
// gemini-2.5-flash was the first choice and the API refused it: 'no longer
// available to new users'. The model LISTING still advertises it, so the list
// is not evidence that a key can call it. An alias like gemini-flash-latest
// would dodge that and reintroduce a worse problem: a grade is relative to the
// model that produced it, so a name that moves silently changes what every
// published grade means.
// FREE-TIER QUOTA IS PER MODEL, and it is small: 20 requests. gemini-3.8-flash
// was exhausted after three audit runs, and one audit makes many calls (a probe
// is an agent loop, not one request). 3.5-flash-lite is stable, still had quota,
// and was verified to call the right tool with the right argument. Pass --model
// to override: on a billed key, gemini-3.8-flash is the stronger grader, and a
// stronger grader is fairer to the servers being graded.
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini rejects several JSON Schema keywords Anthropic accepts, and an MCP
 * server is under no obligation to avoid them. Dropping an unsupported keyword
 * is right; dropping the tool would measure our strictness instead of the
 * server, which `normaliseSchema` already refuses to do.
 */
const ALLOWED_KEYS = new Set([
  'type', 'format', 'description', 'nullable', 'enum',
  'properties', 'required', 'items', 'minimum', 'maximum',
]);

export function toGeminiSchema(schema) {
  const base = normaliseSchema(schema);
  const walk = (node) => {
    if (!node || typeof node !== 'object') return { type: 'STRING' };
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (!ALLOWED_KEYS.has(k)) continue;
      if (k === 'type') {
        // Gemini wants the type in upper case, and has no null type.
        const t = Array.isArray(v) ? v.find((x) => x !== 'null') ?? 'string' : v;
        out.type = String(t).toUpperCase();
      } else if (k === 'properties' && v && typeof v === 'object') {
        out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv)]));
      } else if (k === 'items') {
        out.items = walk(v);
      } else {
        out[k] = v;
      }
    }
    if (!out.type) out.type = 'OBJECT';
    // An OBJECT with no properties is rejected outright, so give it one.
    if (out.type === 'OBJECT' && (!out.properties || !Object.keys(out.properties).length)) {
      delete out.properties;
      delete out.required;
      out.type = 'OBJECT';
      out.properties = { _: { type: 'STRING', description: 'unused' } };
    }
    return out;
  };
  return walk(base);
}

export class GeminiLlmClient {
  constructor({
    apiKey, model = GEMINI_DEFAULT_MODEL, temperature = 0, maxTokens = 1024,
    fetch: f = fetch, retries = 3, retryBaseMs = 1500,
  }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for behavioural probes');
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.fetch = f;
    this.retries = retries;
    this.retryBaseMs = retryBaseMs;
  }

  async complete({ system, messages, tools, max_tokens }) {
    const body = {
      contents: (messages ?? []).map((m) => ({
        // Gemini's two roles are `user` and `model`. Anthropic's `assistant`
        // maps to `model`; anything else is treated as the user speaking.
        role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      })),
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: max_tokens ?? this.maxTokens,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    if (tools?.length) {
      body.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: sanitizeToolName(t.name),
          description: t.description ?? t.title ?? t.name,
          parameters: toGeminiSchema(t.inputSchema),
        })),
      }];
    }

    const url = `${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`;

    // RETRY, because a transient 503 does not just lose a probe: it RAISES the
    // grade. `behavioralPct` averages the probes that produced a score, so a
    // probe that errored leaves the denominator and the survivors carry the
    // layer. The first live Gemini run lost three probes to 503 and deepwiki's
    // behavioural score came back 100% from one survivor.
    //
    // Retrying is the cheap half of the fix. The other half is in grade.ts:
    // an audit that could not run its probes must not publish a behavioural
    // score as though it had.
    let res;
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const waitMs = this.retryBaseMs * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, waitMs));
      }
      res = await this.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      // 429 and 5xx are the provider having a moment. A 400 is our request
      // being wrong, and retrying that just wastes the budget more slowly.
      if (res.status !== 429 && res.status < 500) break;
      lastErr = res.status;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const tried = lastErr ? ` after ${this.retries + 1} attempts` : '';
      throw new Error(`Gemini HTTP ${res.status}${tried}: ${text.slice(0, 400)}`);
    }

    const data = await res.json();
    const cand = (data.candidates ?? [])[0] ?? {};
    const textParts = [];
    const toolCalls = [];
    let i = 0;
    for (const part of cand.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text) textParts.push(part.text);
      if (part.functionCall) {
        // Gemini returns no call id. The probes only need a stable handle to
        // pair a result with its call, so one is synthesised per response.
        toolCalls.push({
          id: `gemini-${i++}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        });
      }
    }

    return {
      // Normalised to Anthropic's vocabulary, because the probes branch on it.
      stop_reason: toolCalls.length ? 'tool_use'
        : cand.finishReason === 'MAX_TOKENS' ? 'max_tokens'
        : cand.finishReason ? String(cand.finishReason).toLowerCase()
        : 'unknown',
      text: textParts.join('\n'),
      tool_calls: toolCalls,
      raw: data,
    };
  }
}

/**
 * Pick a provider from the environment. Explicit beats inferred: an explicitly
 * named provider that has no key is an ERROR, never a silent fallback to the
 * other one. A run that quietly grades on a different model than the operator
 * asked for produces a correctly-labelled grade nobody can explain.
 */
export function chooseProvider({ env = process.env, model } = {}) {
  const want = (env.DOORMAN_LLM_PROVIDER || '').toLowerCase();
  const gem = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const ant = env.ANTHROPIC_API_KEY;

  if (want === 'gemini') {
    if (!gem) return { ok: false, why: 'DOORMAN_LLM_PROVIDER=gemini but GEMINI_API_KEY is not set.' };
    return { ok: true, provider: 'gemini', apiKey: gem, model: model || GEMINI_DEFAULT_MODEL };
  }
  if (want === 'anthropic') {
    if (!ant) return { ok: false, why: 'DOORMAN_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.' };
    return { ok: true, provider: 'anthropic', apiKey: ant, model: model || 'claude-sonnet-5' };
  }
  if (want) return { ok: false, why: `unknown DOORMAN_LLM_PROVIDER "${want}". Use gemini or anthropic.` };

  // Neither named: Anthropic first, because every grade published so far names
  // a Claude model and staying consistent by default is the lesser surprise.
  if (ant) return { ok: true, provider: 'anthropic', apiKey: ant, model: model || 'claude-sonnet-5' };
  if (gem) return { ok: true, provider: 'gemini', apiKey: gem, model: model || GEMINI_DEFAULT_MODEL };
  return { ok: false, why: 'No model key. Set GEMINI_API_KEY or ANTHROPIC_API_KEY, or pass --static-only.' };
}
