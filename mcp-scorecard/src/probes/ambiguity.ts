/**
 * Probe 3 - Ambiguity Gauntlet.
 *
 * Only fires when two tools genuinely overlap. The task is phrased to tempt
 * the wrong one. What is being graded is whether the DESCRIPTIONS draw a line
 * an agent can act on: two tools that both say "search the codebase" are a
 * design defect the server owner can fix, and this probe is the evidence.
 */

import type { ProbeResult, ProbeRun, TurnRecord } from '../grade/types.js';
import { mean, type Inventory, type Probe, type ProbeContext, type ToolSpec } from './types.js';

/** Jaccard overlap over description terms. Above this, two tools compete. */
export const OVERLAP_THRESHOLD = 0.34;

export interface OverlapPair { a: ToolSpec; b: ToolSpec; overlap: number }

export const ambiguity: Probe = {
  id: 'ambiguity',
  applicable(inv: Inventory) {
    if (inv.tools.length < 2) return 'fewer than 2 tools, nothing can overlap';
    return findOverlappingPair(inv.tools)
      ? true
      : 'no two tool descriptions overlap enough to be ambiguous';
  },

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const pair = findOverlappingPair(ctx.inventory.tools)!;
    const runs: ProbeRun[] = [];
    const failure_modes = new Set<string>();

    for (let i = 0; i < ctx.runs; i++) {
      const transcript: TurnRecord[] = [];
      const rec = (role: TurnRecord['role'], content: unknown) => {
        const r: TurnRecord = { ts: ctx.now(), role, content };
        transcript.push(r);
        ctx.log(r);
      };

      // Target is the SECOND tool; the task is worded using the first tool's
      // vocabulary, so description quality is the only thing that saves it.
      const target = pair.b;
      const task = temptingTask(pair.a, pair.b);
      rec('note', {
        probe: 'ambiguity', run_index: i,
        pair: [pair.a.name, pair.b.name], overlap: pair.overlap, target: target.name,
      });
      rec('user', task);

      const out = await ctx.llm.complete({
        system: SYSTEM,
        messages: [{ role: 'user', content: task }],
        tools: ctx.inventory.tools,
      });
      rec('assistant', { text: out.text, tool_calls: out.tool_calls });

      const chosen = out.tool_calls[0]?.name ?? null;
      const correct = chosen === target.name;
      if (!correct) {
        const pct = Math.round(pair.overlap * 100);
        failure_modes.add(
          'tools ' + pair.a.name + ' and ' + pair.b.name + ' overlap ' + pct +
          '% and the agent picked ' + (chosen ?? 'nothing') +
          ' when ' + target.name + ' was meant',
        );
      }

      const score = correct ? 100 : chosen ? 25 : 0;
      rec('note', { chosen, correct, score });

      runs.push({
        run_index: i,
        score,
        signals: {
          pair: pair.a.name + '|' + pair.b.name,
          overlap: pair.overlap,
          target: target.name,
          chosen: chosen ?? '(none)',
          correct,
        },
        transcript,
      });
    }

    return {
      probe_id: 'ambiguity',
      applicable: true,
      runs,
      score: mean(runs.map((r) => r.score)),
      failure_modes: [...failure_modes],
    };
  },
};

const SYSTEM =
  'You are an agent with access to an MCP server. Choose the single most ' +
  'appropriate tool for the request and call it. Do not ask questions.';

/** The most-confusable pair of tools, or null when none compete. */
export function findOverlappingPair(tools: ToolSpec[]): OverlapPair | null {
  let best: OverlapPair | null = null;
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const o = jaccard(terms(tools[i]), terms(tools[j]));
      if (o >= OVERLAP_THRESHOLD && (!best || o > best.overlap)) {
        best = { a: tools[i], b: tools[j], overlap: Math.round(o * 100) / 100 };
      }
    }
  }
  return best;
}

/**
 * Phrase the task in tool A's language while actually wanting tool B. If B's
 * description is doing its job, the agent still lands on B.
 */
function temptingTask(a: ToolSpec, b: ToolSpec): string {
  const lure = firstSentence(a.description ?? a.name);
  const want = firstSentence(b.description ?? b.name);
  return 'I want to ' + lure.toLowerCase() + '. Specifically, what I need is: ' +
    want.toLowerCase() + '. Use the right tool.';
}

function firstSentence(s: string): string {
  const m = s.split(/[.?]/)[0];
  return (m ?? s).trim();
}

function terms(t: ToolSpec): Set<string> {
  const s = (t.name + ' ' + (t.title ?? '') + ' ' + (t.description ?? '')).toLowerCase();
  return new Set(s.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
