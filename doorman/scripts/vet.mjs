#!/usr/bin/env node
/**
 * /vet, as a program.
 *
 *   node scripts/vet.mjs <url|repo|path> --needed-for "what you want it for"
 *   node scripts/vet.mjs <...> --type repo        force the candidate type
 *   node scripts/vet.mjs <...> --dry-run          fit only, never touch the scorecard
 *
 * Fit first, money second. A redundant candidate returns before a scorecard
 * client is constructed, which is why the slash command is a thin wrapper over
 * this rather than prose that asks an agent to remember the order.
 *
 * Env: ANTHROPIC_API_KEY, DOORMAN_MODEL, DOORMAN_INVENTORY_ROOT,
 *      DOORMAN_VAULT_PATH, SCORECARD_API,
 *      DOORMAN_MAX_USDC_PER_RUN, DOORMAN_MAX_USDC_PER_DAY. See env.example.
 *
 * Never calls process.exit(): on Node 25 / Windows that trips a libuv assertion
 * during teardown and replaces the real exit code with 127.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anthropicClient, MissingApiKeyError } from '../src/llm.mjs';
import { openBudget, DEFAULT_PER_DAY_USDC, DEFAULT_PER_RUN_USDC } from '../src/budget.mjs';
import { scorecardClient } from '../src/scorecard.mjs';
import { runVet } from '../src/vet.mjs';
import { writeNote } from '../src/note.mjs';
import { findInventoryRoot, gatherInventory } from '../src/inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, '..', 'registry');

const args = parse(process.argv.slice(2));
const target = args._[0];

if (!target || args.help) {
  console.log(`
doorman vet

  node scripts/vet.mjs <url|repo|path> [options]

  --needed-for TXT   what you want it for. Seeds the fit review and the probes.
  --type TYPE        mcp-server | skill | repo. Overrides detection.
  --dry-run          fit review only. Never constructs a scorecard client.
  --no-note          print the result, write no note.
  --max-usdc N       per-run spend cap. Default DOORMAN_MAX_USDC_PER_RUN, else 1.
  --max-usdc-day N   per-day spend cap. Default DOORMAN_MAX_USDC_PER_DAY, else 5.

The price is read from the service, never assumed. If it cannot be read the
run stops without spending: an unknown price is not a free one.

Fit runs first and is free. The paid grade only fires if fit passes AND the
candidate is an MCP server. A redundant candidate costs nothing.
`);
  process.exitCode = target ? 0 : 1;
} else {
  await main().catch((e) => {
    console.error('\n' + (e instanceof MissingApiKeyError ? e.message : `error: ${e.message}`) + '\n');
    process.exitCode = 1;
  });
}

async function main() {
  const root = process.env.DOORMAN_INVENTORY_ROOT || findInventoryRoot(process.cwd());
  const inventory = gatherInventory({ root, registryDir: REGISTRY });

  console.log(`\n  candidate  ${target}`);
  console.log(`  inventory  ${root ?? 'NONE FOUND'} - ${inventory.agents.length} agents, ` +
              `${inventory.skills.length} skills, ${inventory.mcpServers.length} mcp servers`);
  for (const n of inventory.notes) console.log(`             gap: ${n}`);

  const llm = anthropicClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.DOORMAN_MODEL,
  });

  const budget = args['dry-run'] ? undefined : openBudget({
    ledgerPath: join(REGISTRY, 'spend.ndjson'),
    perRunUsdc: num(args['max-usdc'], process.env.DOORMAN_MAX_USDC_PER_RUN, DEFAULT_PER_RUN_USDC),
    perDayUsdc: num(args['max-usdc-day'], process.env.DOORMAN_MAX_USDC_PER_DAY, DEFAULT_PER_DAY_USDC),
  });
  if (budget) {
    console.log(`  budget     ${budget.spentToday()} spent today, ${budget.remainingToday()} of ` +
                `${budget.perDayUsdc} left. Per-run cap ${budget.perRunUsdc}.`);
    if (budget.damagedLines) {
      console.log(`  WARNING    ${budget.damagedLines} unreadable line(s) in the spend ledger. ` +
                  'Today may be under-counted.');
    }
  }

  const api = process.env.SCORECARD_API;
  const makeScorecard = args['dry-run']
    ? undefined
    : () => {
        if (!api) throw new Error('SCORECARD_API is not set, so the paid grade cannot run');
        return scorecardClient({ api, budget });
      };

  const result = await runVet(target, {
    llm, makeScorecard, budget, inventory,
    needed_for: args['needed-for'],
    type: args.type,
  });

  report(result);

  if (!args['no-note']) {
    const w = writeNote(result, {
      vaultPath: process.env.DOORMAN_VAULT_PATH,
      registryDir: REGISTRY,
    });
    if (w.warning) console.log(`\n  WARNING  ${w.warning}`);
    console.log(`\n  note     ${w.path}${w.fellBack ? '  (fallback, not the vault)' : ''}`);
    console.log('           status: pending. Nothing is allowlisted until you flip it.');
  }
}

/** One blank line. Written this way so no anchor in this file needs an escape. */
const BLANK = String.fromCharCode(10);

