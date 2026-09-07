/**
 * Probe 2 — Cold Open.
 *
 * A fresh agent, the server's own tool descriptions, and a task built from
 * what the caller said they needed the server FOR. No hints, no recipe, no
 * retry coaching. This is the probe that answers the actual question: can an
 * agent that has never seen this server use it correctly on the first try?
 *
 * Scored on four signals, weighted by how much they cost a real user:
 *   first-try tool selection  40   picking the wrong tool wastes a whole turn
 *   first-try schema validity 30   a rejected call is a wasted turn too
 *   completion                20   did it finish at all
 *   step efficiency           10   how much wandering it took
 */

import type { ProbeResult, ProbeRun, TurnRecord } from '../grade/types.js';
import { mean, type Inventory, type Probe, type ProbeContext } from './types.js';

const MAX_STEPS = 6;

export const coldOpen: Probe = {
  id: 'cold_open',

  applicable(inv: Inventory) {
    return inv.tools.length > 0 ? true : 'server advertises no tools';
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

      const task = buildTask(ctx);
      const expected = expectedTool(ctx.inventory, ctx.needed_for);
      const system = systemFor(ctx);

      rec('note', {
        probe: 'cold_open',
        pass: ctx.guidance ? 'guided' : 'cold',
        run_index: i,
        expected_tool: expected,
      });
      // Recorded verbatim, recipe block included. A guided score is only
      // checkable by someone else if the tape shows what the agent was told.
      rec('system', system);
      rec('user', task);

      const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
        { role: 'user', content: task },
      ];

      let firstToolName: string | null = null;
      let firstCallValid: boolean | null = null;
      let completed = false;
      let steps = 0;

      for (; steps < MAX_STEPS; steps++) {
        const res = await ctx.llm.complete({
          system,
          messages,
          tools: ctx.inventory.tools,
        });
        rec('assistant', { text: res.text, tool_calls: res.tool_calls, stop_reason: res.stop_reason });

        if (res.tool_calls.length === 0) {
          // Model answered in prose. That is completion only if it actually
          // used a tool earlier; otherwise it refused or hallucinated.
          completed = firstToolName !== null;
          if (!completed) failure_modes.add('agent never attempted a tool call from descriptions alone');
          break;
        }

        for (const call of res.tool_calls) {
          if (firstToolName === null) firstToolName = call.name;
          rec('tool_call', call);

          const out = await ctx.mcp.callTool(call.name, call.args);
          rec('tool_result', out);

          if (firstCallValid === null) firstCallValid = out.ok;
          if (!out.ok && firstCallValid === false) {
            failure_modes.add(
              `first tool call rejected: ${out.error?.message ?? 'unknown error'}`,
            );
          }

          messages.push({ role: 'assistant', content: res.text || '(tool call)' });
          messages.push({
            role: 'user',
            content: `Tool ${call.name} returned: ${JSON.stringify(out.content).slice(0, 4000)}`,
          });
        }

        if (firstCallValid) {
          completed = true;
          break;
        }
      }

      const selectedRight = expected ? firstToolName === expected : firstToolName !== null;
      if (expected && firstToolName && firstToolName !== expected) {
        failure_modes.add(
          `agent reached for '${firstToolName}' when '${expected}' was the fit`,
        );
      }
      if (steps >= MAX_STEPS) {
        failure_modes.add(`agent burned ${MAX_STEPS} steps without completing`);
      }

      const score =
        (selectedRight ? 40 : 0) +
        (firstCallValid ? 30 : 0) +
        (completed ? 20 : 0) +
        stepPoints(steps);

      rec('note', {
        signals: { selectedRight, firstCallValid, completed, steps },
        score,
      });

      runs.push({
        run_index: i,
        score,
        signals: {
          first_tool: firstToolName ?? '(none)',
          first_try_selection: selectedRight,
          first_try_schema_valid: firstCallValid ?? false,
          completed,
          steps,
        },
        transcript,
      });
    }

    return {
      probe_id: 'cold_open',
      applicable: true,
      runs,
      score: mean(runs.map((r) => r.score)),
      failure_modes: [...failure_modes],
    };
  },
};

export const SYSTEM =
  'You are an agent with access to an MCP server. Use the provided tools to ' +
  'complete the task. Call a tool as soon as you can; do not ask clarifying ' +
  'questions. When the task is done, reply with a short plain-text answer.';

/**
 * The system prompt for this pass.
 *
 * The guidance block is APPENDED, never substituted, so the cold pass and the
 * guided pass differ by exactly one thing. Rewriting the base prompt for the
 * guided run would make the two scores measure two different experiments.
 */
export function systemFor(ctx: ProbeContext): string {
  return ctx.guidance ? SYSTEM + '\n' + ctx.guidance : SYSTEM;
}

/**
 * Build the task from `needed_for` when the caller supplied one, because that
 * is the job the server will actually be asked to do. Fall back to the best
 * tool's own description.
 */
function buildTask(ctx: ProbeContext): string {
  if (ctx.needed_for && ctx.needed_for.trim()) {
    return ctx.needed_for.trim();
  }
  const t = ctx.inventory.tools[0];
  return `Using this server, do the following: ${t?.description ?? t?.name ?? 'anything useful'}`;
}

/**
 * Which tool SHOULD have been picked. Naive term overlap against the stated
 * need. Returns null when we cannot tell, and the probe then only requires
 * that some tool was chosen — we never invent a right answer we cannot defend.
 */
export function expectedTool(inv: Inventory, needed_for?: string): string | null {
  if (!needed_for || inv.tools.length === 0) return null;
  const want = tokens(needed_for);
  if (want.size === 0) return null;

  let best: { name: string; hits: number } | null = null;
  let tie = false;
  for (const t of inv.tools) {
    const hay = tokens(`${t.name} ${t.title ?? ''} ${t.description ?? ''}`);
    let hits = 0;
    for (const w of want) if (hay.has(w)) hits++;
    if (!best || hits > best.hits) {
      best = { name: t.name, hits };
      tie = false;
    } else if (best && hits === best.hits) {
      tie = true;
    }
  }
  if (!best || best.hits === 0 || tie) return null;
  return best.name;
}

const STOP = new Set([
  'the','a','an','and','or','of','to','for','in','on','with','from','my','me',
  'i','is','are','be','get','use','using','this','that','it','please','server',
]);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function stepPoints(steps: number): number {
  if (steps <= 1) return 10;
  if (steps === 2) return 7;
  if (steps === 3) return 4;
  if (steps === 4) return 2;
  return 0;
}
