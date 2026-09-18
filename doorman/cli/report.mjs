/**
 * `doorman report <link>` — L1, the static implementation report.
 *
 * This layer already existed. `mcp-scorecard/runner/run.mjs --once --static-only`
 * wraps the `mcpscore` CLI, runs the scan-only injection probe, and writes
 * grade.json / report.md / recipe.md / transcripts.jsonl to an output directory.
 * What was missing was a name and a stable interface, not the measurement.
 *
 * So this shells to it rather than reimplementing it. Invariant 2 in CLAUDE.md
 * is about exactly this: two implementations drift, and the day they disagree,
 * the one you trusted is whichever you happened to run.
 *
 * L1 needs NO model key. That matters more than it sounds: it means every
 * candidate can get a real static report today, and the pipeline degrades to
 * "measured statically, behaviourally unmeasured" rather than to nothing.
 */

import { execFile } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnvName } from './tokens.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * Where the static runner lives.
 *
 * The first version hardcoded `../../mcp-scorecard/runner/run.mjs`, which is
 * true inside this repo and false the moment the package is installed on its
 * own. Since the whole point is that someone else installs this, the lookup
 * now tries the places it could legitimately be and reports every one it
 * checked when it finds none. A path that is right in the author's checkout
 * and wrong everywhere else is the classic giveaway bug.
 */
const RUNNER_CANDIDATES = [
  process.env.DOORMAN_SCORECARD_RUNNER,                       // explicit wins
  path.resolve(HERE, '..', '..', 'mcp-scorecard', 'runner', 'run.mjs'),   // in-repo
  path.resolve(HERE, '..', 'vendor', 'scorecard-runner', 'run.mjs'),      // vendored
  path.resolve(process.cwd(), 'mcp-scorecard', 'runner', 'run.mjs'),      // cwd is the repo
].filter(Boolean);

const RUNNER = RUNNER_CANDIDATES.find((p) => existsSync(p)) ?? RUNNER_CANDIDATES[1];

/**
 * Why the runner produced no grade, from what it printed. `hint` is null when
 * the cause is not recognised: a wrong hint is worse than none, and the old
 * one ("mcpscore is not on PATH") was wrong for both failures seen on the day.
 */
/**
 * Why a `--token-env NAME` cannot be used, or null when it can.
 *
 * Checked HERE as well as in the runner so the refusal arrives before a
 * process is spawned and an output directory is created, and so the message
 * comes from the command the user actually typed.
 *
 * Neither branch repeats what was passed. If this fired because a token was
 * pasted where a name belongs, echoing it would copy the secret into an error
 * message that outlives the typo.
 */
export function tokenEnvProblem(tokenEnv, env = process.env) {
  if (!isEnvName(tokenEnv)) {
    return {
      why: '--token-env takes the NAME of an environment variable, not a token value.',
      hint: 'What was passed is not a valid environment variable name, so it is not repeated\n' +
        'here. Set the variable first, then name it:\n' +
        '  LINEAR_MCP_TOKEN=... doorman report <url> --token-env LINEAR_MCP_TOKEN',
    };
  }
  if (!env[tokenEnv]) {
    return {
      why: `--token-env ${tokenEnv} was given, but ${tokenEnv} is not set in this environment.`,
      hint: `Set ${tokenEnv} and run again. doorman will not fall back to an anonymous audit:\n` +
        'an anonymous audit of a server behind a login grades its front door and reports\n' +
        'a confident partial result that reads like a complete one.',
    };
  }
  return null;
}

export function diagnose(detail = '') {
  if (/HTTP 40[13]\b|invalid_token|unauthori[sz]ed/i.test(detail)) {
    return { status: 'auth-required',
      hint: 'the server requires a login, so its tools could not be listed. Nothing behind the login was measured.' };
  }
  if (/ERR_MODULE_NOT_FOUND[\s\S]*runner[\\/]lib\.mjs/.test(detail)) {
    return { status: 'runner-not-built',
      hint: 'mcp-scorecard/runner/lib.mjs is a build artifact: cd mcp-scorecard && npm ci && npm run build:shared' };
  }
  if (/spawn mcpscore ENOENT/.test(detail)) {
    return { status: 'mcpscore-missing',
      hint: 'pip install mcpscore, then put the interpreter Scripts/ (or bin/) dir on PATH' };
  }
  return { status: 'failed', hint: null };
}

/**
 * @param {object} o
 * @param {string} [o.tokenEnv]
 *   The NAME of an environment variable holding a bearer token for a server
 *   behind a login. The NAME, never the token.
 *
 *   The value is not read here and is not passed to the child process as data.
 *   `execFile` inherits this process's environment, so the runner reads the
 *   variable itself, in its own process. The credential therefore appears in
 *   no argument list anywhere in the chain, which is the point: a command line
 *   is readable out of the OS process list by any other local user and a shell
 *   may persist it in history.
 *
 *   Refuses when the variable is unset. Never falls back to an anonymous
 *   audit: that would succeed, returning a confident grade of a login page.
 */
export async function report({ link, out, neededFor, log, tokenEnv }) {
  if (!existsSync(RUNNER)) {
    return {
      ok: false,
      why:
        'the scorecard static runner was not found. doorman report delegates the\n' +
        'static layer rather than reimplementing it, so it needs that file.\n\n' +
        'Looked in:\n' + RUNNER_CANDIDATES.map((p) => `  ${p}`).join('\n') + '\n\n' +
        'Set DOORMAN_SCORECARD_RUNNER to its path, or run doorman from a clone of\n' +
        'the repo, where the in-repo path resolves.',
    };
  }

  if (tokenEnv != null) {
    const bad = tokenEnvProblem(tokenEnv);
    if (bad) return { ok: false, why: bad.why, hint: bad.hint };
  }

  await mkdir(out, { recursive: true });
  log(`static layer via ${path.relative(process.cwd(), RUNNER)}`);
  log(`out: ${out}`);

  const args = [
    RUNNER, '--once',
    '--server', link,
    '--static-only',
    '--out', out,
  ];
  if (neededFor) args.push('--needed-for', neededFor);
  // The NAME, and never the value. See the tokenEnv note on this function.
  if (tokenEnv != null) args.push('--token-env', tokenEnv);

  const r = await new Promise((res) =>
    execFile(process.execPath, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      res({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' })));

  for (const line of r.stdout.split('\n').filter(Boolean)) log('  ' + line);

  const gradePath = path.join(out, 'grade.json');
  if (!existsSync(gradePath)) {
    const detail = (r.stderr || r.stdout).slice(-1500);
    const d = diagnose(detail);
    return {
      ok: false,
      why: `the runner produced no grade.json (${d.status})`,
      detail,
      hint: d.hint ?? 'Cause not recognised. The runner output above is the evidence.',
    };
  }

  const grade = JSON.parse(await readFile(gradePath, 'utf8'));
  return { ok: true, grade, out, files: ['grade.json', 'report.md', 'recipe.md', 'transcripts.jsonl'] };
}
