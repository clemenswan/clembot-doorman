/**
 * The throwaway Docker sandbox, and the one thing that makes an A/B honest.
 *
 * Two arms. They must be byte-identical except for a single install layer, or
 * the comparison measures the difference between two environments rather than
 * the difference the candidate makes. So both arms are built FROM THE SAME
 * base image digest, and the candidate arm is literally the baseline image plus
 * one `RUN` instruction. Nothing else varies: same task file, same model, same
 * temperature, same seed order, same network policy.
 *
 * `--network none` is the default for the task run itself. A candidate that
 * needs the network has to declare it, and what it actually reaches is then
 * observable rather than assumed. That is the hook the security clause in
 * `verdict.mjs` reads.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({
        ok: !err, code: err?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '',
      }));
    if (opts.stdin) { child.stdin.write(opts.stdin); child.stdin.end(); }
  });

export async function dockerAvailable() {
  const r = await run('docker', ['version', '--format', '{{.Server.Version}}']);
  return { ok: r.ok, version: r.stdout.trim(), detail: r.ok ? null : (r.stderr || r.stdout).trim() };
}

/**
 * Derive the ONE install instruction for the candidate arm.
 *
 * Refuses anything it cannot express as a single reproducible layer, rather
 * than guessing. A candidate that needs a compose file or a running service is
 * a different lane (see evals/ROADMAP.md, "Platform-class candidates"), and
 * pretending otherwise would produce an arm that silently installed nothing.
 */
export function installLayer(link) {
  const l = String(link).trim();

  let m = l.match(/^npm:(.+)$/) || l.match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/(.+?)\/?$/);
  if (m) return { kind: 'npm', spec: m[1], run: `npm install -g ${JSON.stringify(m[1])}` };

  m = l.match(/^pip:(.+)$/) || l.match(/^https?:\/\/pypi\.org\/project\/(.+?)\/?$/);
  if (m) return { kind: 'pip', spec: m[1], run: `pip install --no-cache-dir ${JSON.stringify(m[1])}` };

  m = l.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (m) {
    return {
      kind: 'git',
      spec: m[1],
      run:
        `git clone --depth 1 https://github.com/${m[1]}.git /opt/candidate && ` +
        `cd /opt/candidate && ` +
        `(test -f package.json && npm install --omit=dev || true) && ` +
        `(test -f requirements.txt && pip install --no-cache-dir -r requirements.txt || true) && ` +
        `(test -f pyproject.toml && pip install --no-cache-dir . || true)`,
    };
  }

  if (/^https?:\/\//.test(l)) {
    return {
      kind: 'unsupported',
      spec: l,
      run: null,
      why:
        'this link is not something a single reproducible install layer can express. ' +
        'Supported: an npm package (npm:name), a PyPI package (pip:name), or a GitHub repo url. ' +
        'A hosted MCP endpoint has nothing to install, so use `doorman report` for its ' +
        'static layer instead, and see evals/ROADMAP.md for the platform-class lane.',
    };
  }

  return {
    kind: 'unsupported', spec: l, run: null,
    why: 'not a recognised candidate link',
  };
}

/** The base image both arms share. Pinned by digest at build time, not by tag. */
const BASE_DOCKERFILE = `
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \\
      git ca-certificates python3 python3-pip \\
  && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/python3 /usr/bin/python
WORKDIR /work
# The harness that runs one task and prints one JSON line of metrics.
COPY harness.mjs /opt/harness.mjs
ENV NODE_ENV=production
`;

export async function buildArms({ link, harnessSource, log }) {
  const layer = installLayer(link);
  if (layer.kind === 'unsupported') {
    return { ok: false, why: layer.why, layer };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'doorman-'));
  const tag = 'doorman-eval-' + Math.random().toString(16).slice(2, 10);
  try {
    await writeFile(path.join(dir, 'harness.mjs'), harnessSource, 'utf8');
    await writeFile(path.join(dir, 'Dockerfile.base'), BASE_DOCKERFILE, 'utf8');

    log(`building baseline arm (${tag}-base)`);
    const b = await run('docker', ['build', '-f', 'Dockerfile.base', '-t', `${tag}-base`, '.'], { cwd: dir });
    if (!b.ok) return { ok: false, why: 'baseline image build failed', detail: b.stderr.slice(-2000), layer };

    // The candidate arm IS the baseline image plus exactly one instruction.
    // Written this way on purpose: it is impossible for the two arms to drift,
    // because one is derived from the other rather than built alongside it.
    const candDockerfile = `FROM ${tag}-base\nRUN ${layer.run}\n`;
    await writeFile(path.join(dir, 'Dockerfile.cand'), candDockerfile, 'utf8');

    log(`building candidate arm (+1 layer: ${layer.kind} ${layer.spec})`);
    const c = await run('docker', ['build', '-f', 'Dockerfile.cand', '-t', `${tag}-cand`, '.'], { cwd: dir });
    if (!c.ok) {
      return {
        ok: false,
        why: `the candidate would not install: ${layer.kind} ${layer.spec}`,
        detail: c.stderr.slice(-2000),
        layer,
        // A candidate that cannot be installed is a real result, not an error.
        installFailed: true,
      };
    }

    return { ok: true, baseTag: `${tag}-base`, candTag: `${tag}-cand`, dir, tag, layer };
  } catch (e) {
    return { ok: false, why: e.message, layer };
  }
}

/** Run the harness once inside an arm. Returns the parsed metrics line. */
export async function runOnce({ image, task, apiKey, model, netAllowed, maxTurns = 24,
                               timeoutMs = 300_000 }) {
  const args = [
    'run', '--rm', '-i',
    '--network', netAllowed ? 'bridge' : 'none',
    '--memory', '2g', '--cpus', '2',
    '-e', `DOORMAN_MODEL=${model}`,
    '-e', `DOORMAN_MAX_TURNS=${maxTurns}`,
    '-e', 'ANTHROPIC_API_KEY',
    image, 'node', '/opt/harness.mjs',
  ];
  const started = Date.now();
  const r = await run('docker', args, {
    stdin: JSON.stringify(task),
    timeout: timeoutMs,
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  });
  const wall_ms = Date.now() - started;

  const line = r.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!line) {
    return { success: false, wall_ms, error: 'harness produced no metrics line', stderr: r.stderr.slice(-800) };
  }
  try {
    return { ...JSON.parse(line), wall_ms };
  } catch {
    return { success: false, wall_ms, error: 'harness metrics line was not JSON' };
  }
}

export async function cleanup({ tag, dir }, log) {
  if (tag) {
    await run('docker', ['image', 'rm', '-f', `${tag}-cand`, `${tag}-base`]);
    log('removed both arm images');
  }
  if (dir) await rm(dir, { recursive: true, force: true });
}
