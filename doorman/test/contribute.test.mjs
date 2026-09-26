/**
 * `doorman contribute`.
 *
 * This is the first command in the giveaway that SENDS anything derived from
 * the user's own machine, so the tests that matter are the ones proving what
 * it cannot send. `needs.mjs` promises in its own header that the prompts never
 * leave the machine; nothing here may weaken that.
 *
 * The other load-bearing assertion is that nothing is sent without `--send`.
 * A default that transmits would make every other guarantee here a matter of
 * trusting the reader to have checked.
 */

import { check, describe } from './harness.mjs';
import { buildPayload, renderContribute, sendPayload } from '../cli/contribute.mjs';

const needs = (gapIds, extra = []) => ({
  prompts_read: 40,
  needs: [
    ...gapIds.map((id) => ({ id, gap: true, covered: false, label: id, hits: 3, matched: ['x'] })),
    ...extra,
  ],
});

const inv = (names) => ({ mcpServers: names.map((name) => ({ name, transport: 'http' })) });
const gate = (allowed, denied = []) => ({ allowed, denied });

describe('contribute: what it collects');

{
  const r = buildPayload({
    needs: needs(['web-search', 'database']),
    inventory: inv(['known_server', 'stranger']),
    gate: gate(['known_server']),
  });
  check('gaps are taxonomy ids from the local needs run',
    JSON.stringify(r.payload.gaps) === JSON.stringify(['web-search', 'database']));
  check('blocked is the declared servers missing from the trust list',
    JSON.stringify(r.payload.blocked) === JSON.stringify(['stranger']));
  check('a trusted server is never reported',
    !r.payload.blocked.includes('known_server'));
  check('the payload carries a client version', typeof r.payload.client_version === 'string');
}

{
  // A need that is unmet but HAS a candidate is not a gap. Reporting it would
  // ask for something that already exists and is graded.
  const r = buildPayload({
    needs: needs(['web-search'], [{ id: 'payments', gap: false, covered: false }]),
    inventory: inv([]),
    gate: gate([]),
  });
  check('an unmet need with a graded candidate is not contributed',
    JSON.stringify(r.payload.gaps) === JSON.stringify(['web-search']));
}

describe('contribute: what it must never send');

{
  const r = buildPayload({
    needs: {
      prompts_read: 12,
      needs: [{
        id: 'database', gap: true, covered: false,
        // Every one of these is real output from `needs`, and none of it may
        // travel. `matched` in particular is a fragment of the user's prompt.
        matched: ['the database password is hunter2'],
        label: 'Querying the database directly',
        hits: 9,
        prompt_samples: ['deploy the thing to prod with the key'],
      }],
    },
    inventory: inv([]),
    gate: gate([]),
  });
  const wire = JSON.stringify(r.payload);
  check('no prompt fragment reaches the payload', !wire.includes('hunter2'));
  check('no matched term reaches the payload', !wire.includes('password'));
  check('no prompt sample reaches the payload', !wire.includes('deploy the thing'));
  check('no hit count reaches the payload', !wire.includes('9'));
  check('the payload has exactly three keys',
    JSON.stringify(Object.keys(r.payload).sort()) === JSON.stringify(['blocked', 'client_version', 'gaps']));
}

{
  // A server declared by url must be reported by NAME or not at all. The gate
  // only ever sees a name, and a url is a different kind of fact about a build.
  const r = buildPayload({
    needs: needs([]),
    inventory: { mcpServers: [{ name: 'stranger', url: 'https://internal.corp.example/mcp' }] },
    gate: gate([]),
  });
  check('a server url never reaches the payload',
    !JSON.stringify(r.payload).includes('internal.corp.example'));
  check('its name still does', r.payload.blocked.includes('stranger'));
}

describe('contribute: an unreadable trust list is not an empty one');

{
  // Invariant 3, the same way `doctor` already applies it: `allowed === null`
  // means the list could not be read. Treating that as "nothing is trusted"
  // would report every server in the build as unreviewed, which is a confident
  // wrong answer about somebody else's configuration.
  const r = buildPayload({
    needs: needs(['web-search']),
    inventory: inv(['a', 'b', 'c']),
    gate: gate(null),
  });
  check('nothing is reported as blocked when the list is unreadable',
    r.payload.blocked.length === 0);
  check('and the reason is stated rather than swallowed',
    r.notes.some((n) => /could not be read/i.test(n)));
  check('the gaps are still contributed', r.payload.gaps.length === 1);
}

{
  const r = buildPayload({
    needs: needs([]),
    inventory: inv(['refused_one', 'stranger']),
    gate: gate([], ['refused_one']),
  });
  check('a denylisted server is not contributed',
    !r.payload.blocked.includes('refused_one'),
    'a denylist entry is the user’s own judgement, not a demand signal');
  check('an unreviewed one still is', r.payload.blocked.includes('stranger'));
}

describe('contribute: nothing is sent without --send');

{
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = buildPayload({ needs: needs(['web-search']), inventory: inv([]), gate: gate([]) });
  const out = renderContribute(r, { sent: false, api: 'https://s.test' });
  check('the default run makes no request', !called);
  check('it prints the exact json that WOULD be sent', out.includes('"web-search"'));
  check('it names the flag that would send it', /--send/.test(out));
  check('it does not claim anything was contributed', !/contributed|thank/i.test(out));
  void spy;
}

describe('contribute: sending');

{
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ ok: true, counted: { gaps: 1, blocked: 0 }, dropped: [] }) };
  };
  const res = await sendPayload({ gaps: ['web-search'], blocked: [], client_version: '0.2.1' },
    { api: 'https://s.test', fetch: fakeFetch });
  check('posts to /signal', seen[0].url === 'https://s.test/signal');
  check('uses POST', seen[0].init.method === 'POST');
  check('sends no authorization header', !('authorization' in (seen[0].init.headers || {})));
  check('the body is exactly the payload',
    seen[0].init.body === JSON.stringify({ gaps: ['web-search'], blocked: [], client_version: '0.2.1' }));
  check('reports what the service counted', res.counted.gaps === 1);
}

{
  const failing = async () => { throw new Error('offline'); };
  const res = await sendPayload({ gaps: [], blocked: [], client_version: '0' },
    { api: 'https://s.test', fetch: failing });
  check('a network failure is reported, never thrown at the user', res.ok === false);
  check('and it says what went wrong', /offline/.test(res.error));
}

{
  const refusing = async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate limit reached' }) });
  const res = await sendPayload({ gaps: [], blocked: [], client_version: '0' },
    { api: 'https://s.test', fetch: refusing });
  check('a refusal from the service is surfaced', res.ok === false && /rate limit/.test(res.error));
}

{
  // A silent truncation would let a build with 35 unreviewed servers believe
  // it reported all of them.
  const truncating = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, counted: { gaps: 0, blocked: 20 }, dropped: [], truncated: true }),
  });
  const res = await sendPayload({ gaps: [], blocked: [], client_version: '0' },
    { api: 'https://s.test', fetch: truncating });
  check('a truncated submission is carried back', res.truncated === true);
  const out = renderContribute(
    { payload: { gaps: [], blocked: [], client_version: '0' }, notes: [] },
    { sent: true, api: 'https://s.test', result: res });
  check('and the user is told', /were not counted/.test(out));
}
