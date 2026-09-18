/**
 * Per-server credentials for a review sweep: `.doorman/tokens.json`.
 *
 * The file maps a server to the NAME of an environment variable:
 *
 *   { "plugin_productivity_linear": "LINEAR_MCP_TOKEN",
 *     "https://mcp.notion.com/mcp": "NOTION_MCP_TOKEN" }
 *
 * A NAME, never a token. Three reasons, in order of how much they cost:
 *
 *  1. `.doorman/` sits inside a project. A token written there is a token one
 *     `git add` away from a public repository.
 *  2. doorman passes the NAME down to the runner and lets the OS carry the
 *     value by environment inheritance, so the secret never becomes an argument
 *     to any command in the chain. A command line is readable out of the
 *     process list by any other local user and a shell may keep it in history.
 *  3. A name can be read out loud, put in a README, and committed. A rule that
 *     survives being convenient is the only kind that survives.
 *
 * So this module handles names and presence, and never once returns a value.
 * Nothing here reads a token. The runner does, out of the environment it
 * inherited, in its own process.
 *
 * The env-name check is duplicated in mcp-scorecard/runner/auth.mjs on purpose.
 * doorman ships as a standalone package with zero runtime dependencies and
 * cannot import from the scorecard; a one-line shape check is the right thing
 * to copy across that boundary, and both copies are pinned by their own tests.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TOKENS_FILE = path.join('.doorman', 'tokens.json');

/**
 * A plausible environment variable name, and nothing else.
 *
 * This is the guard that catches the mistake the design exists to prevent: a
 * live token pasted where a name belongs. Real tokens carry characters no
 * POSIX environment variable name may hold, so the shape check rejects them.
 */
export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isEnvName(s) {
  return typeof s === 'string' && ENV_NAME_RE.test(s);
}

/** The map, or `{}`. A missing or unparseable file is not an error: no map, no credentials. */
export function readTokenMap(root) {
  const file = path.join(root, TOKENS_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write the map. Used by the tests and available for tooling; doorman itself
 * never writes this file behind the user's back, because it is the user's
 * statement about which of their credentials may be spent on which server.
 */
export function writeTokenMap(root, map) {
  const file = path.join(root, TOKENS_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(map, null, 2) + '\n', 'utf8');
  return file;
}

/**
 * Which map entry applies to a server, as `{ key, name }`, or null.
 *
 * The gate name is tried before the url because it is the more specific key:
 * several gate names can point at one url (two plugins both wiring Notion),
 * and a per-plugin credential has to be able to win over a per-url default.
 *
 * `name` is returned verbatim, valid or not. Validation is resolveTokenEnv's
 * job, and it has to be able to tell "you mapped a token value" apart from
 * "you mapped nothing", which it cannot do if this function filters first.
 */
export function tokenEnvFor(server, map) {
  for (const key of [server?.gateName, server?.target]) {
    if (key && Object.prototype.hasOwnProperty.call(map, key)) {
      return { key, name: map[key] };
    }
  }
  return null;
}

/**
 * Turn a mapped NAME into a decision. Never returns, and never echoes, a value.
 *
 *   ok        the variable is set; hand the NAME to the runner
 *   absent    mapped but unset. A REFUSAL, not a fallback: see below.
 *   bad-name  what was mapped is not an environment variable name at all,
 *             most likely a token. `name` comes back null so that no caller
 *             can put it in a message, a log or a record.
 *
 * `absent` must never degrade to an anonymous audit. An anonymous audit of a
 * server behind a login does not fail: it succeeds, grading the front door and
 * reporting a confident partial result that reads like a complete one. That is
 * the failure mode this whole file is arranged around.
 */
export function resolveTokenEnv(name, env = process.env) {
  if (!isEnvName(name)) return { status: 'bad-name', name: null };
  if (!env[name]) return { status: 'absent', name };
  return { status: 'ok', name };
}

/**
 * Why a server could not be audited with the credential it was mapped to.
 * Names the variable when there is a safe name to print, and the map KEY when
 * there is not.
 */
export function tokenHint(key, resolved) {
  if (resolved.status === 'bad-name') {
    return `${TOKENS_FILE} maps "${key}" to something that is not an environment ` +
      'variable name. Map the NAME of a variable, never the token itself: ' +
      `{"${key}": "MY_TOKEN_VAR"}. The value was not read and is not repeated here.`;
  }
  return `${TOKENS_FILE} maps "${key}" to ${resolved.name}, which is not set in this ` +
    `environment. Set ${resolved.name} and run again. Nothing was audited anonymously: ` +
    'an anonymous audit of a server behind a login grades its front door.';
}
