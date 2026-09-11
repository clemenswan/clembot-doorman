/**
 * The Gemini client must be indistinguishable from the Anthropic one to a probe.
 *
 * The probes branch on `stop_reason` and read `tool_calls[].name/.args`. If a
 * second provider returns a different shape, the probes do not crash: they
 * quietly conclude the server never called a tool, and a perfectly good server
 * grades badly for a reason that has nothing to do with it. That is the failure
 * this file exists to prevent, so it asserts the SHAPE, not the vendor.
 *
 * No network: `fetch` is injected and every response is a real Gemini payload
 * shape, hand-built from the documented format.
 */

import { expect, it } from 'vitest';
import { GeminiLlmClient, toGeminiSchema, chooseProvider, GEMINI_DEFAULT_MODEL } from '../runner/gemini.mjs';
import { modelThatGraded as gradedBy } from '../runner/audit.mjs';

const okFetch = (payload) => async () => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

it('a text answer returns the Anthropic shape', async () => {
  const c = new GeminiLlmClient({
    apiKey: 'k',
    fetch: okFetch({ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }] }),
  });
  const r = await c.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
  expect(r.text).toBe('hello');
  expect(r.tool_calls).toEqual([]);
  expect(r.stop_reason).toBe('stop');
  expect(r.raw).toBeTruthy();
});

it('a function call maps onto tool_calls with a usable id', async () => {
  const c = new GeminiLlmClient({
    apiKey: 'k',
    fetch: okFetch({
      candidates: [{
        content: { parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] },
        finishReason: 'STOP',
      }],
    }),
  });
  const r = await c.complete({ messages: [{ role: 'user', content: 'go' }], tools: [{ name: 'search' }] });
  expect(r.tool_calls.length).toBe(1);
  expect(r.tool_calls[0].name).toBe('search');
  expect(r.tool_calls[0].args).toEqual({ q: 'x' });
  expect(r.tool_calls[0].id).toBeTruthy();
  // The probes branch on this exact string.
  expect(r.stop_reason).toBe('tool_use');
});

it('a missing args object does not become undefined', async () => {
  const c = new GeminiLlmClient({
    apiKey: 'k',
    fetch: okFetch({ candidates: [{ content: { parts: [{ functionCall: { name: 'ping' } }] } }] }),
  });
  const r = await c.complete({ messages: [{ role: 'user', content: 'go' }] });
  expect(r.tool_calls[0].args).toEqual({});
});

it('an HTTP error is raised, never swallowed into an empty answer', async () => {
  const c = new GeminiLlmClient({
    apiKey: 'k', retries: 0,
    fetch: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
  });
  await expect(() => c.complete({ messages: [] })).rejects.toThrow(/Gemini HTTP 429/);
});

it('a transient 503 is retried, because losing a probe RAISES the grade', async () => {
  // The live incident: three probes lost to 503 left the behavioural layer
  // averaged over one survivor. Retrying is the cheap half of the fix.
  let calls = 0;
  const c = new GeminiLlmClient({
    apiKey: 'k', retries: 3, retryBaseMs: 1,
    fetch: async () => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 503, text: async () => 'overloaded' };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), text: async () => '' };
    },
  });
  const r = await c.complete({ messages: [{ role: 'user', content: 'hi' }] });
  expect(calls).toBe(3);
  expect(r.text).toBe('ok');
});

it('a 400 is NOT retried, because our request is wrong and will stay wrong', async () => {
  let calls = 0;
  const c = new GeminiLlmClient({
    apiKey: 'k', retries: 3, retryBaseMs: 1,
    fetch: async () => { calls += 1; return { ok: false, status: 400, text: async () => 'bad schema' }; },
  });
  await expect(() => c.complete({ messages: [] })).rejects.toThrow(/Gemini HTTP 400/);
  expect(calls).toBe(1);
});

it('no key is refused at construction, not at call time', () => {
  expect(() => new GeminiLlmClient({ apiKey: '' })).toThrow(/GEMINI_API_KEY is required/);
});

