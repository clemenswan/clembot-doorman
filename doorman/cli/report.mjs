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

export async function report({ link, out, neededFor, log }) {
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

  const r = await new Promise((res) =>
    execFile(process.execPath, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      res({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' })));

  for (const line of r.stdout.split('\n').filter(Boolean)) log('  ' + line);

  const gradePath = path.join(out, 'grade.json');
  if (!existsSync(gradePath)) {
    return {
      ok: false,
      why: 'the runner produced no grade.json',
      detail: (r.stderr || r.stdout).slice(-1500),
      hint:
        'The most common cause is that `mcpscore` is not on PATH. It is a Python ' +
        'console script: pip install mcpscore, then export the interpreter Scripts/ dir.',
    };
  }

  const grade = JSON.parse(await readFile(gradePath, 'utf8'));
  return { ok: true, grade, out, files: ['grade.json', 'report.md', 'recipe.md', 'transcripts.jsonl'] };
}
