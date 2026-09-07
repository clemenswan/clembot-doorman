/**
 * What kind of thing are we being asked to vet?
 *
 * ── Syntactic, and offline ───────────────────────────────────────────────────
 *
 * The obvious implementation probes the URL and sees whether it speaks MCP.
 * This does not, for two reasons. CI has to run with no network, and a probe
 * would mean connecting to an unvetted endpoint as the FIRST thing we do,
 * before anything has decided the candidate is worth touching at all.
 *
 * So detection reads the string. It will occasionally be wrong, which is why
 * `--type` exists and why the type is printed in the report.
 *
 * ── Why the type decides the money ───────────────────────────────────────────
 *
 * Only `mcp-server` may reach the paid scorecard. A skill or a repo has no
 * tools to drive, so a behavioural grade is not a thing that can exist for it,
 * and the report says `behavioral grade: n/a` rather than implying one ran.
 * `mayBeGraded()` is the single place that rule lives.
 */

export const CANDIDATE_TYPES = ['mcp-server', 'skill', 'repo'];

/** Only this type may ever be sent to the paid scorecard. */
export function mayBeGraded(type) {
  return type === 'mcp-server';
}

export class CandidateError extends Error {}

/**
 * @param {string} input  a url, or a local path to a markdown file
 * @param {object} [opts] `{ type }` forces the answer
 * @returns {{ id, type, kind, host, forced }}
 */
export function detectCandidate(input, { type } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new CandidateError('no candidate given');

  if (type !== undefined) {
    if (!CANDIDATE_TYPES.includes(type)) {
      throw new CandidateError(
        `unknown --type ${JSON.stringify(type)}; must be one of ` + CANDIDATE_TYPES.join(', '),
      );
    }
    return { id: raw, type, host: hostOf(raw), forced: true };
  }

  // A local path. Only markdown is a skill; anything else we decline to guess
  // about rather than sending a directory to the grader.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (/\.md$/i.test(raw)) return { id: raw, type: 'skill', host: null, forced: false };
    throw new CandidateError(
      `"${raw}" is not a url and is not a .md file, so its type cannot be inferred. ` +
      'Pass --type mcp-server|skill|repo.',
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CandidateError(`"${raw}" is not a valid url`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CandidateError(`unsupported scheme ${url.protocol} in "${raw}"`);
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');

  // A gist is a skill. A raw .md anywhere is a skill.
  if (host === 'gist.github.com' || /\.md$/i.test(path)) {
    return { id: raw, type: 'skill', host, forced: false };
  }

  if (host === 'github.com' || host === 'www.github.com') {
    const segments = path.split('/').filter(Boolean);
    // /owner/repo/blob/... points at a file, which is a skill, not a repo.
    if (segments.length >= 4 && (segments[2] === 'blob' || segments[2] === 'raw')) {
      return { id: raw, type: 'skill', host, forced: false };
    }
    if (segments.length >= 2) {
      return { id: raw, type: 'repo', host, forced: false };
    }
    // github.com with one segment or none is a user or the site itself.
    throw new CandidateError(
      `"${raw}" points at github.com but names no repository. ` +
      'Pass --type, or give a full owner/repo url.',
    );
  }

  // Everything else that is an http(s) endpoint is treated as an MCP server.
  // This is the only branch that can lead to a paid grade, and it is the
  // default rather than a special case because that is what people paste.
  return { id: raw, type: 'mcp-server', host, forced: false };
}

function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A filesystem-safe slug for the review note filename.
 *
 * Uses the FULL hostname for a url. The scorecard's poller learned this the
 * hard way: keying on the first label collapsed every `mcp.<vendor>.com` onto
 * the key `mcp`, so allowlisting one vendor silently allowlisted another. A
 * filename is not a trust decision, but two candidates sharing a note file
 * would overwrite each other's evidence, which is bad in the same direction.
 */
export function candidateSlug(candidate) {
  const raw = candidate.id ?? String(candidate);
  let base;
  try {
    const u = new URL(raw);
    base = u.hostname + u.pathname;
  } catch {
    base = raw.replace(/^.*[\\/]/, '');           // a local path: keep the filename
  }
  const slug = base
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'candidate';
}
