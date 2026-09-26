/**
 * `doorman contribute` - the write half of the subscription.
 *
 * `watch` and `needs` are the read half: they pull a shared feed and decide
 * locally, against an inventory that is never sent anywhere, which rows matter
 * to this build. That half has always worked. What the service never had was
 * any way to learn what people wanted and could not find, so the grading queue
 * was ordered by whatever anyone happened to submit rather than by demand.
 *
 * This sends two things and nothing else:
 *
 *   gaps     capability ids from THIS build's own `needs` run where nothing
 *            graded covers the need. Invariant 29 already requires that line
 *            to be printed rather than dropped; until now it was printed to
 *            one terminal and discarded.
 *   blocked  server names this build declares that are not on its trust list.
 *            The gate would refuse them, and nobody has graded them.
 *
 * NOTHING IS SENT WITHOUT `--send`. The default run prints the exact JSON and
 * stops. That is not a courtesy, it is the only reason anyone should turn this
 * on: a claim about what a tool transmits is worth less than a command that
 * shows you.
 *
 * WHY THE PROMPTS CANNOT TRAVEL, STRUCTURALLY. `buildPayload` reads the `id`
 * field off a need and nothing else, so `matched`, `label`, `hits` and every
 * prompt fragment `needs` carries are dropped by construction rather than by a
 * filter someone has to remember to keep correct. `needs.mjs` promises the
 * prompts never leave the machine and invariant 28 is why that matters: most
 * `user` records in a transcript directory are tool results and expanded skill
 * bodies, so a field that carried prose here would ship the user's own files.
 *
 * WHY THE GATE WAS NOT TOUCHED. The obvious source for `blocked` is the gate's
 * own refusals, and the gate records none. Invariant 7 keeps `mcp-gate.sh`
 * offline and dependency-free, and adding a write path to the one security
 * control in the product to feed a telemetry feature is a bad trade. The
 * inventory already knows which declared servers are missing from the
 * allowlist, which is the same set, computed without touching the gate.
 *
 * A DENYLISTED SERVER IS NEVER CONTRIBUTED. It is missing from the allowlist
 * too, so it would otherwise ride along. A denylist entry is a judgement the
 * user made about a server, and publishing it is closer to an accusation than
 * to a demand signal. Reporting "nobody has graded this" is a different claim
 * from "I refused this".
 */

export const DEFAULT_API = 'https://scorecard.wanessalabs.com';

/**
 * The version is NOT imported here. There are already four declarations of it
 * (root package.json, doorman/package.json, plugin.json, doorman.mjs) pinned
 * to each other by `version.test.mjs`, and one of them silently reported 0.1.0
 * out of a 0.2.0 tarball. A fifth would be a fifth thing to get wrong, so the
 * caller passes the one it already holds.
 */
const UNKNOWN_VERSION = 'unknown';

/**
 * Decide what may be sent. Pure: every input is passed in, so the guarantees
 * above are testable with no filesystem, no network and no build.
 */
export function buildPayload({ needs, inventory, gate, version = UNKNOWN_VERSION }) {
  const notes = [];

  // `id` and nothing else. See the header: this is a projection, not a filter.
  const gaps = (needs?.needs ?? []).filter((n) => n?.gap).map((n) => String(n.id));

  let blocked = [];
  if (!Array.isArray(gate?.allowed)) {
    // Invariant 3, the way `doctor` already applies it to a trust list. A list
    // that could not be READ is not a list that trusts nothing, and treating
    // it as one would report every server in the build as unreviewed.
    notes.push('The trust list could not be read, so nothing was reported as unreviewed. '
      + 'That is not the same as an empty trust list, and this refuses to guess which it is.');
  } else {
    const allowed = new Set(gate.allowed);
    const denied = new Set(gate.denied ?? []);
    blocked = (inventory?.mcpServers ?? [])
      .map((s) => s?.name)
      .filter((n) => typeof n === 'string' && n.length > 0)
      .filter((n) => !allowed.has(n) && !denied.has(n));
    blocked = [...new Set(blocked)];
  }

  return {
    payload: { gaps, blocked, client_version: String(version) },
    notes,
  };
}

/**
 * POST it. Anonymous by design: no token, no install id, no header that could
 * carry one. A contribution is a count with no contributor attached.
 *
 * Never throws at the caller. A community feature that can break a terminal
 * session is a feature people turn off.
 */
export async function sendPayload(payload, { api = DEFAULT_API, fetch: f = fetch } = {}) {
  let res;
  try {
    res = await f(new URL('/signal', api), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let body = {};
  try { body = await res.json(); } catch { /* a non-JSON reply is still a reply */ }

  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.error || `the service replied ${res.status}` };
  }
  return {
    ok: true,
    counted: body?.counted ?? { gaps: 0, blocked: 0 },
    dropped: body?.dropped ?? [],
    truncated: Boolean(body?.truncated),
  };
}

export function renderContribute(built, { sent = false, api = DEFAULT_API, result = null } = {}) {
  const L = [];
  const { payload, notes } = built;

  L.push('');
  L.push(sent ? 'doorman contribute: sent' : 'doorman contribute: dry run, nothing was sent');
  L.push('');
  L.push(`  ${payload.gaps.length} capability gap(s), ${payload.blocked.length} unreviewed server name(s).`);
  L.push('');
  L.push('  This is the whole payload:');
  L.push('');
  for (const line of JSON.stringify(payload, null, 2).split('\n')) L.push('    ' + line);
  L.push('');

  for (const n of notes) L.push('  ' + n);
  if (notes.length) L.push('');

  L.push('  Counts only. No prompt text, no urls and no identity. Nothing sent');
  L.push('  here can change a grade: it orders what gets graded next.');
  L.push('');

  if (sent && result) {
    if (result.ok) {
      L.push(`  ${api} counted ${result.counted.gaps} gap(s) and ${result.counted.blocked} name(s).`);
      for (const d of result.dropped ?? []) L.push(`  dropped: ${d.value} (${d.why})`);
      // The service caps terms per request. Saying nothing here would let a
      // build with 35 unreviewed servers believe it reported all of them.
      if (result.truncated) {
        L.push('  Some names were over the per-request cap and were not counted. '
          + 'Run this again after trimming the trust list to report the rest.');
      }
    } else {
      L.push(`  Not recorded: ${result.error}`);
    }
  } else {
    L.push(`  Send it with:  doorman contribute --send`);
    L.push(`  It would go to ${api}/signal`);
  }
  L.push('');
  return L.join('\n');
}
