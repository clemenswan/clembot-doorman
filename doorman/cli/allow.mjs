/**
 * `doorman allow <server>` - record a decision to trust a server.
 *
 * WHY THIS EXISTS. When the gate blocks something it said "Run: /vet
 * <server-url>". For a connector like `claude_ai_Notion` there IS no url: the
 * user has a server NAME, because that is all `mcp__<server>__<tool>` carries.
 * So the single recovery path the gate advertised did not work for the most
 * common way people get blocked, and the honest fix is a command that takes the
 * thing the user actually has.
 *
 * THIS RECORDS A DECISION, NOT A MEASUREMENT, and the two must never be
 * confused six months later:
 *
 *   basis: "operator"   a human chose to trust it. grade and score are null.
 *   basis: "graded"     doorman measured it. Only `/vet` and the poller write this.
 *
 * A null grade is the same rule the grader follows for an unmeasured layer,
 * applied to the registry. Writing "A" here because something feels fine would
 * be fabricating a grade, which is invariant 9.
 *
 * It never writes the shipped registry, and it never touches a denylist:
 * un-denying something has to be deliberate and manual, because a denial was
 * earned by an audit and this command is for the easy direction only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const SCOPES = ['user', 'project'];

/** Where a scope's registry lives. Never the plugin's own. */
export function registryDir(scope, { root = process.cwd(), home = homedir(), env = process.env } = {}) {
  if (scope === 'project') return join(root, 'registry');
  return join(env.DOORMAN_HOME || home, '.doorman', 'registry');
}

/** The server key the gate will actually look up, from whatever was typed. */
export function serverKeyFrom(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  // Accept a full tool name, since that is what the block message shows.
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(s);
  if (m) return m[1];
  return s.replace(/^mcp__/, '').replace(/__.*$/, '');
}

const EMPTY_DENY = { version: 1, note: 'Servers refused here. Deny always beats allow.', servers: {} };

export function allow(server, {
  scope = 'user', root = process.cwd(), home = homedir(), env = process.env, why = null, dryRun = false,
} = {}) {
  const key = serverKeyFrom(server);
  if (!key) return { ok: false, why: 'no server name given' };
  if (!SCOPES.includes(scope)) return { ok: false, why: `scope must be one of: ${SCOPES.join(', ')}` };

  const dir = registryDir(scope, { root, home, env });
  const allowPath = join(dir, 'allowlist.json');
  const denyPath = join(dir, 'denylist.json');

  let list = { version: 1, servers: {} };
  if (existsSync(allowPath)) {
    try { list = JSON.parse(readFileSync(allowPath, 'utf8')); } catch {
      return { ok: false, why: `${allowPath} exists but is not valid JSON. Fix or move it; refusing to overwrite.` };
    }
    if (!list.servers) list.servers = {};
  }

  // A deny in THIS registry is a decision someone made. Do not quietly reverse it.
  if (existsSync(denyPath)) {
    try {
      const deny = JSON.parse(readFileSync(denyPath, 'utf8'));
      if (deny?.servers?.[key]) {
        return {
          ok: false,
          why: `'${key}' is on the denylist in ${denyPath}. Allowing it has to be a deliberate edit, ` +
               'not a side effect of this command. Read the reason recorded there first.',
        };
      }
    } catch { /* an unreadable denylist is handled by the gate, not here */ }
  }

  const existing = list.servers[key];
  if (existing && existing.decision === 'allow') {
    return { ok: true, key, dir, already: true, entry: existing };
  }

  const entry = {
    decision: 'allow',
    // Explicit nulls. Not "pending", not a placeholder letter.
    grade: null,
    score: null,
    audit_id: null,
    basis: 'operator',
    why: why || 'Trusted by the operator. NOT graded by doorman.',
    added_at: new Date().toISOString(),
  };

  if (dryRun) return { ok: true, key, dir, dryRun: true, entry };

  list.version = 1;
  list.basis_note = 'Entries with basis "operator" were allowed by a human and have NEVER ' +
    'been graded: grade and score are null because nothing measured them. An operator allow ' +
    'records a decision, not evidence about the server.';
  list.servers[key] = entry;

  mkdirSync(dir, { recursive: true });
  writeFileSync(allowPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
  if (!existsSync(denyPath)) writeFileSync(denyPath, JSON.stringify(EMPTY_DENY, null, 2) + '\n', 'utf8');

  return { ok: true, key, dir, entry, path: allowPath, count: Object.keys(list.servers).length };
}

export function renderAllow(r) {
  if (!r.ok) return `allow failed: ${r.why}`;
  if (r.already) return `'${r.key}' is already allowed in ${r.dir}. Nothing changed.`;
  if (r.dryRun) return `would allow '${r.key}' in ${r.dir} (basis: operator, grade: null)`;
  return [
    `allowed '${r.key}'`,
    `  ${r.path}`,
    `  basis   operator  (a decision you made, not a measurement)`,
    `  grade   null      (nothing has graded this server)`,
    `  now     ${r.count} server(s) trusted here`,
    '',
    'This unblocks the gate. It says nothing about whether the server is safe.',
    `To find out for free: doorman report <url>`,
  ].join('\n');
}
