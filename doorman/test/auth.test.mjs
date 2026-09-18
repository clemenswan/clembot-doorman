/**
 * Per-server credentials for a `doorman review` sweep.
 *
 * `.doorman/tokens.json` maps a server to the NAME of an environment variable.
 * Never to a token. That is the single rule, and most of this file is the
 * negative half of it: one distinctive token value is planted in a fake
 * environment and then looked for in every artifact a reader or a repo could
 * end up holding.
 *
 * The other rule is that a mapped-but-unset variable is a REFUSAL. An
 * anonymous audit of a private server is the dangerous failure, because it
 * succeeds: you get a confident grade over the login page and nothing says the
 * other 90% of the server was never seen.
 *
 * Offline. `reportImpl` is injected and `env` is a plain object, so nothing
 * here reads the real environment or reaches a server.
 */

import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import {
  TOKENS_FILE, isEnvName, readTokenMap, resolveTokenEnv, tokenEnvFor, writeTokenMap,
} from '../cli/tokens.mjs';
import { renderReview, reviewServers } from '../cli/review.mjs';

const TOKEN = 'sk-doorman-test-NEVER-PRINT-7c21ab';
const ENV = { LINEAR_MCP_TOKEN: TOKEN };

const srv = (gateName, target, transport = 'http') => ({ gateName, target, transport });

/* ── the map holds names, and only names ───────────────────────────────── */

describe('tokens: a map entry is an environment variable NAME');
{
  check('a plain name is a name', isEnvName('LINEAR_MCP_TOKEN'));
  check('a leading underscore is fine', isEnvName('_T'));
  check('a digit first is not a name', !isEnvName('1TOKEN'));
  check('a dash is not a name', !isEnvName('linear-token'));
  check('a real-looking token is not a name', !isEnvName(TOKEN));
  check('a bearer string is not a name', !isEnvName('Bearer abc123'));
  check('a non-string is not a name', !isEnvName(null) && !isEnvName(7));
}

describe('tokens: reading the map');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  check('a project with no map reads as empty', Object.keys(readTokenMap(root)).length === 0);

  writeTokenMap(root, {
    plugin_productivity_linear: 'LINEAR_MCP_TOKEN',
    'https://mcp.notion.com/mcp': 'NOTION_MCP_TOKEN',
  });
  const map = readTokenMap(root);
  check('a gate name maps', map.plugin_productivity_linear === 'LINEAR_MCP_TOKEN');
  check('a url maps too', map['https://mcp.notion.com/mcp'] === 'NOTION_MCP_TOKEN');
  check('the file on disk holds no token value',
    !readFileSync(join(root, TOKENS_FILE), 'utf8').includes(TOKEN));
}

describe('tokens: which entry applies to a server');
{
  const map = {
    plugin_productivity_linear: 'LINEAR_MCP_TOKEN',
    'https://mcp.notion.com/mcp': 'NOTION_MCP_TOKEN',
  };
  const byName = tokenEnvFor(srv('plugin_productivity_linear', 'https://mcp.linear.app/mcp'), map);
  check('a gate name matches', byName?.name === 'LINEAR_MCP_TOKEN');
  check('and it says which key matched', byName?.key === 'plugin_productivity_linear');

  const byUrl = tokenEnvFor(srv('claude_ai_Notion_http', 'https://mcp.notion.com/mcp'), map);
  check('a url matches when the gate name does not', byUrl?.name === 'NOTION_MCP_TOKEN');

  check('an unmapped server matches nothing',
    tokenEnvFor(srv('plugin_marketing_canva', 'https://mcp.canva.com/mcp'), map) === null);

  // The gate name is the more specific key: two gate names can share a url.
  const both = tokenEnvFor(srv('plugin_productivity_linear', 'https://mcp.notion.com/mcp'), map);
  check('the gate name wins over the url', both?.name === 'LINEAR_MCP_TOKEN');
}