function report(r) {
  const f = r.fit;
  console.log(`\n  FIT      ${f.verdict.toUpperCase()}${f.owner ? ' -> ' + f.owner : ''}`);
  console.log(`           ${f.rationale}`);
  if (f.overlaps.length) {
    console.log('\n  Already covered by:');
    for (const o of f.overlaps) console.log(`    - ${o.kind} ${o.name}: ${o.why}`);
  }

  if (r.stopped_at === 'fit') {
    console.log('\n  STOPPED before the paid grade. $0.00 spent.');
    console.log('           Nothing was sent to the scorecard, and no client was built.');
    return;
  }
  if (r.stopped_at === 'budget') {
    console.log(BLANK + '  REFUSED  the spend cap said no. $0.00 spent.');
    console.log('           ' + r.why);
    console.log('           Raise it with --max-usdc / --max-usdc-day if you mean to.');
    return;
  }
  if (r.stopped_at === 'price-unknown') {
    console.log(BLANK + '  REFUSED  could not read the price, so nothing was bought.');
    console.log('           ' + r.why);
    console.log('           An unknown price is not a free one.');
    return;
  }
  if (r.stopped_at === 'scan') {
    console.log(`\n  SCAN     ${r.scan.hard} hard, ${r.scan.steering} steering ` +
                `over ${r.scan.scanned_chars} chars${r.scan.truncated ? ' (TRUNCATED)' : ''}`);
    console.log('           behavioral grade: n/a - no tools to probe');
    for (const m of r.scan.failure_modes.slice(0, 3)) console.log(`    - ${m}`);
    return;
  }
  if (r.stopped_at === 'queued') {
    console.log(BLANK + `  SPENT    ${r.cost_usdc} USDC` +
                (r.cost_usdc === 0 ? '  (the service states it is free right now)' : ''));
  }
  if (r.grade) {
    console.log(`\n  GRADE    ${r.grade.grade} ${r.grade.score}/100  (cached)`);
    if (r.grade.hard_fail) console.log(`           HARD FAIL: ${r.grade.hard_fail}`);
    console.log(`           tape: ${r.transcripts}`);
    return;
  }
  console.log(`\n  QUEUED   audit ${r.audit_id}`);
  console.log('           No grade yet, and no estimate of one. Run the probe runner.');
  console.log(`           tape (once it exists): ${r.transcripts}`);
}

/** First finite number among a CLI flag, an env var, and a default. */
function num(...candidates) {
  for (const c of candidates) {
    const n = typeof c === 'number' ? c : Number(c);
    if (c !== undefined && c !== true && c !== '' && Number.isFinite(n)) return n;
  }
  return undefined;
}

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[k] = next; i++; }
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
