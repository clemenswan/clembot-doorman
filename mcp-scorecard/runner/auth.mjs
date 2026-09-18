/**
 * Turning a --token-env NAME into a credential, or into a refusal.
 *
 * Its own module, with no top-level side effects, so the tests can drive these
 * functions without importing run.mjs (whose top level parses argv and starts
 * doing things).
 *
 * The one rule this file exists to enforce: the doorman/runner CLI accepts the
 * NAME of an environment variable and never the token itself. A command line
 * is readable out of the OS process list by any other local user and a shell
 * may persist it in history, so a secret passed as an argument has already
 * leaked by the time it is used.
 */

/**
 * A plausible environment-variable name, and nothing else.
 *
 * This is the guard that catches the mistake the feature exists to prevent:
 * `--token-env sk-ant-abc123`, a live secret typed where a name belongs. Real
 * tokens carry characters no POSIX environment variable name may hold, so the
 * shape check rejects them.
 */
export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isEnvName(s) {
  return typeof s === 'string' && ENV_NAME_RE.test(s);
}

export class AuthTokenError extends Error {}

/**
 * The bearer token named by --token-env, or null when the flag was not used.
 *
 * REFUSES rather than defaulting, per invariant 9: a missing credential stops
 * the run and says so. An anonymous fallback would be worse than a crash
 * because it SUCCEEDS, handing back a real grade of a login page.
 *
 * Throws rather than exiting: nothing in this codebase calls process.exit()
 * (invariant 6), and the caller already owns the exit code.
 */
export function resolveAuthToken(tokenEnv, env = process.env) {
  if (tokenEnv === undefined || tokenEnv === null) return null;
  if (tokenEnv === true || tokenEnv === '') {
    throw new AuthTokenError(
      '--token-env needs the NAME of an environment variable, e.g. --token-env LINEAR_MCP_TOKEN',
    );
  }
  if (!isEnvName(tokenEnv)) {
    // Deliberately does NOT quote the argument back. If this fired because a
    // token was pasted where a name belongs, echoing it would copy the secret
    // into an error message that outlives the mistake.
    throw new AuthTokenError(
      '--token-env takes the NAME of an environment variable, not a token value.\n' +
      'What was passed is not a valid environment variable name, so it is not repeated here.\n' +
      'Set the variable first, then name it:\n' +
      '  LINEAR_MCP_TOKEN=... node runner/run.mjs --once --server URL --token-env LINEAR_MCP_TOKEN',
    );
  }
  const value = env[tokenEnv];
  if (!value) {
    throw new AuthTokenError(
      `--token-env ${tokenEnv} was given, but ${tokenEnv} is not set in the environment.\n` +
      'Refusing to fall back to an anonymous audit: an anonymous audit of a server\n' +
      'behind a login grades its front door and reports a confident partial result.',
    );
  }
  return value;
}

/**
 * ONE CREDENTIAL CANNOT BE RIGHT FOR A QUEUE OF ARBITRARY SERVERS.
 *
 * `--poll` grades whatever the Worker hands it and the queue is open on purpose
 * (invariant 25). Honouring `--token-env` there would present the operator's
 * token to every url anyone queued, which is a credential-exfiltration
 * primitive wearing the shape of a convenience flag.
 *
 * Per-server credentials belong to the caller that chose the server: `--once
 * --server URL --token-env NAME`, or `doorman review` with
 * `.doorman/tokens.json`.
 */
export function refusePollToken(tokenEnv) {
  if (tokenEnv === undefined || tokenEnv === null) return null;
  throw new AuthTokenError(
    '--token-env is not available with --poll.\n' +
    '--poll grades whatever the queue hands it, so one token would be presented to\n' +
    'every server anyone queued. Use --once --server URL --token-env NAME for a\n' +
    'server you chose, or doorman review with .doorman/tokens.json for a sweep.',
  );
}