describe('tokens: resolving a name never yields, or echoes, a value');
{
  const ok = resolveTokenEnv('LINEAR_MCP_TOKEN', ENV);
  check('a set variable resolves', ok.status === 'ok' && ok.name === 'LINEAR_MCP_TOKEN');
  check('and the result carries no value', !JSON.stringify(ok).includes(TOKEN));

  const absent = resolveTokenEnv('NOTION_MCP_TOKEN', ENV);
  check('an unset variable is absent, not ok', absent.status === 'absent');
  check('and it still names the variable so it can be set',
    absent.name === 'NOTION_MCP_TOKEN');

  const empty = resolveTokenEnv('EMPTY', { EMPTY: '' });
  check('an empty variable counts as absent', empty.status === 'absent');

  const bad = resolveTokenEnv(TOKEN, ENV);
  check('a token pasted as a name is bad-name', bad.status === 'bad-name');
  check('and bad-name drops the name entirely, so nothing echoes it',
    bad.name === null && !JSON.stringify(bad).includes(TOKEN));
}

/* ── the sweep authenticates, or refuses, per server ───────────────────── */

describe('review: a mapped server is audited WITH its credential');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  writeTokenMap(root, { plugin_productivity_linear: 'LINEAR_MCP_TOKEN' });
  const seen = [];
  const reportImpl = async (a) => {
    seen.push(a);
    return { ok: true, grade: { band: 'A', score: 90, hard_fail: null, static_partial: null, authenticated: true } };
  };
  const r = await reviewServers(root, {
    servers: [srv('plugin_productivity_linear', 'https://mcp.linear.app/mcp')],
    reportImpl, env: ENV, log: () => {}, now: () => 't',
  });
  const rec = r.reviews['https://mcp.linear.app/mcp'];

  check('the report ran', seen.length === 1);
  check('and it was handed the env var NAME', seen[0].tokenEnv === 'LINEAR_MCP_TOKEN');
  check('NOT the value', !JSON.stringify(seen[0]).includes(TOKEN));
  check('the record says the audit was authenticated', rec.authenticated === true);
  check('and which variable it came from', rec.token_env === 'LINEAR_MCP_TOKEN');
  check('the grade still came through', rec.status === 'graded' && rec.band === 'A');
}

describe('review: a mapped server whose variable is UNSET is refused, never audited anonymously');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  writeTokenMap(root, { plugin_productivity_linear: 'MISSING_TOKEN' });
  let called = 0;
  const reportImpl = async () => { called++; return { ok: true, grade: { band: 'A', score: 90 } }; };
  const r = await reviewServers(root, {
    servers: [srv('plugin_productivity_linear', 'https://mcp.linear.app/mcp')],
    reportImpl, env: ENV, log: () => {}, now: () => 't',
  });
  const rec = r.reviews['https://mcp.linear.app/mcp'];

  check('NOTHING was audited', called === 0, String(called));
  check('the status says a token is needed and missing', rec.status === 'token-missing', rec.status);
  check('it is not authenticated', rec.authenticated === false);
  check('no band was invented', !('band' in rec));
  check('the hint names the variable to set', /MISSING_TOKEN/.test(rec.hint ?? ''), rec.hint);
}

describe('review: a token VALUE in the map is refused, and not echoed');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  writeTokenMap(root, { plugin_productivity_linear: TOKEN });
  let called = 0;
  const reportImpl = async () => { called++; return { ok: true, grade: { band: 'A', score: 90 } }; };
  const r = await reviewServers(root, {
    servers: [srv('plugin_productivity_linear', 'https://mcp.linear.app/mcp')],
    reportImpl, env: ENV, log: () => {}, now: () => 't',
  });
  const rec = r.reviews['https://mcp.linear.app/mcp'];

  check('it did not audit with it', called === 0);
  check('it is recorded as token-missing', rec.status === 'token-missing', rec.status);
  check('the hint names the KEY, never the value',
    /plugin_productivity_linear/.test(rec.hint ?? '') && !(rec.hint ?? '').includes(TOKEN), rec.hint);
  check('and no token_env name is recorded for it', rec.token_env === null);
}

describe('review: an unmapped server is audited anonymously and says so');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  const seen = [];
  const reportImpl = async (a) => {
    seen.push(a);
    return { ok: true, grade: { band: 'B', score: 75, hard_fail: null, static_partial: null } };
  };
  const r = await reviewServers(root, {
    servers: [srv('plugin_marketing_canva', 'https://mcp.canva.com/mcp')],
    reportImpl, env: ENV, log: () => {}, now: () => 't',
  });
  const rec = r.reviews['https://mcp.canva.com/mcp'];

  check('no credential was passed', seen[0].tokenEnv === undefined || seen[0].tokenEnv === null);
  check('the record is explicitly anonymous', rec.authenticated === false);
  check('and carries no token_env', rec.token_env === null);
  check('it still got graded', rec.status === 'graded' && rec.band === 'B');
}