it('assistant maps to Gemini’s `model` role', async () => {
  let sent;
  const c = new GeminiLlmClient({
    apiKey: 'k',
    fetch: async (_u, opt) => {
      sent = JSON.parse(opt.body);
      return { ok: true, status: 200, json: async () => ({ candidates: [] }), text: async () => '' };
    },
  });
  await c.complete({
    system: 'sys',
    messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
  });
  expect(sent.contents.map((x) => x.role)).toEqual(['user', 'model']);
  expect(sent.systemInstruction.parts[0].text).toBe('sys');
});

it('schemas are translated, and an unsupported keyword is dropped not fatal', () => {
  const s = toGeminiSchema({
    type: 'object',
    properties: {
      q: { type: 'string', description: 'query' },
      n: { type: ['integer', 'null'] },
    },
    required: ['q'],
    additionalProperties: false,   // Gemini rejects this outright
    $schema: 'http://json-schema.org/draft-07/schema#',
  });
  expect(s.type).toBe('OBJECT');
  expect(s.properties.q.type).toBe('STRING');
  expect(s.properties.n.type).toBe('INTEGER');
  expect(s.required).toEqual(['q']);
  expect(!('additionalProperties' in s)).toBeTruthy();
  expect(!('$schema' in s)).toBeTruthy();
});

it('an empty object schema still produces a callable tool', () => {
  // A tool with no parameters is common and Gemini rejects a bare empty OBJECT.
  // Dropping the tool would measure our strictness instead of the server.
  const s = toGeminiSchema({});
  expect(s.type).toBe('OBJECT');
  expect(Object.keys(s.properties ?? {}).length > 0).toBeTruthy();
});

it('provider choice: explicit beats inferred, and never silently falls back', () => {
  expect(chooseProvider({ env: { ANTHROPIC_API_KEY: 'a' } }).provider).toBe('anthropic');
  expect(chooseProvider({ env: { GEMINI_API_KEY: 'g' } }).provider).toBe('gemini');

  // Both present: Anthropic, because every published grade names a Claude model.
  expect(chooseProvider({ env: { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' } }).provider).toBe('anthropic');

  // Explicitly asking for a provider with no key is an ERROR. Falling back
  // would grade on a different model than the operator asked for, and label it
  // correctly, which is worse than stopping.
  const bad = chooseProvider({ env: { DOORMAN_LLM_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' } });
  expect(bad.ok).toBe(false);
  expect(bad.why).toMatch(/GEMINI_API_KEY is not set/);

  expect(chooseProvider({ env: {} }).ok).toBe(false);
  expect(chooseProvider({ env: { DOORMAN_LLM_PROVIDER: 'llama' } }).why).toMatch(/unknown/);
});

it('the default Gemini model is pinned, not floating', () => {
  const p = chooseProvider({ env: { GEMINI_API_KEY: 'g' } });
  expect(p.model).toBe(GEMINI_DEFAULT_MODEL);
  // A grade is relative to the model that produced it, so an alias that moves
  // under us would silently change what a published grade means.
  expect(/\d/.test(GEMINI_DEFAULT_MODEL)).toBeTruthy();
});

/**
 * Provenance: the `model` on a grade must name the model that produced it.
 *
 * A static-only audit runs no model at all, yet `job.model` carries a default
 * regardless, so every static-only grade published before this claimed
 * `claude-sonnet-5` produced it. The live feed showed exactly that: a deepwiki
 * row reading `behavioural=null model=claude-sonnet-5`, which is a field
 * saying a model ran and a field saying it did not, in the same row.
 *
 * These assert the rule at the value level, because the function that applies
 * it needs mcpscore, a network and an MCP server to reach.
 */
// Imported, NOT re-implemented. See the note above.

it('a static-only audit records NO model, because none ran', () => {
  expect(gradedBy(true, 'claude-sonnet-5')).toBe(null);
  expect(gradedBy(true, 'gemini-2.5-flash')).toBe(null);
});

it('a behavioural audit records the model that ran', () => {
  expect(gradedBy(false, 'gemini-2.5-flash')).toBe('gemini-2.5-flash');
  expect(gradedBy(false, 'claude-sonnet-5')).toBe('claude-sonnet-5');
});

it('a missing model is null, never a default that reads as evidence', () => {
  expect(gradedBy(false, undefined)).toBe(null);
});
