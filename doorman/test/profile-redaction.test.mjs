/**
 * The export gate.
 *
 * This is the only test in the profile set that is about somebody else's
 * safety rather than our correctness, so it is the one to mutation-check.
 * Two halves: the rules fire on real shapes, and the vendored copy has not
 * drifted from its parent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, describe } from './harness.mjs';
import { scan, redact, sanitise, DENY, INHERITED, ADDED, HOST_ALLOWLIST } from '../src/profile/redaction.mjs';

const fires = (s) => scan(s).map((h) => h.rule);
const firesOn = (s, rule) => fires(s).includes(rule);

describe('profile redaction: the rules fire');

// Built with String.raw so a backslash survives. Written as a literal rather
// than through a shell, because a heredoc ate a backslash twice in this
// repo's history and turned a real pattern into one that matched nothing.
const WINPATH = String.raw`C:\Users\bob\acme\notes.md`;
check('a windows drive path fires', firesOn(WINPATH, 'abs_path'), WINPATH);
check('a forward-slash drive path fires', firesOn('C:/Users/bob/x', 'abs_path'));
check('a mac home path fires', firesOn('/Users/bob/x', 'abs_path'));
check('a linux home path fires', firesOn('/home/bob/x', 'abs_path'));
check('a repo-relative path does NOT fire',
  !firesOn('.claude/agents/helper.md:12', 'abs_path'),
  'receipts are the one path shape an export is allowed to carry');

check('an email fires', firesOn('bob@acme.co', 'email'));
check('an npm spec does NOT fire as an email',
  !firesOn('vite@7.3.2', 'email'),
  'the parent narrowed this after ten false positives; the narrowing must survive vendoring');

check('a 1Password reference fires', firesOn('op://vault/item/cred', 'secret'));
check('a github token fires', firesOn('ghp_abcdefghijklmnop', 'secret'));
check('a private key header fires', firesOn('-----BEGIN RSA PRIVATE KEY-----', 'secret'));

check('a git ssh remote fires', firesOn('git@github.com:acme/secret.git', 'git_remote'));
check('a git https remote fires', firesOn('https://github.com/acme/secret.git', 'git_remote'));
check('a commit trailer fires', firesOn('Co-Authored-By: someone', 'git_author'));

check('a session uuid fires', firesOn('7998505e-3a16-4637-b200-b69a81d6cc3d', 'session_id'));

check('a private host fires', firesOn('https://internal.acme.corp/mcp', 'foreign_host'));
check('an allowlisted host does NOT fire',
  !firesOn('https://github.com/clemenswan/clembot-doorman', 'foreign_host'));
check('every allowlisted host is actually allowed',
  HOST_ALLOWLIST.every((h) => !firesOn(`https://${h}/x`, 'foreign_host')),
  'a host on the list that still trips its own rule would be a silent drop');

check('clean structural text fires nothing',
  scan('{"agents":3,"state":"pass","receipt":".claude/settings.json:2"}').length === 0);

describe('profile redaction: dropping, not masking');

check('a tripping string is dropped entirely', (() => {
  const out = redact({ a: 'bob@acme.co', b: 'fine' });
  return out.a === undefined && out.b === 'fine';
})(), 'a mask still reveals the length and the position');

check('a tripping KEY drops the whole entry', (() => {
  const out = redact({ 'clients/laguna': 1, ok: 2 });
  return out['clients/laguna'] === undefined && out.ok === 2;
})(), 'a key named for a client leaks whatever it points at');

check('nested values are reached', (() => {
  const out = redact({ a: { b: { c: 'op://x/y' } } });
  return out.a.b.c === undefined;
})());

check('array members are dropped individually', (() => {
  const out = redact({ xs: ['fine', 'bob@acme.co', 'also fine'] });
  return out.xs.length === 2 && !out.xs.includes('bob@acme.co');
})());

check('numbers and booleans pass through', (() => {
  const out = redact({ n: 5, t: true, z: null });
  return out.n === 5 && out.t === true && out.z === null;
})());

describe('profile redaction: a redacted profile says so');

check('the count and the rules ride along', (() => {
  const out = sanitise({ a: 'bob@acme.co', b: 'op://x', c: 'fine' });
  return out.redacted_count === 2 && out.complete === false
    && out.redacted_rules.includes('email') && out.redacted_rules.includes('secret');
})());

check('a clean profile is marked complete', (() => {
  const out = sanitise({ agents: 3, letter: 'B' });
  return out.redacted_count === 0 && out.complete === true;
})(), 'a censored profile must never be compared against a full one as though it were');

check('the windows path is dropped from a realistic profile', (() => {
  const out = sanitise({ slug: 'acme', root: WINPATH, receipt: '.claude/settings.json:2' });
  return out.root === undefined && out.receipt === '.claude/settings.json:2' && out.complete === false;
})());

describe('profile redaction: drift from the parent');

// The parent is absent from an installed package, and skipping THEN is
// correct: it is the one moment a vendored copy is legitimately on its own.
//
// THIS SKIP ALREADY ROTTED ONCE, and the reason is worth keeping. The single
// path was `process.cwd()/../../.claude/worktrees/feat-clembot-site/...`,
// which was true when written and then stopped being true two ways at once:
// the branch merged, so the worktree was removed, and the path was relative to
// a CWD that changes with how the suite is invoked. The check went permanently
// green by skipping, which is the failure mode a drift guard exists to prevent.
//
// So: resolve from this file, try every layout the parent has actually lived
// in, accept an explicit override, and NAME WHAT WAS TRIED in the skip
// message. A skip that does not say where it looked cannot be audited, and
// that silence is what let a dead path pass for a clean bill of health.
const HERE = dirname(fileURLToPath(import.meta.url));
const REL = join('wanessalabs-astro', 'scripts', 'lib', 'redaction.mjs');

const CANDIDATES = [
  // An explicit pointer always wins. This is how the check runs on a machine
  // where the vault is not reachable by any relative path, which is the normal
  // case: the parent lives in a DIFFERENT repository, not a sibling directory.
  process.env.DOORMAN_REDACTION_PARENT,
  // The vault checkout, if the harness tells us where it is.
  process.env.CLAUDE_PROJECT_DIR && join(process.env.CLAUDE_PROJECT_DIR, REL),
  // Merged into the vault's main checkout, which is where it lives today.
  join(HERE, '..', '..', '..', '..', REL),
  // The historical worktree layout, kept so an older checkout still measures.
  join(HERE, '..', '..', '..', '..', '.claude', 'worktrees', 'feat-clembot-site', REL),
].filter(Boolean);

const PARENT = CANDIDATES.find((p) => existsSync(p));

if (!PARENT) {
  // Printed with console.log, NOT as a check detail: the harness shows `detail`
  // only on failure, so a passing skip's note is invisible. That is precisely
  // how this check stayed quiet while pointing at a path that no longer
  // existed. The skip has to be legible in the output or it is not a skip, it
  // is a silence.
  console.log('  SKIP  drift from the parent: no parent source found');
  for (const c of CANDIDATES) console.log(`          tried ${c}`);
  console.log('          set DOORMAN_REDACTION_PARENT to measure drift here');
  check('parent source absent, drift check skipped', true);
} else {
  console.log(`  ....  drift measured against ${PARENT}`);
  const src = readFileSync(PARENT, 'utf8');
  const rows = [...src.matchAll(/\[\s*'([a-z_]+)',\s*(\/.*\/),\s*(true|false)\s*,?\s*\]/g)]
    .map((m) => [m[1], m[2], m[3] === 'true']);

  check('the parent parsed into rows', rows.length > 0, `${rows.length} rows`);
  check('every inherited rule still exists upstream',
    INHERITED.every(([name]) => rows.some(([n]) => n === name)),
    'a rule deleted upstream must not live on here unnoticed');

  check('every inherited pattern is byte-identical', (() => {
    for (const [name, re, ci] of INHERITED) {
      const up = rows.find(([n]) => n === name);
      if (!up) return false;
      if (`/${re.source}/${re.flags.replace('g', '')}` !== up[1] && `/${re.source}/` !== up[1]) return false;
      if (ci !== up[2]) return false;
    }
    return true;
  })(), 'if this fails, change the rule THERE first and re-vendor');

  check('rules added here are not claimed to be inherited',
    ADDED.every(([name]) => !rows.some(([n]) => n === name)),
    'a local addition that later appears upstream should move to INHERITED');

  check('DENY is exactly inherited plus added',
    DENY.length === INHERITED.length + ADDED.length);
}
