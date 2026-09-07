/**
 * Fetch the instruction text of a skill or a repo.
 *
 * This is the only other file allowed to touch the network, and it is
 * deliberately dull: one GET, a size cap, no redirect chasing beyond what fetch
 * does on its own, no execution of anything.
 *
 * ── The text is DATA ─────────────────────────────────────────────────────────
 *
 * What comes back is somebody else's instruction text, which is precisely the
 * kind of content that might be trying to talk to a reading agent. Nothing here
 * interprets it, summarises it, or passes it to a model. It goes to the pattern
 * scanner and into the note as a quoted excerpt. Handing it to an LLM for a
 * "what does this skill do" summary would be reading the letter, which is the
 * thing this project exists to refuse.
 *
 * ── Why the fit review still sees the candidate's own words ──────────────────
 *
 * The fit review gets the candidate's SELF-DESCRIPTION, which is short and
 * clearly labelled as a claim. That is different from feeding a model an entire
 * untrusted README.
 */

import { readFileSync } from 'node:fs';

/** A README past this is not being read by a human either. */
export const MAX_INSTRUCTION_BYTES = 200_000;

export class InstructionFetchError extends Error {}

/**
 * Turn a candidate into the url that actually serves its text.
 *
 * github.com/owner/repo         -> the raw README on the default branch
 * github.com/owner/repo/blob/.. -> the raw file
 * gist.github.com/u/id          -> the gist's raw endpoint
 * anything ending .md           -> itself
 */
export function instructionUrl(candidate) {
  const raw = candidate.id;
  if (!/^https?:\/\//i.test(raw)) return { kind: 'file', target: raw };

  const u = new URL(raw);
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);

  if (host === 'github.com' || host === 'www.github.com') {
    if (segments.length >= 4 && (segments[2] === 'blob' || segments[2] === 'raw')) {
      const [owner, repo, , ...rest] = segments;
      return {
        kind: 'http',
        target: `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`,
      };
    }
    const [owner, repo] = segments;
    // Branch name is not knowable without an API call, and an API call needs a
    // token. Try the two names that cover essentially everything, in order.
    return {
      kind: 'http',
      target: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
      alternates: [
        `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
      ],
    };
  }

  if (host === 'gist.github.com') {
    return { kind: 'http', target: raw.replace(/\/$/, '') + '/raw' };
  }

  return { kind: 'http', target: raw };
}

/**
 * @param {object} candidate  from detectCandidate
 * @param {object} [deps]     `{ fetch, readFile }` injectable for tests
 * @returns {Promise<{ text, source, bytes, truncated }>}
 */
export async function fetchInstructions(candidate, { fetch: f = fetch, readFile = readFileSync, timeoutMs = 20_000 } = {}) {
  const plan = instructionUrl(candidate);

  if (plan.kind === 'file') {
    let text;
    try {
      text = readFile(plan.target, 'utf8');
    } catch (e) {
      throw new InstructionFetchError(`could not read ${plan.target}: ${e.message}`);
    }
    return capped(text, plan.target);
  }

  const targets = [plan.target, ...(plan.alternates ?? [])];
  const failures = [];

  for (const target of targets) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await f(target, { signal: ac.signal, redirect: 'follow' });
    } catch (e) {
      failures.push(`${target}: ${e.message}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      failures.push(`${target}: HTTP ${res.status}`);
      continue;
    }
    const text = await res.text();
    return capped(text, target);
  }

  throw new InstructionFetchError(
    'could not fetch instruction text.\n  ' + failures.join('\n  '),
  );
}

function capped(text, source) {
  const bytes = Buffer.byteLength(text, 'utf8');
  const truncated = bytes > MAX_INSTRUCTION_BYTES;
  return {
    // Truncation is reported rather than hidden. A scanner that silently read
    // the first 200 KB of a 900 KB file would report "clean" about 22% of a
    // document.
    text: truncated ? text.slice(0, MAX_INSTRUCTION_BYTES) : text,
    source,
    bytes,
    truncated,
  };
}
