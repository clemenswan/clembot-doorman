/**
 * One complete audit, end to end.
 *
 * This is the function the poll loop calls, and the same function `--once`
 * calls for a local dry run. Keeping it separate from the loop means the
 * expensive, interesting part can be tested and demoed without a Worker,
 * a token, or a network queue.
 */

import {
  SCAN_ONLY_PROBES, buildRecipe, buildReport, deriveRules, grade, handshake,
  hashBundle, measureGuidance, runAllProbes, toGradeInput, toStaticLayer,
  transcriptsToJsonl,
} from './lib.mjs';
import { AnthropicLlmClient, HttpMcpClient, runMcpscore } from './host-node.mjs';

/**
 * @param {object} job          { audit_id, server_url, needed_for, model, temperature, runs }
 * @param {object} opts         { apiKey, mcpscoreBin, log, skipBehavioral, skipGuidance }
 */
export async function runAudit(job, opts = {}) {
  const log = opts.log ?? (() => {});
  const started = Date.now();

  // --- Static layer -------------------------------------------------------
  log(`[static] running mcpscore against ${job.server_url}`);
  const { report, exitCode } = await runMcpscore(job.server_url, { bin: opts.mcpscoreBin });
  const staticLayer = toStaticLayer(report);
  log(
    `[static] ${staticLayer.score}/${staticLayer.max_score} = ${staticLayer.pct}% ` +
    `(mcpscore exit ${exitCode})`,
  );
  if (staticLayer.hard_fail) log(`[static] HARD FAIL: ${staticLayer.hard_fail}`);

  // --- Handshake & inventory ---------------------------------------------
  const mcp = new HttpMcpClient(job.server_url);
  const inventory = await handshake(mcp, job.server_url, staticLayer.server_name);
  log(`[inventory] ${inventory.tools.length} tools: ${inventory.tools.map((t) => t.name).join(', ')}`);

  // Free exit for a dead server. No point paying for probes against nothing.
  if (inventory.tools.length === 0) {
    const g = grade({
      server_url: job.server_url, model: job.model, static: staticLayer,
      probes: [], guidance: null,
    });
    return finish({
      job, g, probes: [], inventory, staticLayer, started, log,
      guidance: {
        measured: false,
        skip_reason: 'the server advertises no tools, so there was nothing to guide',
        rules_given: 0, baseline_pct: null, guided_pct: null, regression: false,
      },
    });
  }

  // --- Probes -------------------------------------------------------------
  //
  // --static-only drops the probes that need a MODEL. It does not drop the
  // scan-only ones: injection_sniff reads strings the server already gave us,
  // costs nothing, and is the only probe that can cap a grade at F. Skipping it
  // for want of a key would mean the cheapest audits were the ones that stayed
  // quiet about hostile tool descriptions.
  const staticOnly = Boolean(opts.skipBehavioral);
  const llm = staticOnly
    ? refusingLlm(job)
    : new AnthropicLlmClient({
        apiKey: opts.apiKey,
        model: job.model,
        temperature: job.temperature ?? 0,
      });

  const ctx = {
    mcp,
    llm,
    inventory,
    needed_for: job.needed_for,
    runs: job.runs ?? 3,
    // Transcripts accumulate on the ProbeResult itself; this hook is for
    // live logging only. It must never filter or shorten anything.
    log: () => {},
    now: () => new Date().toISOString(),
  };

  if (staticOnly) log(`[probes] model probes skipped (--static-only); running ${SCAN_ONLY_PROBES.join(', ')}`);

  const probes = await runAllProbes(ctx, {
    only: staticOnly ? SCAN_ONLY_PROBES : undefined,
    onProbeDone: (r) => {
      log(
        r.applicable
          ? `[probe] ${r.probe_id}: ${r.score}` +
            (r.hard_fail ? ` HARD FAIL ${r.hard_fail}` : '')
          : `[probe] ${r.probe_id}: skipped (${r.skip_reason})`,
      );
    },
  });

  // --- Guidance delta -----------------------------------------------------
  //
  // A SECOND cold_open, with the drafted recipe in the system prompt. It costs
  // as much as the first one, so it is skippable and the skip is recorded.
  //
  // The provisional grade below exists only to satisfy deriveRules' input
  // shape: deriveRules reads probes and nothing else, which a test pins, so
  // the rules the guided agent sees do not depend on a score computed from a
  // layer that has not been measured yet.
  const provisional = {
    server_url: job.server_url,
    needed_for: job.needed_for,
    model: job.model,
    static: staticLayer,
    probes,
    guidance: null,
  };

  let guidance = {
    measured: false,
    skip_reason: staticOnly
      ? 'no model available: audit is running --static-only'
      : 'guidance pass disabled for this run (--no-guidance)',
    rules_given: 0,
    baseline_pct: null,
    guided_pct: null,
    regression: false,
  };

  if (!staticOnly && !opts.skipGuidance) {
    const rules = deriveRules({ grade: grade(provisional), probes });
    log(`[guidance] re-running cold_open with ${rules.length} recipe rule(s)`);
    guidance = await measureGuidance({ ctx, probes, rules });
    log(
      guidance.measured
        ? `[guidance] cold ${guidance.baseline_pct} -> guided ${guidance.guided_pct}` +
          (guidance.regression ? '  REGRESSION: the recipe made it worse' : '')
        : `[guidance] not measured: ${guidance.skip_reason}`,
    );
  } else {
    log(`[guidance] not measured: ${guidance.skip_reason}`);
  }

  const g = grade({
    ...provisional,
    // Null means NOT MEASURED, and the weights renormalise over the layers
    // that were. It is never silently scored zero.
    guidance: toGradeInput(guidance),
  });

  return finish({ job, g, probes, guidance, inventory, staticLayer, started, log });
}

