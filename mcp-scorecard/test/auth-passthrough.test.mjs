/**
 * Auditing a server that sits behind a login.
 *
 * The feature is one credential reaching BOTH halves of the audit: the Python
 * static layer (mcpscore) and the Node handshake (HttpMcpClient). The danger is
 * the credential reaching a place it can be read from: an argv element, a log
 * line, a grade record.
 *
 * So the assertions here are mostly negative. The token value is a single
 * distinctive string and the tests look for it everywhere it must not be.
 *
 * Offline. Nothing spawns mcpscore and nothing opens a socket: the argv and the
 * child environment are built by one exported function so they can be asserted
 * without a process.
 */

import { expect, it } from 'vitest';
import { HttpMcpClient, authOptions, mcpscoreSpawn } from '../runner/host-node.mjs';
import { AuthTokenError, isEnvName, refusePollToken, resolveAuthToken } from '../runner/auth.mjs';
import { buildReport, grade } from '../runner/lib.mjs';

const TOKEN = 'sk-test-DO-NOT-PRINT-3f9a1c';

const staticLayer = (over = {}) => ({
  score: 78,
  max_score: 91,
  pct: 85.71,
  mcpscore_version: '1.11.0',
  failed_rules: [],
  partial: false,
  partial_reason: null,
  coverage: null,
  readiness: null,
  ...over,
});

/* ── --token-env NAME resolves, or refuses ─────────────────────────────── */

it('no flag means no credential', () => {
  expect(resolveAuthToken(undefined, {})).toBe(null);
});

it('a set variable resolves to its value', () => {
  expect(resolveAuthToken('LINEAR_MCP_TOKEN', { LINEAR_MCP_TOKEN: TOKEN })).toBe(TOKEN);
});

it('an UNSET variable is a refusal, never an anonymous audit', () => {
  expect(() => resolveAuthToken('LINEAR_MCP_TOKEN', {})).toThrow(AuthTokenError);
  expect(() => resolveAuthToken('LINEAR_MCP_TOKEN', { LINEAR_MCP_TOKEN: '' })).toThrow(AuthTokenError);
});

it('the refusal names the variable so it can be fixed', () => {
  expect(() => resolveAuthToken('LINEAR_MCP_TOKEN', {})).toThrow(/LINEAR_MCP_TOKEN/);
});

it('a token pasted where a NAME belongs is refused', () => {
  // The whole point of --token-env. A real token cannot be an env var name.
  expect(() => resolveAuthToken(TOKEN, {})).toThrow(AuthTokenError);
  expect(() => resolveAuthToken('Bearer abc', {})).toThrow(AuthTokenError);
  expect(() => resolveAuthToken('a=b', {})).toThrow(AuthTokenError);
});

it('and that refusal does NOT echo what was passed', () => {
  // Echoing it would copy the secret into an error message that outlives the
  // typo, which is the leak this flag exists to close.
  let message = '';
  try { resolveAuthToken(TOKEN, {}); } catch (e) { message = e.message; }
  expect(message).not.toContain(TOKEN);
  expect(message.length).toBeGreaterThan(0);
});

it('--token-env with no value after it is refused rather than treated as a flag', () => {
  // The runner's arg parser yields `true` for a trailing flag. Silently
  // treating that as "no credential" would audit anonymously.
  expect(() => resolveAuthToken(true, {})).toThrow(AuthTokenError);
  expect(() => resolveAuthToken('', {})).toThrow(AuthTokenError);
});

it('isEnvName accepts the names people actually use', () => {
  for (const ok of ['LINEAR_MCP_TOKEN', '_x', 'a1', 'NOTION_TOKEN']) {
    expect(isEnvName(ok)).toBe(true);
  }
  for (const bad of ['1ABC', 'a-b', 'a b', '', null, undefined, 42]) {
    expect(isEnvName(bad)).toBe(false);
  }
});

/* ── the value goes in the environment, never on the command line ──────── */

it('a token reaches mcpscore through MCPSCORE_TOKEN and never through argv', () => {
  const { args, env } = mcpscoreSpawn('https://x.example/mcp', { token: TOKEN, env: {} });
  expect(args.join(' ')).not.toContain(TOKEN);
  expect(args).not.toContain('--token');
  expect(args).toEqual(['--json', 'https://x.example/mcp']);
  expect(env.MCPSCORE_TOKEN).toBe(TOKEN);
});

it('an anonymous audit passes no credential at all', () => {
  const { args, env } = mcpscoreSpawn('https://x.example/mcp', { env: {} });
  expect(args).toEqual(['--json', 'https://x.example/mcp']);
  expect('MCPSCORE_TOKEN' in env).toBe(false);
});

