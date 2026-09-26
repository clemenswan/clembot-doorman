/**
 * The export gate. Nothing leaves the machine unless it passes this.
 *
 * ── VENDORED, and that is a risk this file has to carry openly ───────────────
 *
 * The parent is `wanessalabs-astro/scripts/lib/redaction.mjs`, which is itself
 * a copy of `marketing-bootstrap/scripts/lib/site-redaction.js`. Its own header
 * says the danger out loud: "Two publishers with two copies of a security rule
 * is how one of them ends up a version behind." This is now the third copy.
 *
 * It is vendored anyway for the reason `injection.mjs` is vendored: the npm
 * package ships `doorman/` and nothing else, so an installed user has no
 * sibling worktree to import from, and a security control that only works in
 * the author's checkout is not a control. `test/profile-redaction.test.mjs`
 * parses the parent and fails when the INHERITED rows diverge, and skips
 * itself when the parent is absent, which is the only moment a copy is
 * legitimately on its own.
 *
 * ── Tuned for structure, not prose ───────────────────────────────────────────
 *
 * The parent loosened two rules against a corpus of English lineage entries:
 * `email` was matching npm specs like `vite@7.3.2`, and `slack_id` was matching
 * ALL-CAPS words. A profile is generated JSON with no prose in it, so neither
 * false positive can occur here and the narrowings buy nothing. They are kept
 * anyway rather than reverted, because a rule that differs between two copies
 * is worse than a rule that is slightly loose in one of them.
 *
 * ── Added here, absent upstream ──────────────────────────────────────────────
 *
 * Four rows the parent never needed because it never published a machine
 * profile: session ids, git remotes, git author identity, and hostnames that
 * are not on a short public allowlist. Rows are additive, so the drift test
 * still works: it compares the inherited rows by name and ignores new ones.
 */

/** Hosts a profile may name. Everything else is somebody's private infra. */
export const HOST_ALLOWLIST = [
  'github.com', 'gitlab.com', 'npmjs.com', 'registry.npmjs.org',
  'anthropic.com', 'claude.com', 'modelcontextprotocol.io',
  'scorecard.wanessalabs.com', 'clembot-doorman.wanessalabs.com',
  'example.invalid',
];

/** Inherited from the parent, verbatim. Change these THERE first. */
export const INHERITED = [
  ['slack_id', /\b[UC](?=[A-Z0-9]*\d)[A-Z0-9]{8,}\b/, false],
  ['notion_uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, true],
  ['notion_compact', /\b[0-9a-f]{32}\b/, true],
  ['postiz_id', /\bcm[a-z0-9]{20,}\b/, true],
  ['email', /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/, false],
  ['abs_path', /\b[A-Za-z]:[\\/]|\/home\/[a-z]|\/Users\//, true],
  ['secret', /xoxb-|xoxp-|ntn_|ghp_|\bsk-[A-Za-z0-9]|op:\/\/|BEGIN [A-Z ]*PRIVATE KEY/, true],
  ['client', /\blaguna\b|\biovi\b|clients\//, true],
  ['pid', /\bpid \d{3,}/, true],
  ['ccr_trigger', /\btrig_[A-Za-z0-9]{16,}\b/, true],
  ['gcp_project', /\bgcp\s+project\b[^\n]{0,24}\d{6,}|\bclemvault-workspace-cli\b/, true],
  ['env_assign', /\b[A-Z][A-Z0-9_]{5,}=(?!\s|$)[^\s`]+/, false],
];

/** Added for the profile export. Not in the parent. */
export const ADDED = [
  // A session id ties an exported profile back to a transcript on disk.
  ['session_id', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bsessionId\b/, true],
  ['git_remote', /\bgit@[\w.-]+:|\bhttps?:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\.git\b/, true],
  ['git_author', /\bAuthor:\s|\bCo-Authored-By:\s/, true],
  // Any host that is not on the allowlist. Built as one alternation so a
  // profile naming a private registry or an internal gateway trips it.
  ['foreign_host', new RegExp(
    String.raw`\bhttps?:\/\/(?!(?:www\.)?(?:${HOST_ALLOWLIST.map((h) => h.replace(/\./g, '\\.')).join('|')})\b)[\w.-]+\.[a-z]{2,}`,
    'i',
  ), true],
];

export const DENY = [...INHERITED, ...ADDED];

/** Returns [{ rule, samples }]. An empty array means clean. Same shape as the parent. */
export function scan(text) {
  const hits = [];
  for (const [name, pattern, ci] of DENY) {
    const re = new RegExp(pattern.source, ci ? 'gi' : 'g');
    const found = String(text).match(re);
    if (found) hits.push({ rule: name, samples: [...new Set(found)].slice(0, 5) });
  }
  return hits;
}

/**
 * Walk a value and drop every string that trips a rule.
 *
 * Dropped, never masked. A masked value still says how long the secret was and
 * where it sat; a dropped key says only that something was removed. The count
 * rides along so a redacted profile is VISIBLY not a full one, which is the
 * property that keeps somebody from comparing a censored profile against a
 * complete reference and reading the difference as a finding.
 *
 * Keys are scanned as well as values: a key named for a client is a leak
 * whatever it points at.
 */
export function redact(value, state = { count: 0, rules: new Set() }) {
  const trips = (s) => {
    const hits = scan(s);
    if (!hits.length) return false;
    state.count++;
    for (const h of hits) state.rules.add(h.rule);
    return true;
  };

  if (typeof value === 'string') return trips(value) ? undefined : value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, state)).filter((v) => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (trips(k)) continue;
      const r = redact(v, state);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

/** Redact a profile and stamp it with what was removed. */
export function sanitise(profile) {
  const state = { count: 0, rules: new Set() };
  const clean = redact(profile, state);
  return {
    ...clean,
    redacted_count: state.count,
    redacted_rules: [...state.rules].sort(),
    complete: state.count === 0,
  };
}
