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
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { doctor } from './doctor.mjs';
import { diagnose, report } from './report.mjs';

export { diagnose };

const REVIEWS = path.join('.doorman', 'reviews.json');

export function readReviews(root) {
  const file = path.join(root, REVIEWS);
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

const slug = (url) => url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9.-]+/g, '_').slice(0, 80);

export async function reviewServers(root, {
  servers, reportImpl = report, log = () => {}, now = () => new Date().toISOString(), concurrency = 4,
} = {}) {
  const reviews = readReviews(root);
  const skipped = [];
  const urls = [];
  for (const s of servers) {
    if (s.transport === 'claude.ai') { skipped.push({ gateName: s.gateName, why: 'claude.ai connector: its url and login are held by the account, not this machine' }); continue; }
    if (!/^https?:\/\//.test(s.target || '')) { skipped.push({ gateName: s.gateName, why: `${s.transport || 'unknown'} server: review never executes a local command` }); continue; }
    if (!urls.includes(s.target)) urls.push(s.target);
  }

  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      log(`reviewing ${url}`);
      const out = path.join(root, '.doorman', 'reviews', slug(url));
      let r;
      try { r = await reportImpl({ link: url, out, log: () => {} }); } catch (e) { r = { ok: false, detail: e.message }; }
      if (r.ok) {
        const g = r.grade;
        reviews[url] = { url, reviewed_at: now(), status: 'graded', band: g.band, score: g.score,
          hard_fail: g.hard_fail ?? null, static_partial: g.static_partial ?? null, out };
      } else {
        const d = diagnose(`${r.why ?? ''}\n${r.detail ?? ''}`);
        reviews[url] = { url, reviewed_at: now(), status: d.status, hint: d.hint,
          detail: String(r.detail ?? r.why ?? '').slice(-400) };
      }
      log(`  ${reviews[url].status}${reviews[url].band ? ' ' + reviews[url].band : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  mkdirSync(path.join(root, '.doorman'), { recursive: true });
  writeFileSync(path.join(root, REVIEWS), JSON.stringify(reviews, null, 2), 'utf8');
  return { ok: true, root, reviewed: urls.length, reviews, skipped };
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
  L.push(`  wrote    ${path.join(r.root, REVIEWS)}`);
  L.push('  next     doorman dashboard   (reviewing is not approving: doorman allow <server>)');
  L.push('');
  return L.join('\n');
}
