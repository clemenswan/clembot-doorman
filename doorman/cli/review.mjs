/**
 * `doorman review [path]` — L1 over every server doctor found.
 *
 * doctor says what an agent can reach; this measures it. For each distinct
 * remote url it runs the same static report `doorman report` runs (mcpscore
 * plus the scan-only injection sniff, no model key, nothing billed) and keeps
 * the result in `.doorman/reviews.json`, which `doorman dashboard` renders.
 *
 * What it will NOT do:
 *   - run a stdio server. That means executing a local command from a config
 *     file, which is exactly the trust decision under review.
 *   - review a claude.ai connector. Its url and login live with the account,
 *     so there is nothing on this machine to point a report at. It is listed as
 *     skipped with that reason rather than dropped.
 *   - invent a grade for a server that refused the connection. A 401 is
 *     recorded as `auth-required` with no band, because a band would be a
 *     grade of the login page.
 *   - touch the trust list. Reviewing is not approving. `doorman allow` is.
 *   - audit a server anonymously after being told it needs a credential. A
 *     server mapped in `.doorman/tokens.json` to a variable that is not set is
 *     recorded as `token-missing` and SKIPPED. Falling back would produce a
 *     grade of a login page that reads like a grade of the server.
 *
 * Credentials come from `.doorman/tokens.json`, which holds environment
 * variable NAMES. This file learns which name applies to which server and
 * passes the name down. It never reads a token value; the runner does, out of
 * the environment it inherited. See cli/tokens.mjs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { doctor } from './doctor.mjs';
import { readSurfaces, reviewSurface } from '../src/surface.mjs';
import { diagnose, report } from './report.mjs';
import { readTokenMap, resolveTokenEnv, tokenEnvFor, tokenHint } from './tokens.mjs';

export { diagnose };

const REVIEWS = path.join('.doorman', 'reviews.json');

export function readReviews(root) {
  const file = path.join(root, REVIEWS);
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

const slug = (url) => url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9.-]+/g, '_').slice(0, 80);

/**
 * Appended to the auth-required hint when the server was audited anonymously.
 *
 * A 401 used to be a dead end in this report. It is now a fixable one, and the
 * row is the only place anyone will read about it.
 */
const MAP_A_CREDENTIAL =
  `To audit behind the login, map this server in ${path.join('.doorman', 'tokens.json')} ` +
  'to the NAME of an environment variable holding a bearer token, never to the token itself.';

