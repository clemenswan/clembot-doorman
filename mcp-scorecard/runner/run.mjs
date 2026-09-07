#!/usr/bin/env node
/**
 * The probe runner.
 *
 * Polls the Worker for queued audits, runs them locally (where Python and
 * mcpscore exist), and posts the results back. This is not a workaround: it is
 * the architecture. A Cloudflare Worker cannot spawn a process, so the machine
 * that can run mcpscore has to be the machine that grades.
 *
 * Usage:
 *   node runner/run.mjs --once --server https://mcp.deepwiki.com/mcp \
 *        --needed-for "look up how a repo works" --static-only
 *   node runner/run.mjs --poll --api https://scorecard.example.com
 *
 * Env:
 *   ANTHROPIC_API_KEY   required unless --static-only
 *   RUNNER_TOKEN        required for --poll
 *   SCORECARD_API       default API base for --poll
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runAudit } from './audit.mjs';

const args = parseArgs(process.argv.slice(2));
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

if (args.help || (!args.once && !args.poll)) {
  console.log(`
mcp-scorecard probe runner

  --once            grade one server and print the result (no Worker needed)
  --poll            poll the Worker queue forever

  --server URL      server to grade with --once
  --needed-for TXT  what you want the server for (seeds the Cold Open probe)
  --static-only     skip behavioural probes (no Anthropic key needed).
                    Works with --once and --poll.
  --no-guidance     skip the guidance pass. It re-runs cold_open with the
                    drafted recipe, so it costs a second cold_open in model
                    calls. Skipping leaves the layer NOT MEASURED, which
                    renormalises the weights; it is never scored zero.
  --out DIR         write grade.json, report.md, recipe.md, transcripts.jsonl
  --api URL         Worker base URL for --poll
  --interval SEC    poll interval, default 5
  --runner NAME     runner id recorded in the ledger
`);
  process.exitCode = 0;
} else {
  try {
    if (args.once) await once();
    else await pollForever();
  } catch (e) {
    console.error(`\nerror: ${e.message}\n`);
    process.exitCode = 1;
  }
}

async function once() {
  if (!args.server) fail('--once needs --server <url>');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!args['static-only'] && !apiKey) {
    fail(
      'ANTHROPIC_API_KEY is not set.\n' +
      'Either export it, or run with --static-only to grade the static layer alone.\n' +
      'Nothing is fabricated when the key is missing: the run stops here.',
    );
  }

  const job = {
    audit_id: 'local-' + Date.now(),
    server_url: args.server,
    needed_for: args['needed-for'],
    model: args.model ?? 'claude-sonnet-5',
    temperature: 0,
    runs: Number(args.runs ?? 3),
  };

  log(`grading ${job.server_url}`);
  const result = await runAudit(job, {
    apiKey,
    log,
    skipBehavioral: Boolean(args['static-only']),
    skipGuidance: Boolean(args['no-guidance']),
  });

  console.log('\n' + result.report_md);

  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, 'grade.json'), JSON.stringify(result.grade_json, null, 2));
    writeFileSync(join(args.out, 'report.md'), result.report_md);
    writeFileSync(join(args.out, 'recipe.md'), result.recipe_md);
    writeFileSync(
      join(args.out, 'transcripts.jsonl'),
      result.transcripts.map((t) => t.jsonl).filter(Boolean).join('\n'),
    );
    writeFileSync(
      join(args.out, 'evidence.sha256'),
      `${result.evidence_sha256}  ${job.server_url}\n`,
    );
    log(`wrote evidence bundle to ${args.out}`);
  }
}

async function pollForever() {
  const api = (args.api ?? process.env.SCORECARD_API ?? '').replace(/\/+$/, '');
  const token = process.env.RUNNER_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!api) fail('--poll needs --api <url> or SCORECARD_API');
  if (!token) fail('--poll needs RUNNER_TOKEN in the environment');

  // --static-only lets a runner complete audits without an Anthropic key. The
  // resulting grade is real but covers one layer, and both the report and the
  // grade record say so: the behavioural layer comes back null, the weights
  // renormalise, and the provenance section states that no probes were run.
  const staticOnly = Boolean(args['static-only']);
  if (!staticOnly && !apiKey) {
    fail(
      'ANTHROPIC_API_KEY is not set, so behavioural probes cannot run.\n' +
      'Either export it, or pass --static-only to grade the static layer alone.\n' +
      'Polling without either would claim work and then fail every audit.',
    );
  }

  const noGuidance = Boolean(args['no-guidance']);
  const runnerId = args.runner ?? `runner-${process.pid}`;
  const intervalMs = Number(args.interval ?? 5) * 1000;
  log(
    `polling ${api} every ${intervalMs / 1000}s as ${runnerId}` +
    (staticOnly ? ' (static layer only)' : noGuidance ? ' (no guidance pass)' : ''),
  );

  for (;;) {
    try {
      const res = await fetch(
        `${api}/api/pending?limit=1&runner=${encodeURIComponent(runnerId)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        log(`poll failed: HTTP ${res.status}`);
      } else {
        const { work = [] } = await res.json();
        for (const job of work) {
          log(`claimed ${job.audit_id} for ${job.server_url}`);
          let payload;
          try {
            payload = await runAudit(job, {
              apiKey, log, skipBehavioral: staticOnly, skipGuidance: noGuidance,
            });
          } catch (e) {
            log(`audit failed: ${e.message}`);
            payload = { audit_id: job.audit_id, status: 'failed', error: String(e.message ?? e) };
          }
          await postResult(api, token, payload, log);
        }
      }
    } catch (e) {
      // A poll loop must survive a transient network failure. It logs and
      // keeps going rather than exiting and stranding the queue.
      log(`poll error: ${e.message}`);
    }
    await sleep(intervalMs);
  }
}

async function postResult(api, token, payload, log) {
  const res = await fetch(`${api}/api/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  log(
    res.ok
      ? `posted ${payload.audit_id} (${payload.status})`
      : `post failed: HTTP ${res.status} ${await res.text().catch(() => '')}`,
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Stop with a message.
 *
 * Sets exitCode and throws rather than calling process.exit(). On Node 25 /
 * Windows, exiting while undici holds keep-alive sockets trips a libuv
 * assertion during teardown that REPLACES the real exit code with 127. That
 * turns a clean pass into an inexplicable CI failure, so nothing in this
 * codebase calls process.exit().
 */
function fail(msg) {
  process.exitCode = 1;
  // A plain Error: `class` declarations are not hoisted, and fail() is reached
  // from top-level code before a class declared here would be initialised.
  throw new Error(msg);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
