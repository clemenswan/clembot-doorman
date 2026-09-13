#!/usr/bin/env node
/**
 * doorman — measure a candidate tool instead of reviewing it.
 *
 *   doorman report <link>              L1, static implementation report. No key needed.
 *   doorman eval <link> --task <file>  L3, two-arm benchmark in a throwaway sandbox.
 *   doorman allow <server> [--scope user|project] [--why TEXT] [--dry-run]
      Trust a server by NAME, which is what the gate shows you when it blocks
      one. Records a DECISION, not a measurement: basis is operator and the
      grade stays null, because nothing graded it.

      --scope user (default) writes ~/.doorman/registry and covers every
      project. --scope project writes ./registry and covers this one.
      Refuses to reverse a denylist entry.

  doorman needs [path]               read this build's own prompt history, propose servers.
 *   doorman watch [path]               poll the feed for candidates new to THIS build.
 *   doorman discover                   sweep a public directory for candidates. Curate, never enqueue.
 *   doorman notify refresh|consume     the SessionStart push. Called by the hook, not by hand.
 *
 * Zero runtime dependencies, per the requirement in package.json. That is why
 * the YAML loader and the arg parser are in-tree rather than installed.
 */

import { report } from './report.mjs';
import { evaluate } from './eval.mjs';
import { doctor, renderDoctor } from './doctor.mjs';
import { watch, renderWatch, readState, writeState, DEFAULT_API, DEFAULT_STATE } from './watch.mjs';
import { discover, renderDiscover, writeCandidates } from './discover.mjs';
import { needs as readNeeds, render as renderNeedsCli } from './needs.mjs';
import { install, renderInstall } from './install.mjs';
import { allow, renderAllow, SCOPES } from './allow.mjs';
import { refreshNotify, consumeDigest, DEFAULT_DIGEST } from './notify.mjs';
import { join } from 'node:path';

// Pinned to every other declaration by version.test.mjs. There are FOUR of
// them (root package.json, doorman/package.json, plugin.json, this) and this
// one silently reported 0.1.0 out of a 0.2.0 tarball.
const VERSION = '0.2.0';

const HELP = `
doorman ${VERSION} — measure a candidate, do not just read it

  doorman doctor [path]
      L0. What is in YOUR build: which harness, which MCP servers your agents can
      reach, how many subagents hold MCP tools, and whether the gate is installed
      AND wired (those are different, and both are quiet).
      Read-only, local, free. No model, no container, no network.

  doorman install [path] [--dry-run] [--json]
      Install the security gate (mcp-gate.sh), doorman subagent, /vet command,
      and doorman skill into a project, safely wiring .claude/settings.json
      and initializing the registry without overwriting existing trust lists.

  doorman needs [path] [--history DIR] [--candidates FILE] [--json]
      L0.5. What this build keeps REACHING for, read from its own prompt
      history, against what it already has. Then the graded feed, matched on
      capability text the candidates published about themselves.

      Free, keyless, and the history never leaves the machine: the one request
      is the same anonymous GET /feed that watch makes.

      A need nothing graded covers is printed as a GAP rather than dropped, and
      a match is only ever worth-measuring. Nothing here drove anything, so
      nothing here claims a server will work. Only eval answers that.

  doorman notify refresh [--root DIR]   |   doorman notify consume [--digest FILE]
      The push half, and the SessionStart hook is what calls it. refresh polls
      the feed and leaves a short digest on disk; consume prints that digest
      and deletes it. Nothing is announced on the first run, nothing is written
      when nothing is new, and a digest is shown exactly once.

  doorman report <link> [--out DIR] [--needed-for TEXT]
      L1. The static implementation report: protocol, schemas, annotations, and
      a scan-only pass over every description an agent would read before
      choosing a tool. Needs no model key.

  doorman eval <link> --task <file> [--runs N] [--max-cost USD] [--out DIR]
      L3. Runs the task N times in two images that differ by exactly one install
      layer, and reports success rate, turns, tool calls, tokens, cost and wall
      time per arm. Ends in ADOPT / DECLINE / INCONCLUSIVE.

      Needs ANTHROPIC_API_KEY and a running Docker. Fewer than 3 runs per arm
      cannot reach ADOPT: one sample cannot be told apart from luck. DECLINE
      stays reachable at any run count, so a cheap run is still worth doing.

  doorman eval <link> --task <file> --estimate
      What it WOULD cost. Spends nothing, needs no key, needs no Docker.
      Run this first. An agent loop resends the whole conversation every turn,
      so cost grows with the SQUARE of the turn count: on Sonnet, three runs
      per arm is $54 at worst. The ceiling exists because of that number.

  Candidate links doorman can install as one layer:
      npm:<package>            or  https://npmjs.com/package/<name>
      pip:<package>            or  https://pypi.org/project/<name>
      https://github.com/<owner>/<repo>

Options
  --agent NAME     which harness the arms drive: claude-code (default), builtin,
                   or exec. YOUR harness, YOUR key, YOUR machine. doorman passes
                   the credential straight into a local container and never
                   stores, logs or transmits it.
  --exec CMD       the command to run, with --agent exec
  --runs N         runs per arm (default 3)
  --max-cost USD   hard ceiling for the whole eval (default 5). The turn cap is
                   DERIVED from this rather than the other way round, so the
                   budget decides how long a run may get. Enforced by the same
                   permit ledger the doorman uses on its own outbound spend.
  --estimate       print the cost and exit. Spends nothing.
  --ledger PATH    permit ledger (default evals/.spend-ledger.jsonl)
  --out DIR        write reports here
  --model NAME     default claude-sonnet-5
  --allow-network  let the sandbox reach the network (default: --network none)
  --json           print the result object instead of prose
  --version, -v
  --help,    -h
`;