export async function reviewServers(root, {
  servers, reportImpl = report, log = () => {}, now = () => new Date().toISOString(), concurrency = 4,
  tokenMap, env = process.env,
} = {}) {
  const reviews = readReviews(root);
  const surfaces = readSurfaces(root);
  const surfaceReviews = {};
  const skipped = [];
  const urls = [];
  // A captured surface is reviewed for EVERY server, reachable or not. For a
  // server that answers, the connection is better evidence and the two sit side
  // by side; for the 28 that do not, this is the only look at the text an agent
  // is actually handed.
  const map = tokenMap ?? readTokenMap(root);
  /**
   * url -> the credential decision for it.
   *
   * Resolved per SERVER and then keyed by url, because the map can be keyed by
   * gate name and the sweep is deduplicated by url. First mapping wins: two
   * gate names pointing at one url with two different variables is a question
   * only the operator can answer, and picking one silently at least records
   * which one it picked on the row.
   */
  const creds = new Map();
  for (const s of servers) {
    const cap = surfaces[s.gateName];
    if (cap) surfaceReviews[s.gateName] = reviewSurface(cap);
  }
  for (const s of servers) {
    if (s.transport === 'claude.ai') {
      skipped.push({ gateName: s.gateName, why: surfaceReviews[s.gateName]
        ? 'claude.ai connector: no local url, so the captured surface is the review'
        : 'claude.ai connector: its url and login are held by the account, not this machine' });
      continue;
    }
    if (!/^https?:\/\//.test(s.target || '')) { skipped.push({ gateName: s.gateName, why: `${s.transport || 'unknown'} server: review never executes a local command` }); continue; }
    if (!urls.includes(s.target)) urls.push(s.target);
    if (!creds.has(s.target)) {
      const mapped = tokenEnvFor(s, map);
      if (mapped) creds.set(s.target, { key: mapped.key, ...resolveTokenEnv(mapped.name, env) });
    }
  }

  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const cred = creds.get(url) ?? null;
      const out = path.join(root, '.doorman', 'reviews', slug(url));

      // MAPPED BUT UNUSABLE IS A REFUSAL, NOT A DOWNGRADE.
      //
      // The operator has said this server needs a credential. Auditing it
      // without one would return a real, confident grade over the login page,
      // which is the one failure here that does not look like a failure. So
      // nothing is measured and the row says exactly what is missing.
      if (cred && cred.status !== 'ok') {
        reviews[url] = {
          url, reviewed_at: now(), status: 'token-missing', authenticated: false,
          token_env: cred.name, hint: tokenHint(cred.key, cred),
        };
        log(`  token-missing${cred.name ? ' ' + cred.name : ''} (not audited)`);
        continue;
      }

      const tokenEnv = cred ? cred.name : null;
      log(`reviewing ${url}${tokenEnv ? ` with the credential in $${tokenEnv}` : ''}`);
      let r;
      // Only the NAME crosses this call. The value stays in the environment
      // and reaches the runner by inheritance, so it is in no argument list.
      try { r = await reportImpl({ link: url, out, tokenEnv, log: () => {} }); } catch (e) { r = { ok: false, detail: e.message }; }
      if (r.ok) {
        const g = r.grade;
        reviews[url] = { url, reviewed_at: now(), status: 'graded', band: g.band, score: g.score,
          hard_fail: g.hard_fail ?? null, static_partial: g.static_partial ?? null,
          // An authenticated audit and an anonymous one measure different
          // surfaces, so a reader has to be able to tell which this row is.
          authenticated: Boolean(tokenEnv) || g.authenticated === true,
          token_env: tokenEnv, out };
      } else {
        const d = diagnose(`${r.why ?? ''}\n${r.detail ?? ''}`);
        reviews[url] = { url, reviewed_at: now(), status: d.status,
          hint: d.status === 'auth-required' && !tokenEnv ? `${d.hint} ${MAP_A_CREDENTIAL}` : d.hint,
          authenticated: Boolean(tokenEnv), token_env: tokenEnv,
          detail: String(r.detail ?? r.why ?? '').slice(-400) };
      }
      log(`  ${reviews[url].status}${reviews[url].band ? ' ' + reviews[url].band : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  mkdirSync(path.join(root, '.doorman'), { recursive: true });
  writeFileSync(path.join(root, REVIEWS), JSON.stringify(reviews, null, 2), 'utf8');
  writeFileSync(path.join(root, '.doorman', 'surface-reviews.json'), JSON.stringify(surfaceReviews, null, 2), 'utf8');
  return { ok: true, root, reviewed: urls.length, reviews, skipped,
           surfaces: surfaceReviews, surfacesUnreadable: surfaces.__unreadable || [] };
}

export async function review(target = process.cwd(), opts = {}) {
  const d = await doctor(target, opts);
  if (!d.ok) return d;
  return reviewServers(d.root, { ...opts, servers: d.servers });
}

export function renderReview(r) {
  const L = [''];
  const counts = {};
  for (const url of Object.keys(r.reviews)) counts[r.reviews[url].status] = (counts[r.reviews[url].status] || 0) + 1;
  L.push(`  reviewed ${r.reviewed} url(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);
  L.push(`  skipped  ${r.skipped.length} server(s) with nothing on this machine to measure`);
  const sr = Object.values(r.surfaces || {});
  if (sr.length) {
    const bad = sr.filter((x) => x.hard || x.steering || x.advisory).length;
    L.push(`  surfaces ${sr.length} captured surface(s) scanned, ${bad} with findings (a capture is not a connection: no grade)`);
  }
  for (const f of r.surfacesUnreadable || []) L.push(`  WARNING  unreadable capture: ${f}`);
  // Which surface was measured, per row, summed. An authenticated audit and an
  // anonymous one are not comparable, so a count of one is not a count of the
  // other. Only the variable NAMES are printable, and not even those go here.
  const authed = Object.values(r.reviews).filter((v) => v.authenticated === true).length;
  if (authed > 0) L.push(`  authed   ${authed} url(s) audited WITH a credential (a different surface from the rest)`);
  L.push(`  wrote    ${path.join(r.root, REVIEWS)}`);
  L.push('  next     doorman dashboard   (reviewing is not approving: doorman allow <server>)');
  L.push('');
  return L.join('\n');
}
