/**
 * The paid client. The only thing here that can spend money.
 *
 * Injected everywhere so tests can pass a stub that THROWS if it is touched.
 * That is the shape of the guarantee: "no scorecard call happened" is only
 * checkable if there is one object that would have made it.
 *
 * It is also never CONSTRUCTED on a path that must not pay. A skill or a repo
 * has no tools to drive, so `runVet` does not build one at all rather than
 * building one and remembering not to call it.
 *
 * ## A budget is required, including for the free reads
 *
 * `scorecardClient` refuses to exist without one. Making it optional would mean
 * there is a way to obtain an enqueue-capable client with no spend cap, and a
 * guarantee with an opt-out is a default. `cached()` and `price()` cost nothing
 * and still travel with the cap, because the cap is a property of the client,
 * not a step someone has to remember.
 */

export class ScorecardError extends Error {}

/**
 * @param {object} opts
 * @param {string} opts.api      base url, e.g. https://scorecard.wanessalabs.com
 * @param {object} opts.budget   from openBudget(). REQUIRED. See above.
 * @param {Function} [opts.fetch] injectable
 */
export function scorecardClient({ api, budget, fetch: f = fetch, timeoutMs = 30_000 } = {}) {
  if (!api) throw new ScorecardError('scorecardClient needs an api base url');
  if (!budget || typeof budget.isOpen !== 'function') {
    throw new ScorecardError(
      'scorecardClient needs a budget. Build one with openBudget(). This is ' +
      'not optional: a client with no spend cap is a client that can spend ' +
      'without limit, and an optional guarantee is a default.',
    );
  }
  const base = api.replace(/\/+$/, '');

  const call = async (path, init) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await f(base + path, { ...init, signal: ac.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    api: base,

    /** The cheap read. Returns null when the server has never been graded. */
    async cached(serverUrl) {
      const res = await call('/grade?server=' + encodeURIComponent(serverUrl));
      if (res.status === 404) return null;
      if (!res.ok) throw new ScorecardError(`cached lookup failed: HTTP ${res.status}`);
      const j = await res.json();
      return j.graded ? j : null;
    },

    /**
     * What an audit costs, asked rather than assumed.
     *
     * A missing price is NOT zero. When the service cannot be reached or gives
     * an answer this client does not understand, `price_usdc` comes back null
     * and `openBudget().reserve()` refuses it. That is deliberate: defaulting
     * an unknown price to zero passes every cap forever.
     */
    async price() {
      const res = await call('/price');
      if (!res.ok) {
        return { payment_required: null, price_usdc: null, known: false,
                 why: `GET /price returned HTTP ${res.status}` };
      }
      const j = await res.json().catch(() => null);
      if (!j || typeof j.price_usdc !== 'number') {
        return { payment_required: j?.payment_required ?? null, price_usdc: null, known: false,
                 why: 'the service did not state a decimal price' };
      }
      return { ...j, known: true };
    },

    /**
     * The paid write. Requires an OPEN permit from the budget this client was
     * built with, and the permit is checked here rather than trusted, so a
     * fabricated or already-spent one buys nothing.
     */
    async enqueue({ url, name, needed_for, owner = 'doorman', permit }) {
      if (!budget.isOpen(permit)) {
        throw new ScorecardError(
          'enqueue() needs an open budget permit. Call budget.reserve({ ' +
          'price_usdc, server }) first. A permit is single-use: one that was ' +
          'already settled or released cannot buy a second audit.',
        );
      }
      const res = await call('/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner': owner },
        body: JSON.stringify([{ url, name, needed_for }]),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ScorecardError(`enqueue failed: HTTP ${res.status} ${body.slice(0, 200)}`);
      }
      const j = await res.json();
      const a = (j.audits ?? [])[0];
      if (!a?.audit_id) throw new ScorecardError('enqueue returned no audit id');
      return a;
    },

    async audit(id) {
      const res = await call('/grade/' + encodeURIComponent(id));
      if (!res.ok) throw new ScorecardError(`audit read failed: HTTP ${res.status}`);
      return res.json();
    },

    transcriptsUrl(id) {
      return `${base}/grade/${id}/transcripts`;
    },
  };
}
