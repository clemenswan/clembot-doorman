/**
 * Probe 4 — Bad Input Recovery.
 *
 * Deliberately omit a required parameter, then measure whether the server's
 * error message contains enough for the agent to fix itself within two turns.
 *
 * The thing being graded is the ERROR MESSAGE, not the agent. "Invalid input"
 * and "missing required parameter 'repoName' (string, e.g. facebook/react)"
 * are the same failure and completely different products.
 *
 *   rejected the bad call at all   30   accepting junk is worse than erroring
 *   error names the problem field  25
 *   error is actionable            15   says what a valid value looks like
 *   agent self-corrected <=2 turns 30
 */

import type { ProbeResult, ProbeRun, TurnRecord } from '../grade/types.js';
import { mean, type Inventory, type Probe, type ProbeContext, type ToolSpec } from './types.js';

export const badInput: Probe = {
  id: 'bad_input',

  applicable(inv: Inventory) {
    return pickToolWithRequired(inv.tools)
      ? true
      : 'no tool declares a required parameter to omit';
  },

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const runs: ProbeRun[] = [];
    const failure_modes = new Set<string>();
    const picked = pickToolWithRequired(ctx.inventory.tools)!;
    const omitted = requiredParams(picked)[0];

    for (let i = 0; i < ctx.runs; i++) {
      const transcript: TurnRecord[] = [];
      const rec = (role: TurnRecord['role'], content: unknown) => {
        const r: TurnRecord = { ts: ctx.now(), role, content };
        transcript.push(r);
        ctx.log(r);
      };

      rec('note', { probe: 'bad_input', run_index: i, tool: picked.name, omitted });

      // Send the call with the required param deliberately missing.
      const bad = { ...fillOptional(picked) };
      delete (bad as Record<string, unknown>)[omitted];
      rec('tool_call', { name: picked.name, args: bad, note: `omitted required '${omitted}'` });

      const res = await ctx.mcp.callTool(picked.name, bad);
      rec('tool_result', res);

      const rejected = !res.ok;
      const msg = (res.error?.message ?? JSON.stringify(res.content) ?? '').toString();
      const namesField = msg.toLowerCase().includes(omitted.toLowerCase());
      const actionable = isActionable(msg);

      if (!rejected) {
        failure_modes.add(
          `server accepted a call missing required '${omitted}' instead of rejecting it`,
        );
      }
      if (rejected && !namesField) {
        failure_modes.add(
          `error for missing '${omitted}' does not name the field: "${truncateForSummary(msg)}"`,
        );
      }
      if (rejected && !actionable) {
        failure_modes.add(
          `error for missing '${omitted}' gives no guidance on a valid value`,
        );
      }

      // Can the agent fix it from the error alone, within two turns?
      let corrected = false;
      let turns = 0;
      if (rejected) {
        const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
          {
            role: 'user',
            content:
              `You called tool "${picked.name}" with ${JSON.stringify(bad)} and the ` +
              `server returned this error:\n\n${msg}\n\n` +
              `Correct the call and issue it again.`,
          },
        ];
        for (; turns < 2; turns++) {
          const out = await ctx.llm.complete({
            system: SYSTEM,
            messages,
            tools: [picked],
          });
          rec('assistant', { text: out.text, tool_calls: out.tool_calls });
          const call = out.tool_calls[0];
          if (!call) break;
          rec('tool_call', call);
          const r2 = await ctx.mcp.callTool(call.name, call.args);
          rec('tool_result', r2);
          if (r2.ok) {
            corrected = true;
            break;
          }
          messages.push({ role: 'assistant', content: out.text || '(tool call)' });
          messages.push({
            role: 'user',
            content: `Still failing: ${r2.error?.message ?? 'unknown error'}. Try again.`,
          });
        }
        if (!corrected) {
          failure_modes.add(
            `agent could not self-correct a missing '${omitted}' within 2 turns`,
          );
        }
      }

      const score =
        (rejected ? 30 : 0) +
        (namesField ? 25 : 0) +
        (actionable ? 15 : 0) +
        (corrected ? 30 : 0);

      rec('note', { signals: { rejected, namesField, actionable, corrected, turns }, score });

      runs.push({
        run_index: i,
        score,
        signals: {
          tool: picked.name,
          omitted_param: omitted,
          rejected,
          error_names_field: namesField,
          error_actionable: actionable,
          self_corrected: corrected,
          correction_turns: turns,
        },
        transcript,
      });
    }

    return {
      probe_id: 'bad_input',
      applicable: true,
      runs,
      score: mean(runs.map((r) => r.score)),
      failure_modes: [...failure_modes],
    };
  },
};

const SYSTEM =
  'You are an agent fixing a failed tool call. Read the error, correct the ' +
  'arguments, and call the tool again. Do not ask questions.';

export function requiredParams(t: ToolSpec): string[] {
  const req = (t.inputSchema as { required?: unknown } | undefined)?.required;
  return Array.isArray(req) ? req.filter((x): x is string => typeof x === 'string') : [];
}

export function pickToolWithRequired(tools: ToolSpec[]): ToolSpec | null {
  return tools.find((t) => requiredParams(t).length > 0) ?? null;
}

/** Plausible values for every OTHER property, so only one thing is wrong. */
function fillOptional(t: ToolSpec): Record<string, unknown> {
  const props = (t.inputSchema as { properties?: Record<string, { type?: string }> } | undefined)
    ?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    switch (v?.type) {
      case 'number': case 'integer': out[k] = 1; break;
      case 'boolean': out[k] = false; break;
      case 'array': out[k] = []; break;
      case 'object': out[k] = {}; break;
      default: out[k] = 'test';
    }
  }
  return out;
}

/**
 * An error is actionable when it does more than announce failure: it names a
 * type, shows an example, lists valid options, or quotes the schema.
 */
export function isActionable(msg: string): boolean {
  if (!msg || msg.length < 12) return false;
  const m = msg.toLowerCase();
  const signals = [
    /requir/, /expected/, /must be/, /should be/, /e\.g\./, /for example/,
    /valid (values|options)/, /one of/, /type\s*[:=]/, /string|number|integer|boolean|array|object/,
    /schema/, /format/,
  ];
  return signals.filter((re) => re.test(m)).length >= 2;
}

function truncateForSummary(s: string): string {
  // Summary lines only. The full message is preserved verbatim in the transcript.
  return s.length > 120 ? `${s.slice(0, 120)}...` : s;
}
