/**
 * POST /popularity/subject - say what a graded server should be counted by.
 *
 * WHY THIS IS AUTHENTICATED WHEN EVERY OTHER WRITE-ADJACENT READ IS FREE. The
 * mapping decides which npm package's downloads get published as this server's
 * popularity. Point it at the wrong package and the feed reports a stranger's
 * numbers under your server's name, confidently and with a timestamp. That is
 * a data-integrity write, not a suggestion, so it takes the same shared secret
 * the runner uses to post grades.
 *
 * IT DOES NOT FETCH ANYTHING. The mapping is recorded; the next scheduled
 * sweep reads it. Fetching here would make a failed lookup look like a
 * rejected mapping, and they are different problems with different fixes.
 */

import { type Env, json, err } from '../index.js';
import { SOURCES } from '../popularity.js';
import { serverKey } from '../popularity.js';

/** Same comparison the runner uses. Timing-safe because it guards a write. */
function authed(req: Request, env: Env): boolean {
  const header = req.headers.get('authorization') ?? '';
  if (!env.RUNNER_TOKEN) return false;
  const presented = header.replace(/^Bearer\s+/i, '');
  if (presented.length !== env.RUNNER_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ env.RUNNER_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

export interface LinkBody {
  server_url?: string;
  source?: string;
  subject?: string;
}

export async function handleLinkSubject(req: Request, env: Env): Promise<Response> {
  if (!authed(req, env)) return err('unauthorized', 401);

  let body: LinkBody;
  try {
    body = await req.json() as LinkBody;
  } catch {
    return err('body must be JSON');
  }

  const key = serverKey(body.server_url);
  if (!key) return err('server_url is required and must be a url');

  const source = String(body.source ?? '');
  if (!(source in SOURCES)) {
    return err('source must be one of: ' + Object.keys(SOURCES).join(', '));
  }

  const subject = String(body.subject ?? '').trim();
  if (!subject) return err('subject is required');
  // A GitHub subject is owner/repo. Accepting a bare name here would sweep
  // https://api.github.com/repos/foo, get a 404, and record nothing forever
  // while the mapping row sat there looking correct.
  if (source === 'github' && !/^[\w.-]+\/[\w.-]+$/.test(subject)) {
    return err('github subject must be owner/repo');
  }

  await env.DB.prepare(
    'INSERT OR REPLACE INTO popularity_subject (server_key, source, subject, added_at) ' +
    'VALUES (?, ?, ?, ?)',
  ).bind(key, source, subject, new Date().toISOString()).run();

  return json({
    ok: true,
    server_key: key,
    source,
    subject,
    note: 'Recorded. Nothing was fetched: the next scheduled sweep takes the ' +
      'first reading, and a trend needs two, so this server has no trend for ' +
      'at least another sweep after that.',
  });
}