/**
 * Flags that take NO value. Without this list a boolean flag swallows the
 * positional after it, so `doorman allow --dry-run myserver` parsed as
 * `dry-run="myserver"` with no server at all, and `doorman needs --json .`
 * lost the path and then crashed. The flag-then-path order is the one people
 * type, and it was the broken one.
 */
const BOOLEAN_FLAGS = new Set([
  'json', 'dry-run', 'all', 'estimate', 'help', 'version', 'allow-network',
  'static-only', 'no-feed',
]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else if (a === '-h') out.help = true;
    else if (a === '-v') out.version = true;
    else out._.push(a);
  }
  return out;
}

const log = (m) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) { console.log(VERSION); return; }
  if (args.help || args._.length === 0) { console.log(HELP); return; }

  // `doctor` is the one command that needs no link: it reads the project.


  const [cmd, link] = args._;

  if (cmd === 'doctor') {
    const d = await doctor(args._[1] || process.cwd());
    if (!d.ok) { console.error(`doctor: ${d.why}`); process.exitCode = 1; return; }
    if (args.json) { console.log(JSON.stringify(d, null, 2)); return; }
    console.log(renderDoctor(d));
    return;
  }

  if (cmd === 'install') {
    const target = args._[1] || process.cwd();
    const dryRun = Boolean(args['dry-run']);
    const r = await install(target, { dryRun });
    if (!r.ok) { console.error(`install: ${r.why}`); process.exitCode = 1; return; }
    if (args.json) { console.log(JSON.stringify(r, null, 2)); return; }
    console.log(renderInstall(r));
    return;
  }

  if (cmd === 'allow') {
    const r = allow(args._[1], {
      scope: typeof args.scope === 'string' ? args.scope : 'user',
      root: process.cwd(),
      why: typeof args.why === 'string' ? args.why : null,
      dryRun: Boolean(args['dry-run']),
    });
    if (!r.ok) { console.error(renderAllow(r)); process.exitCode = 2; return; }
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(renderAllow(r));
    return;
  }

  if (cmd === 'needs') {
    let r;
    try {
      r = await readNeeds({
        root: args._[1] || process.cwd(),
        api: (args.api || DEFAULT_API).replace(/\/+$/, ''),
        historyDir: typeof args.history === 'string' ? args.history : undefined,
        candidateFile: typeof args.candidates === 'string' ? args.candidates : 'candidates/smithery.json',
      });
    } catch (e) {
      console.error(`needs: ${e.message}`);
      process.exitCode = e.code === 3 ? 3 : 1;
      return;
    }
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(renderNeedsCli(r));
    return;
  }

  if (cmd === 'discover') {
    const pages = Number(args.pages) > 0 ? Number(args.pages) : 1;
    const out = args.out || 'candidates/smithery.json';
    // Reading the feed is free and only used to avoid re-proposing what is
    // already graded. --no-feed skips it for an offline sweep.
    const feedApi = args['no-feed'] ? null : (args.api || DEFAULT_API).replace(/\/+$/, '');
    let r;
    try {
      r = await discover({ pages, feedApi });
    } catch (e) {
      console.error(`discover: ${e.message}`);
      process.exitCode = e.code === 3 ? 3 : 1;
      return;
    }
    writeCandidates(out, r);
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(renderDiscover(r, out));
    return;
  }

  if (cmd === 'watch') {
    const root = args._[1] || process.cwd();
    const api = (args.api || DEFAULT_API).replace(/\/+$/, '');
    const stateFile = args.state || DEFAULT_STATE;
    // --since beats the state file, and --all ignores both. Neither writes a
    // cursor: a one-off look must not move a subscription's place in the feed.
    const oneOff = Boolean(args.since || args.all);
    const since = args.all ? null : (args.since || readState(stateFile).since);
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 50;

    let r;
    try {
      r = await watch({ root, api, since, limit });
    } catch (e) {
      console.error(`watch: ${e.message}`);
      process.exitCode = e.code === 3 ? 3 : 1;
      return;
    }

    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(renderWatch(r));

    // Only advance the cursor when this was a real poll AND the feed moved.
    // An empty page leaves it alone, so nothing can be skipped by a run that
    // happened to arrive between two grades.
    if (!oneOff && !args['dry-run'] && r.next_since) {
      writeState(stateFile, { since: r.next_since, seen: r.candidates.length, updated: new Date().toISOString() });
      if (!args.json) console.log(`\ncursor saved to ${stateFile}`);
    } else if (oneOff && !args.json) {
      console.log('\nOne-off look: the saved cursor was not moved.');
    }
    return;
  }

  // The push half. Two verbs, and neither is meant to be typed by a human:
  // the SessionStart hook calls `consume`, then `refresh` detached.
  if (cmd === 'notify') {
    const sub = args._[1];
    const root = args.root || process.cwd();

    if (sub === 'consume') {
      const file = args.digest || join(root, DEFAULT_DIGEST);
      const text = consumeDigest(file);
      if (text) console.log(text);
      // Nothing to say is exit 0 and silence, not an error. See rule 1 in
      // notify.mjs: a notifier that speaks every session gets ignored.
      return;
    }

    if (sub === 'refresh') {
      const api = (args.api || DEFAULT_API).replace(/\/+$/, '');
      try {
        const r = await refreshNotify({ root, api, limit: Number(args.limit) > 0 ? Number(args.limit) : 50 });
        if (args.json) console.log(JSON.stringify(r, null, 2));
        else if (r.firstRun) console.log('First run: cursor established, nothing announced.');
        else console.log(r.wrote ? `digest written to ${r.digest}` : 'nothing new, no digest written');
      } catch (e) {
        // Could not measure is 3, same as watch. This runs detached from a
        // hook, so the exit code lands in .doorman/notify.log and nowhere else.
        console.error(`notify refresh: ${e.message}`);
        process.exitCode = e.code === 3 ? 3 : 1;
      }
      return;
    }

    console.error('notify needs a subcommand: consume or refresh');
    process.exitCode = 2;
    return;
  }

  if (!['report', 'eval'].includes(cmd)) {
    console.error(`unknown command "${cmd}". Try: doorman --help`);
    process.exitCode = 2;
    return;
  }
  if (!link) {
    console.error(`${cmd} needs a candidate link. Try: doorman --help`);
    process.exitCode = 2;
    return;
  }

  if (cmd === 'report') {
    const out = args.out || `./doorman-report-${Date.now()}`;
    const r = await report({ link, out, neededFor: args['needed-for'], log });
    if (!r.ok) {
      console.error(`\nreport failed: ${r.why}`);
      if (r.hint) console.error(`\n${r.hint}`);
      if (r.detail) console.error(`\n${r.detail}`);
      process.exitCode = 1;
      return;
    }
    if (args.json) { console.log(JSON.stringify(r.grade, null, 2)); return; }
    const g = r.grade;
    console.log('');
    console.log(`L1 static report for ${link}`);
    console.log(`  grade         ${g.grade ?? 'n/a'} ${typeof g.score === 'number' ? `(${g.score})` : ''}`);
    console.log(`  hard fail     ${g.hard_fail ? 'YES' : 'no'}`);
    console.log(`  written to    ${r.out}`);
    console.log('');
    console.log('This is the static layer only. It says nothing about whether an agent');
    console.log('can actually use the thing: that is what `doorman eval` measures.');
    return;
  }

  // eval
  if (!args.task) {
    console.error('eval needs --task <file>. Try: doorman --help');
    process.exitCode = 2;
    return;
  }
  const runs = Number(args.runs ?? 3);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
    console.error('--runs must be an integer between 1 and 20');
    process.exitCode = 2;
    return;
  }

  const maxCostUsd = Number(args['max-cost'] ?? 5);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    console.error('--max-cost must be a positive number of USD');
    process.exitCode = 2;
    return;
  }

  const r = await evaluate({
    link,
    taskPath: args.task,
    runs,
    out: args.out,
    model: args.model || 'claude-sonnet-5',
    allowNetwork: Boolean(args['allow-network']),
    maxCostUsd,
    estimateOnly: Boolean(args.estimate),
    ledgerPath: args.ledger || 'evals/.spend-ledger.jsonl',
    log,
  });

  if (r.ok && r.estimateOnly) {
    const { renderEstimate } = await import('./cost.mjs');
    console.log('');
    console.log(renderEstimate(r.estimate));
    console.log('');
    console.log(`Your ceiling is $${maxCostUsd.toFixed(2)}. Nothing was spent to tell you this.`);
    return;
  }

  if (!r.ok) {
    console.error(`\neval did not run:\n\n${r.why}`);
    if (r.detail) console.error(`\n${r.detail}`);
    // A refusal for a missing prerequisite is not the same as a crash, and the
    // pipeline reads the code: 3 means "could not measure", 1 means "broke".
    process.exitCode = r.blocked ? 3 : 1;
    return;
  }

  if (args.json) { console.log(JSON.stringify(r, null, 2)); return; }
  const { renderMarkdown } = await import('./eval.mjs');
  console.log('');
  console.log(renderMarkdown(r));
}

main().catch((e) => {
  console.error(`doorman: ${e && e.stack ? e.stack : e}`);
  process.exitCode = 1;
});