describe('review: a 401 on an UNMAPPED server points at the map');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  const reportImpl = async () => ({
    ok: false, why: 'the runner produced no grade.json',
    detail: 'error: MCP initialize HTTP 401: {"error":"invalid_token"}',
  });
  const r = await reviewServers(root, {
    servers: [srv('plugin_productivity_notion', 'https://mcp.notion.com/mcp')],
    reportImpl, env: ENV, log: () => {}, now: () => 't',
  });
  const rec = r.reviews['https://mcp.notion.com/mcp'];
  check('still auth-required', rec.status === 'auth-required', rec.status);
  check('and the hint tells you where to map a credential',
    /tokens\.json/.test(rec.hint ?? ''), rec.hint);
  check('an anonymous failed audit is not marked authenticated', rec.authenticated === false);
}

/* ── the leak sweep: the value appears NOWHERE ─────────────────────────── */

describe('review: a known token value appears in no output, record or file');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  writeTokenMap(root, {
    plugin_productivity_linear: 'LINEAR_MCP_TOKEN',
    plugin_productivity_notion: 'MISSING_TOKEN',
  });
  const logged = [];
  // The report writes its own artifacts. Stand in for them, so the assertion
  // covers what a reader would actually open rather than only the record.
  const reportImpl = async ({ out, tokenEnv, log = () => {} }) => {
    log(`grading with ${tokenEnv ?? 'no credential'}`);
    return {
      ok: true, out,
      grade: { band: 'A', score: 90, hard_fail: null, static_partial: null, authenticated: Boolean(tokenEnv) },
      files: ['grade.json', 'report.md', 'recipe.md', 'transcripts.jsonl'],
    };
  };
  const r = await reviewServers(root, {
    servers: [
      srv('plugin_productivity_linear', 'https://mcp.linear.app/mcp'),
      srv('plugin_productivity_notion', 'https://mcp.notion.com/mcp'),
    ],
    reportImpl, env: ENV, log: (m) => logged.push(m), now: () => 't',
  });

  check('the sweep ran both servers', Object.keys(r.reviews).length === 2);
  check('nothing was logged containing the token', !logged.join('\n').includes(TOKEN),
    logged.join(' | '));
  check('the returned object holds no token', !JSON.stringify(r).includes(TOKEN));
  check('the rendered output holds no token', !renderReview(r).includes(TOKEN));

  const reviewsFile = join(root, '.doorman', 'reviews.json');
  check('reviews.json exists', existsSync(reviewsFile));
  check('and holds no token', !readFileSync(reviewsFile, 'utf8').includes(TOKEN));

  // Every file the sweep wrote anywhere under .doorman, not just the one we
  // know about: a leak into a path this test did not predict still counts.
  const leaks = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (readFileSync(p, 'utf8').includes(TOKEN)) leaks.push(p);
    }
  };
  walk(join(root, '.doorman'));
  check('no file under .doorman/ holds the token', leaks.length === 0, leaks.join(', '));

  // And the log LINE that mentions the variable mentions only its name, which
  // is the one part that is safe to print.
  check('the log names the variable, which is allowed',
    logged.join('\n').includes('LINEAR_MCP_TOKEN'), logged.join(' | '));
}

describe('review: the summary counts a refusal separately from a grade');
{
  const root = mkdtempSync(join(tmpdir(), 'doorman-tok-'));
  writeTokenMap(root, { a: 'MISSING_TOKEN' });
  const r = await reviewServers(root, {
    servers: [srv('a', 'https://a.example/mcp'), srv('b', 'https://b.example/mcp')],
    reportImpl: async () => ({ ok: true, grade: { band: 'A', score: 90 } }),
    env: ENV, log: () => {}, now: () => 't',
  });
  const out = renderReview(r);
  check('the refusal is visible in the summary', /token-missing/.test(out), out);
  check('and it is not hidden behind the graded count', /1 graded/.test(out), out);
}
