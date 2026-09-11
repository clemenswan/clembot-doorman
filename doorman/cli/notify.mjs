/**
 * The push half of the subscription.
 *
 * WHAT "PUSH" HONESTLY MEANS HERE. Nobody can push to a laptop behind NAT that
 * is asleep half the day, and a doorman that opened a socket to wait for us
 * would be a worse product than one that does not. So the push is not a new
 * transport: it is the POLL BECOMING INVISIBLE. A SessionStart hook reads a
 * digest that is already on disk and costs nothing, then fires a detached
 * refresh so the NEXT session is current. From where the operator sits they
 * never ran a command and the doorman told them anyway, which is the whole
 * claim, and it is true.
 *
 * THREE RULES, AND EACH ONE IS A NOTIFICATION PRODUCT FAILING IF BROKEN:
 *
 * 1. SILENT WHEN THERE IS NOTHING. No digest file is written when nothing is
 *    new. A hook that prints "nothing new" at every session start teaches the
 *    operator to skip past the one session where it matters.
 *
 * 2. THE FIRST RUN SAYS NOTHING. With no cursor the feed returns everything
 *    graded so far. Announcing 26 rows as "new" the first time a plugin loads
 *    is not news, it is a catalogue nobody asked for. The first refresh
 *    establishes the cursor and writes no digest.
 *
 * 3. CONSUMED ONCE. The hook prints the digest and deletes it. Re-showing the
 *    same three servers every morning is how a notification becomes furniture.
 *
 * The network never runs inside the hook. A SessionStart hook that waits on a
 * fetch makes every session start as slow as the slowest network it has ever
 * been on, and offline it makes them all fail.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { watch, readState, writeState, DEFAULT_API, DEFAULT_STATE } from './watch.mjs';

export const DEFAULT_DIGEST = join('.doorman', 'notify.md');

/** How many rows the digest will name before it stops listing and counts. */
export const MAX_LISTED = 3;

/**
 * The digest, or null for "say nothing".
 *
 * Only two verdicts are ever worth interrupting a session for. `unreviewed` is
 * something you could adopt and have not looked at. `blocked` is something the
 * registry already refuses, and seeing it in a fresh grade is a reason to check
 * whether anyone tried. `already-installed` and `skipped` are not news: the
 * first is a server you have, and the second you decided about.
 */
export function renderNotify(result, { firstRun = false } = {}) {
  if (firstRun) return null;

  const rows = result.candidates ?? [];
  const fresh = rows.filter((c) => c.verdict === 'unreviewed' && !c.is_fixture && !c.self_graded);
  const blocked = rows.filter((c) => c.verdict === 'blocked');
  if (!fresh.length && !blocked.length) return null;

  const out = [];
  out.push('## doorman');
  out.push('');

  if (fresh.length) {
    const shown = fresh.slice(0, MAX_LISTED);
    const noun = fresh.length === 1 ? 'server' : 'servers';
    out.push(`${fresh.length} newly graded ${noun} this build does not have:`);
    for (const c of shown) {
      // The grade travels with what produced it. A letter with no model behind
      // it invites a comparison across models that the grade cannot support.
      const model = c.model ? ` on ${c.model}` : ', model not recorded';
      const score = c.score === null || c.score === undefined ? 'not scored' : `${c.score}/100`;
      out.push(`- **${c.grade ?? '?'}** ${score}${model} ${c.server_url}`);
      const layers = c.layers ?? {};
      const missing = ['behavioral_pct', 'guidance_pct']
        .filter((k) => layers[k] === null || layers[k] === undefined)
        .map((k) => k.replace('_pct', ''));
      if (missing.length) out.push(`  not measured: ${missing.join(', ')}`);
    }
    if (fresh.length > shown.length) {
      out.push(`- and ${fresh.length - shown.length} more`);
    }
    out.push('');
  }

  if (blocked.length) {
    out.push(`${blocked.length} on your denylist were re-graded. Run \`doorman watch\` for the detail.`);
    out.push('');
  }

  out.push('Run `doorman needs` to see which of these answer something this build ' +
           'keeps asking for, or `doorman watch` for the full list. Nothing has been ' +
           'installed and nothing was sent anywhere: the match runs on this machine.');
  return out.join('\n');
}

/**
 * Fetch, classify, and leave a digest for the next session to find.
 *
 * Advances the cursor whether or not a digest is written, because the cursor
 * tracks what has been SEEN by the subscription rather than what was worth
 * mentioning. Not advancing it on a quiet day would re-announce the same rows
 * the moment something interesting finally landed.
 */
export async function refreshNotify({
  root = process.cwd(), api = DEFAULT_API, limit = 50,
  stateFile, digestFile, fetchImpl = fetch,
} = {}) {
  const state = stateFile ?? join(root, DEFAULT_STATE);
  const digest = digestFile ?? join(root, DEFAULT_DIGEST);

  const prior = readState(state);
  const firstRun = !prior.since;

  const result = await watch({ root, api, since: prior.since, limit, fetchImpl });
  const text = renderNotify(result, { firstRun });

  if (text) {
    mkdirSync(dirname(digest), { recursive: true });
    writeFileSync(digest, text + '\n', 'utf8');
  }

  if (result.next_since) {
    writeState(state, { since: result.next_since, seen: (prior.seen ?? 0) + result.candidates.length });
  }

  return { wrote: Boolean(text), firstRun, digest, candidates: result.candidates.length };
}

/**
 * What the hook prints. Reading is destructive on purpose: see rule 3.
 *
 * Any failure here returns nothing rather than throwing. This runs at session
 * start, and a notification that can break a session start is worse than no
 * notification.
 */
export function consumeDigest(file) {
  try {
    if (!file || typeof file !== 'string') return null;
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8').trim();
    unlinkSync(file);
    return text || null;
  } catch {
    return null;
  }
}
