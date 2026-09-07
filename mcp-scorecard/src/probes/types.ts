/**
 * The probe-runner interface.
 *
 * This is the seam that makes the laptop fallback real. A probe never touches
 * fetch, fs, a subprocess, or a Workflow API. It receives clients and asks
 * them for things. Two hosts implement these clients:
 *
 *   - Cloudflare Workflow  (src/probes/host-workflow.ts)
 *   - Node laptop runner   (runner/host-node.mjs)
 *
 * A probe that reaches for a platform API breaks this and must be rejected in
 * review. The whole point is that the same probe code produces the same
 * evidence in both places.
 */

import type { ProbeId, ProbeResult, TurnRecord } from '../grade/types.js';

/** A tool as advertised by the server's tools/list. */
export interface ToolSpec {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** What Handshake & Inventory (probe 1) discovered. Probes gate on this. */
export interface Inventory {
  server_url: string;
  server_name?: string;
  tools: ToolSpec[];
  resources_count: number;
  prompts_count: number;
}

/** Minimal MCP client. Implemented per host. */
export interface McpClient {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpToolResult {
  ok: boolean;
  content: unknown;
  error?: { code?: number; message: string };
}

/** Minimal LLM client. Pinned model and temperature are set by the host. */
export interface LlmClient {
  readonly model: string;
  readonly temperature: number;
  /** One agentic turn: model sees tools, may emit a tool call or a final answer. */
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools?: ToolSpec[];
  max_tokens?: number;
}

export interface LlmResponse {
  stop_reason: string;
  text: string;
  tool_calls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  raw: unknown;
}

/** Everything a probe is given. Nothing else is available to it. */
export interface ProbeContext {
  mcp: McpClient;
  llm: LlmClient;
  inventory: Inventory;
  needed_for?: string;
  runs: number;                       // 3
  /**
   * Recipe rules to put in front of the agent, as a system-prompt block.
   *
   * Set ONLY by the guidance pass (src/probes/guidance.ts). A baseline run must
   * leave this undefined: the whole point of Cold Open is an agent that has
   * been told nothing, so a context carrying guidance into the cold pass would
   * silently turn the baseline into the thing it is supposed to be measured
   * against.
   */
  guidance?: string;
  /** Append one evidence record. Never truncates. Host persists it. */
  log(rec: TurnRecord): void;
  now(): string;                      // ISO timestamp, injectable for tests
}

/** Every probe implements exactly this. */
export interface Probe {
  readonly id: ProbeId;
  /** Cheap, synchronous gate. Returns a reason string when not applicable. */
  applicable(inv: Inventory): true | string;
  run(ctx: ProbeContext): Promise<ProbeResult>;
}

/** Convenience for probes: mean of numbers, 0 when empty. */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

/** Standard "not applicable" result so hosts and grade math agree. */
export function skipped(id: ProbeId, reason: string): ProbeResult {
  return {
    probe_id: id,
    applicable: false,
    skip_reason: reason,
    runs: [],
    score: null,
    failure_modes: [],
  };
}