it('an inherited MCPSCORE_TOKEN is stripped from an anonymous audit', () => {
  // Otherwise an audit the caller believes is measuring the PUBLIC surface
  // quietly authenticates off an ambient env var, and the grade's own
  // `authenticated` flag would be right while the caller's belief was wrong.
  const { env } = mcpscoreSpawn('https://x.example/mcp', { env: { MCPSCORE_TOKEN: TOKEN } });
  expect('MCPSCORE_TOKEN' in env).toBe(false);
});

it('the rest of the environment is inherited', () => {
  const { env } = mcpscoreSpawn('https://x.example/mcp', { token: TOKEN, env: { PATH: '/usr/bin' } });
  expect(env.PATH).toBe('/usr/bin');
});

/* ── the same credential on the Node half ──────────────────────────────── */

it('authOptions turns a token into an Authorization header the client sends', () => {
  const c = new HttpMcpClient('https://x.example/mcp', authOptions(TOKEN));
  expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
});

it('authOptions with no token sends no header, so an anonymous audit stays anonymous', () => {
  expect(authOptions(null)).toEqual({});
  const c = new HttpMcpClient('https://x.example/mcp', authOptions(null));
  expect(Object.keys(c.headers)).toEqual([]);
});

/* ── the grade says which surface it measured ──────────────────────────── */

it('a grade records that a credential was presented', () => {
  const g = grade({
    server_url: 'https://x.example/mcp', model: null,
    static: staticLayer(), probes: [], guidance: null, authenticated: true,
  });
  expect(g.authenticated).toBe(true);
});

it('a grade defaults to anonymous rather than assuming a credential', () => {
  const g = grade({
    server_url: 'https://x.example/mcp', model: null,
    static: staticLayer(), probes: [], guidance: null,
  });
  expect(g.authenticated).toBe(false);
});

it("mcpscore's own authenticated flag is enough on its own", () => {
  // mcpscore reports `authenticated` from the headers IT sent. Either witness
  // saying yes means a credential was presented; only both saying no is
  // anonymous.
  const g = grade({
    server_url: 'https://x.example/mcp', model: null,
    static: staticLayer({ authenticated: true }), probes: [], guidance: null,
  });
  expect(g.authenticated).toBe(true);
});

it('no token value appears anywhere in a grade record', () => {
  const g = grade({
    server_url: 'https://x.example/mcp', model: null,
    static: staticLayer({ authenticated: true }), probes: [], guidance: null, authenticated: true,
  });
  expect(JSON.stringify(g)).not.toContain(TOKEN);
});

/* ── report.md states which surface it graded ──────────────────────────── */

const reportFor = (authenticated) => buildReport({
  audit_id: 'local-1',
  probes: [],
  grade: grade({
    server_url: 'https://x.example/mcp', model: null,
    static: staticLayer(), probes: [], guidance: null, authenticated,
  }),
});

it('report.md says when a credential was presented', () => {
  expect(reportFor(true)).toContain('a credential was presented');
  expect(reportFor(true)).toContain('AUTHENTICATED');
});

it('report.md says when one was NOT, rather than staying silent', () => {
  // The quiet case is the misleading one: an anonymous grade of a private
  // server reads exactly like a complete grade of a public one.
  expect(reportFor(false)).toContain('no credential was presented');
  expect(reportFor(false)).toContain('PUBLIC surface only');
});

it('report.md never names the variable a credential came from', () => {
  // A report is a public artifact and the name of a secret is a hint about
  // where to look for it. buildReport is not even given the name.
  expect(reportFor(true)).not.toContain('LINEAR_MCP_TOKEN');
  expect(reportFor(true)).not.toContain('MCPSCORE_TOKEN');
  expect(reportFor(true)).not.toContain(TOKEN);
});

/* ── a queue of servers we did not choose gets no credential ───────────── */

it('--token-env is refused with --poll', () => {
  // --poll grades whatever the open queue hands it, so one token would be
  // presented to every url anyone queued.
  expect(() => refusePollToken('LINEAR_MCP_TOKEN')).toThrow(AuthTokenError);
  expect(() => refusePollToken('LINEAR_MCP_TOKEN')).toThrow(/not available with --poll/);
  expect(() => refusePollToken(true)).toThrow(AuthTokenError);
});

it('and --poll without the flag is unaffected', () => {
  expect(refusePollToken(undefined)).toBe(null);
});
