/**
 * `doorman allow` - trusting a server by name, without inventing a grade.
 *
 * THE BUG THIS EXISTS FOR. The gate's block message said "Run: /vet
 * <server-url>". A connector only ever tells the gate the NAME, because
 * `mcp__<server>__<tool>` carries nothing else, so the single recovery path the
 * gate advertised did not work for the most common way people get blocked.
 *
 * The risk in fixing it is the opposite one: a command that makes unblocking
 * easy is a command that will be used constantly, and if it wrote a
 * plausible-looking grade the registry would fill up with measurements nobody
 * made. So the entry it writes is the point of these tests, more than the
 * unblocking is.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { allow, serverKeyFrom, registryDir, SCOPES } from '../cli/allow.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'doorman-home-'));

describe('allow: the key is whatever the user actually has');

// Every one of these is a real shape a user can be looking at when blocked.
check('a full tool name yields the server segment',
  serverKeyFrom('mcp__claude_ai_Notion__notion-search') === 'claude_ai_Notion');
check('underscores inside the server name survive',
  serverKeyFrom('mcp__claude_ai_Google_Calendar__list_events') === 'claude_ai_Google_Calendar');
check('a hyphenated server name survives',
  serverKeyFrom('mcp__claude-in-chrome__navigate') === 'claude-in-chrome');
check('a bare name is taken as-is',
  serverKeyFrom('claude_ai_Slack') === 'claude_ai_Slack');
check('empty input is refused rather than guessed',
  serverKeyFrom('  ') === null);

describe('allow: it records a DECISION, never a measurement');

{
  const H = home();
  const r = allow('mcp__claude_ai_Notion__notion-search', { home: H, env: {} });
  check('it writes', r.ok && r.key === 'claude_ai_Notion', JSON.stringify(r));

  const list = JSON.parse(readFileSync(join(H, '.doorman', 'registry', 'allowlist.json'), 'utf8'));
  const e = list.servers.claude_ai_Notion;

  check('decision is allow, so the gate lets it through', e.decision === 'allow');
  // The four assertions this file exists for.
  check('grade is NULL, not a letter', e.grade === null, JSON.stringify(e.grade));
  check('score is NULL, not a number', e.score === null, JSON.stringify(e.score));
  check('audit_id is NULL, because no audit happened', e.audit_id === null);
  check('basis says a human decided', e.basis === 'operator', e.basis);
  check('the entry says in words that it was not graded',
    /not graded/i.test(e.why), e.why);
  check('the file carries a note a future reader cannot miss',
    /never.*been graded/i.test(list.basis_note || ''), list.basis_note);

  // A mutant that wrote `grade: "A"` would pass every other test in this suite.
  check('no entry anywhere claims a grade it did not earn',
    Object.values(list.servers).every((s) => s.basis === 'graded' || s.grade === null));
}

describe('allow: a denial is not reversible by convenience');

{
  const H = home();
  const dir = join(H, '.doorman', 'registry');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'allowlist.json'), '{"servers":{}}');
  writeFileSync(join(dir, 'denylist.json'),
    '{"servers":{"webzum":{"decision":"deny","why":"injection in host_site.description"}}}');

  const r = allow('webzum', { home: H, env: {} });
  check('allowing a denylisted server is refused', !r.ok, JSON.stringify(r));
  check('and the refusal points at the recorded reason',
    /denylist/i.test(r.why) && /deliberate/i.test(r.why), r.why);

  const after = JSON.parse(readFileSync(join(dir, 'allowlist.json'), 'utf8'));
  check('nothing was written', Object.keys(after.servers).length === 0);
}

describe('allow: it does not clobber what is already there');

{
  const H = home();
  allow('one', { home: H, env: {} });
  allow('two', { home: H, env: {} });
  const list = JSON.parse(readFileSync(join(H, '.doorman', 'registry', 'allowlist.json'), 'utf8'));
  check('a second allow keeps the first', Object.keys(list.servers).sort().join(',') === 'one,two');

  const again = allow('one', { home: H, env: {} });
  check('allowing the same server twice is a no-op, not a duplicate',
    again.ok && again.already === true);

  check('a denylist is created so the gate has something to check against',
    existsSync(join(H, '.doorman', 'registry', 'denylist.json')));
}

describe('allow: scope decides blast radius');

{
  const H = home();
  const root = mkdtempSync(join(tmpdir(), 'doorman-proj-'));
  check('user scope is the default and covers every project',
    registryDir('user', { home: H, env: {} }).endsWith(join('.doorman', 'registry')));
  check('project scope writes beside the project',
    registryDir('project', { root, home: H, env: {} }) === join(root, 'registry'));

  const r = allow('scoped', { scope: 'project', root, home: H, env: {} });
  check('a project allow lands in the project', r.ok && r.dir === join(root, 'registry'));
  check('and not in the user list',
    !existsSync(join(H, '.doorman', 'registry', 'allowlist.json')));

  const bad = allow('x', { scope: 'plugin', root, home: H, env: {} });
  check('an unknown scope is refused rather than defaulted',
    !bad.ok && /scope must be/.test(bad.why), bad.why);
  check('the declared scopes are exactly user and project',
    SCOPES.join(',') === 'user,project');
}

describe('allow: it refuses to overwrite a file it cannot parse');

{
  const H = home();
  const dir = join(H, '.doorman', 'registry');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'allowlist.json'), '{ this is not json');
  const r = allow('anything', { home: H, env: {} });
  check('a corrupt allowlist stops the write', !r.ok && /not valid JSON/.test(r.why), r.why);
  check('and the file is left exactly as it was',
    readFileSync(join(dir, 'allowlist.json'), 'utf8') === '{ this is not json');
}

describe('allow: a boolean flag must not swallow the server name');

// `doorman allow --dry-run myserver` parsed as dry-run="myserver" with no
// server at all, and `doorman needs --json .` lost the path and then crashed.
// Flag-then-positional is the order people actually type.
{
  const H = home();
  const a = allow('myserver', { home: H, env: {}, dryRun: true });
  check('a dry run resolves the server and writes nothing',
    a.ok && a.key === 'myserver' && a.dryRun === true, JSON.stringify(a));
  check('and really wrote nothing',
    !existsSync(join(H, '.doorman', 'registry', 'allowlist.json')));
}