/**
 * The model client handed to probes in --static-only mode.
 *
 * It throws rather than returning a plausible empty answer. runAllProbes turns
 * a thrown probe into `skipped` with the reason attached, so if a scan-only
 * probe ever starts reaching for a model the audit records why it stopped
 * instead of scoring the server on a completion that never happened.
 */
function refusingLlm(job) {
  return {
    model: job.model,
    temperature: job.temperature ?? 0,
    complete() {
      throw new Error('no model available: audit is running --static-only');
    },
  };
}

async function finish({ job, g, probes, guidance, inventory, staticLayer, started, log }) {
  const report_md = buildReport({
    grade: g, probes, guidance, audit_id: job.audit_id,
    server_name: staticLayer.server_name,
  });
  const recipe_md = buildRecipe({
    grade: g, probes, server_name: staticLayer.server_name,
    tools: inventory.tools.map((t) => ({ name: t.name, description: t.description })),
  });

  const bundle = {
    audit_id: job.audit_id,
    server_url: job.server_url,
    grade: g,
    probes,
    // In the hash on purpose. The guidance layer moves the final score, so a
    // bundle that hashed everything EXCEPT it would let 20 points change
    // without the evidence hash changing.
    guidance,
    report_md,
    recipe_md,
  };
  const evidence_sha256 = await hashBundle(bundle);

  // One row per probe run, transcripts verbatim.
  const transcripts = [];
  for (const p of probes) {
    for (const run of p.runs) {
      transcripts.push({
        probe_id: p.probe_id,
        run_index: run.run_index,
        score: run.score,
        jsonl: transcriptsToJsonl([{ ...p, runs: [run] }]),
      });
    }
  }

  // The guided pass is stored under its OWN probe_id. It is a cold_open run by
  // construction, but filing it as `cold_open` would make the tape look like
  // six baseline runs and quietly change what anyone replaying it measured.
  for (const run of guidance?.guided?.runs ?? []) {
    transcripts.push({
      probe_id: 'cold_open_guided',
      run_index: run.run_index,
      score: run.score,
      jsonl: transcriptsToJsonl([{ ...guidance.guided, runs: [run] }]),
    });
  }

  log(
    `[grade] ${g.band} ${g.score}/100 in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
    `sha256=${evidence_sha256.slice(0, 12)}...`,
  );

  return {
    audit_id: job.audit_id,
    status: 'complete',
    server_name: staticLayer.server_name,
    grade: g,
    grade_json: g,
    guidance,
    report_md,
    recipe_md,
    evidence_sha256,
    transcripts,
  };
}
