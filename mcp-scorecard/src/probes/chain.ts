/**
 * Probe 5 - Chain Test.
 *
 * Two steps, where step B must consume step A's actual output. This is where
 * servers that look fine tool-by-tool fall over: A returns an opaque blob, or
 * an id under a different name than B asks for, and nothing composes.
 *
 * Skipped under 3 tools, per the spec, and because a two-tool server has
 * nothing meaningful to chain.
 */

import type { ProbeResult, ProbeRun, TurnRecord } from '../grade/types.js';
import { mean, type Inventory, type Probe, type ProbeContext } from './types.js';

const MIN_TOOLS = 3;
const MAX_STEPS = 5;

export const chain: Probe = {
  id: 'chain',
  applicable(inv: Inventory) {
    return inv.tools.length >= MIN_TOOLS
      ? true
      : 'only ' + inv.tools.length + ' tools, need ' + MIN_TOOLS + ' to chain';
  },

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const runs: ProbeRun[] = [];
    const failure_modes = new Set<string>();

    for (let i = 0; i < ctx.runs; i++) {
      const transcript: TurnRecord[] = [];
      const rec = (role: TurnRecord['role'], content: unknown) => {
        const r: TurnRecord = { ts: ctx.now(), role, content };
        transcript.push(r);
        ctx.log(r);
      };

      const preamble = ctx.needed_for?.trim() ? ctx.needed_for.trim() + '\n\n' : '';
      const task = preamble +
        'Do this in two steps: first gather information with one tool, then ' +
        'feed what you learned into a second, different tool. The second call ' +
        'must use a real value returned by the first.';

      rec('note', { probe: 'chain', run_index: i });
      rec('user', task);

      const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
        { role: 'user', content: task },
      ];

      const called: string[] = [];
      let firstOutput: string | null = null;
      let consumed = false;
      let bothSucceeded = false;
      let secondOk = false;

      for (let step = 0; step < MAX_STEPS; step++) {
        const out = await ctx.llm.complete({
          system: SYSTEM, messages, tools: ctx.inventory.tools,
        });
        rec('assistant', { text: out.text, tool_calls: out.tool_calls });
        const call = out.tool_calls[0];
        if (!call) break;

        rec('tool_call', call);

        // Before running it, check whether this call reuses a value the
        // previous call actually returned. That is the whole point of a chain.
        if (called.length === 1 && firstOutput) {
          consumed = reusesValue(call.args, firstOutput);
        }

        const res = await ctx.mcp.callTool(call.name, call.args);
        rec('tool_result', res);
        called.push(call.name);

        if (called.length === 1) {
          firstOutput = JSON.stringify(res.content ?? '');
          if (!res.ok) {
            failure_modes.add('first chain step ' + call.name + ' failed outright');
          }
        } else if (called.length === 2) {
          secondOk = res.ok;
          bothSucceeded = res.ok;
          break;
        }

        messages.push({ role: 'assistant', content: out.text || '(tool call)' });
        messages.push({
          role: 'user',
          content: 'Tool ' + call.name + ' returned: ' +
            JSON.stringify(res.content).slice(0, 4000),
        });
      }

      const distinct = new Set(called).size >= 2;
      if (!distinct) failure_modes.add('agent never used a second, different tool');
      if (distinct && !consumed) {
        failure_modes.add(
          'second call did not reuse any value from ' + called[0] +
          ' output, so these tools do not compose',
        );
      }
      if (distinct && !secondOk) {
        failure_modes.add('second chain step ' + called[1] + ' rejected the chained value');
      }

      const score = (distinct ? 30 : 0) + (consumed ? 40 : 0) + (bothSucceeded ? 30 : 0);
      rec('note', { called, distinct, consumed, bothSucceeded, score });

      runs.push({
        run_index: i,
        score,
        signals: {
          tools_called: called.join(' -> ') || '(none)',
          two_distinct_tools: distinct,
          consumed_first_output: consumed,
          both_succeeded: bothSucceeded,
        },
        transcript,
      });
    }

    return {
      probe_id: 'chain',
      applicable: true,
      runs,
      score: mean(runs.map((r) => r.score)),
      failure_modes: [...failure_modes],
    };
  },
};

const SYSTEM =
  'You are an agent with access to an MCP server. Complete the task using ' +
  'two different tools in sequence, passing real output from the first into ' +
  'the second. Do not ask questions.';

/**
 * Did these arguments reuse a literal value from the previous output?
 *
 * Deliberately literal: we look for a non-trivial string or number from the
 * args appearing verbatim in the prior result. Anything cleverer would start
 * guessing at intent, and this needs to be defensible as evidence.
 */
export function reusesValue(args: Record<string, unknown>, prevOutput: string): boolean {
  const hay = prevOutput.toLowerCase();
  for (const v of Object.values(args)) {
    if (typeof v === 'number' && String(v).length >= 3 && hay.includes(String(v))) return true;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s.length >= 4 && hay.includes(s)) return true;
    }
  }
  return false;
}
