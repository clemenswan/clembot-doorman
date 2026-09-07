/**
 * Probe registry and the orchestration loop.
 *
 * Host-agnostic on purpose: this runs identically inside a Cloudflare Workflow
 * step and inside the Node laptop runner, because it only ever touches the
 * injected ProbeContext.
 */

import type { ProbeResult } from '../grade/types.js';
import { skipped, type Inventory, type Probe, type ProbeContext } from './types.js';
import { coldOpen } from './cold_open.js';
import { ambiguity } from './ambiguity.js';
import { badInput } from './bad_input.js';
import { chain } from './chain.js';
import { injectionSniff } from './injection_sniff.js';

/**
 * Order matters. injection_sniff runs FIRST and is scan-only: if a server is
 * advertising instructions at the agent reading it, we want that on record
 * before we point a model at it.
 */
export const PROBES: Probe[] = [injectionSniff, coldOpen, ambiguity, badInput, chain];

/**
 * Probes that need neither a model nor a tool call, and so can run on a host
 * with no Anthropic key.
 *
 * This list is the reason a static-only audit is not silent about injection.
 * The scan reads strings the server already handed us; refusing to run it
 * without a key would have withheld the single finding that caps a grade at F,
 * on exactly the audits most likely to be run by someone without a key.
 */
export const SCAN_ONLY_PROBES: string[] = [injectionSniff.id];

export { coldOpen, ambiguity, badInput, chain, injectionSniff };

/** Run every probe, honouring its own applicability gate. */
export async function runAllProbes(
  ctx: ProbeContext,
  opts: { only?: string[]; onProbeDone?: (r: ProbeResult) => void | Promise<void> } = {},
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const probe of PROBES) {
    if (opts.only && !opts.only.includes(probe.id)) continue;

    const gate = probe.applicable(ctx.inventory);
    let result: ProbeResult;
    if (gate !== true) {
      result = skipped(probe.id, gate);
    } else {
      try {
        result = await probe.run(ctx);
      } catch (err) {
        // A probe that throws is recorded as inapplicable with the reason, not
        // scored zero. We cannot tell a broken probe from a bad server, and
        // guessing would put the error into someone else's grade.
        result = skipped(probe.id, 'probe error: ' + errText(err));
      }
    }
    out.push(result);
    if (opts.onProbeDone) await opts.onProbeDone(result);
  }
  return out;
}

/** Probe 1 - Handshake & Inventory. Free exit for dead servers. */
export async function handshake(
  mcp: { listTools(): Promise<Inventory['tools']> },
  server_url: string,
  server_name?: string,
): Promise<Inventory> {
  const tools = await mcp.listTools();
  return { server_url, server_name, tools, resources_count: 0, prompts_count: 0 };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
