/**
 * The only thing in the fit-review path allowed to touch the network.
 *
 * Everything else receives this object and can do nothing it does not expose,
 * which is what lets every test run offline with a stub. Same seam the
 * scorecard's probe runner uses, for the same reason.
 *
 * Pinned model, temperature 0, both from config rather than from a caller.
 * A fit verdict is relative to the model that produced it exactly as a grade
 * is, so letting a caller pass a different model per call would silently make
 * two reviews incomparable.
 */

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_VERSION = '2023-06-01';

export class MissingApiKeyError extends Error {}

/**
 * @param {object} opts
 * @param {string} [opts.apiKey]   from ANTHROPIC_API_KEY
 * @param {string} [opts.model]    from DOORMAN_MODEL
 * @param {Function} [opts.fetch]  injectable for tests
 */
export function anthropicClient({ apiKey, model = DEFAULT_MODEL, fetch: f = fetch, timeoutMs = 60_000 } = {}) {
  if (!apiKey) {
    // Loud, and at construction rather than at call time. A doorman that
    // quietly skipped the free fit check and went straight to the paid grade
    // would invert the entire feature.
    throw new MissingApiKeyError(
      'ANTHROPIC_API_KEY is not set, so the fit review cannot run.\n' +
      'The fit review is the FREE check that decides whether the paid grade is ' +
      'worth running at all. Skipping it to reach the paid path is backwards, ' +
      'so this stops here instead.\n' +
      'Set ANTHROPIC_API_KEY, or use --dry-run to inspect the candidate and the ' +
      'inventory without running either phase.',
    );
  }

  return {
    model,
    temperature: 0,

    /**
     * One turn. No tools, no streaming, no conversation: the fit review is a
     * single question with a single JSON answer.
     * @returns {Promise<{text: string, stop_reason: string, raw: unknown}>}
     */
    async complete({ system, user, max_tokens = 1024 }) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let res;
      try {
        res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens,
            temperature: 0,
            system,
            messages: [{ role: 'user', content: user }],
          }),
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = await res.json();
      const text = (json.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text, stop_reason: json.stop_reason, raw: json };
    },
  };
}
