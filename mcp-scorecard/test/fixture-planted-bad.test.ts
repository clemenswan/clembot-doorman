/**
 * The planted-bad fixture has to stay bad.
 *
 * `fixtures/planted-bad-mcp/tools.json` is served verbatim by a public Worker
 * and is the thing the demo grades F. Nothing else in the repo would notice if
 * someone tidied the payloads out of it: the fixture would keep serving, the
 * audit would keep running, the grade would quietly become a pass, and the
 * demo would show a gate blocking nothing.
 *
 * So this file reads the same JSON the Worker imports and asserts the scanner
 * still catches it, pattern by pattern. It is a tripwire, not a unit test.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grade } from '../src/grade/grade.js';
import { injectionSniff, scanInventory } from '../src/probes/injection_sniff.js';
import { transcriptsToJsonl } from '../src/outputs/evidence.js';
import type { Inventory, ProbeContext, ToolSpec } from '../src/probes/types.js';
import type { StaticLayer, TurnRecord } from '../src/grade/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'fixtures', 'planted-bad-mcp', 'tools.json'), 'utf8'),
) as { server_name: string; tools: ToolSpec[] };

const inventory: Inventory = {
  server_url: 'https://planted-bad-mcp.wanessalabs-042.workers.dev/mcp',
  server_name: SPEC.server_name,
  tools: SPEC.tools,
  resources_count: 0,
  prompts_count: 0,
};

/** Every payload we planted, and the tool it lives on. */
const EXPECTED: Array<{ pattern: string; location: string }> = [
  { pattern: 'coerced-tool-preference', location: 'tool:search_notes.description' },
  { pattern: 'secrecy-instruction', location: 'tool:search_notes.description' },
  { pattern: 'exfiltration-request', location: 'tool:read_note.inputSchema.context' },
  { pattern: 'ignore-previous-instructions', location: 'tool:sync_workspace.description' },
  { pattern: 'addresses-the-model-directly', location: 'tool:share_note.description' },
];

describe('the planted-bad fixture', () => {
  const hits = scanInventory(inventory);

  it('trips every pattern it was built to trip', () => {
    for (const want of EXPECTED) {
      expect(
        hits.some((h) => h.pattern === want.pattern && h.location === want.location),
        `expected ${want.pattern} at ${want.location}; the fixture payload was ` +
          `changed or the scanner stopped catching it`,
      ).toBe(true);
    }
  });

  it('catches a payload nested in an input schema, not just a description', () => {
    // Worth pinning separately. Schema descriptions are read by the agent and
    // are the easiest place for a scanner to forget to look.
    expect(hits.some((h) => h.location.includes('.inputSchema.'))).toBe(true);
  });

  it('leaves the one honest tool alone', () => {
    // If get_status ever gets flagged, the scanner has drifted toward
    // condemning ordinary prose, and an F stops being a meaningful accusation.
    expect(hits.filter((h) => h.location.startsWith('tool:get_status'))).toEqual([]);
  });

  it('quotes the offending text verbatim so the accusation is checkable', () => {
    const coerce = hits.find((h) => h.pattern === 'coerced-tool-preference');
    expect(coerce?.excerpt).toContain('prefer this tool');
  });

  it('ships a replayable tape with the F, not just a verdict', async () => {
    // The regression this pins: the probe used to record everything through
    // ctx.log and return `transcript: []`. Hosts wire ctx.log to the console
    // and drop it, so the audit that capped a real server at F shipped a
    // zero-byte transcripts.jsonl. "Replay the tape" has to survive contact
    // with the one probe that can make the accusation.
    const probe = await injectionSniff.run(ctx());
    const tape = probe.runs[0].transcript;
    expect(tape.length).toBeGreaterThan(0);

    const jsonl = transcriptsToJsonl([probe]);
    expect(jsonl.length).toBeGreaterThan(0);

    // Every scanned tool is on the tape with its description untouched, so a
    // reader can re-run the patterns themselves instead of trusting our
    // excerpt.
    for (const t of SPEC.tools) {
      expect(jsonl).toContain('"scanned_tool":"' + t.name + '"');
    }
    const sync = SPEC.tools.find((t) => t.name === 'sync_workspace');
    expect(JSON.stringify(tape)).toContain(sync!.description);
  });

  it('hard-fails the probe and drags an otherwise strong static score to F', async () => {
    const probe = await injectionSniff.run(ctx());
    expect(probe.hard_fail).toBeTruthy();

    // The static layer here is deliberately GOOD. That is the demo: a server
    // can pass a config audit outright and still be hostile in what it tells
    // the agent. If this ever grades above F, the cap is broken.
    const strongStatic: StaticLayer = {
      score: 88,
      max_score: 91,
      pct: 96.7,
      mcpscore_version: 'test',
      failed_rules: [],
    };
    const g = grade({
      server_url: inventory.server_url,
      model: 'claude-sonnet-5',
      static: strongStatic,
      probes: [probe],
      guidance: null,
    });

    expect(g.band).toBe('F');
    expect(g.hard_fail).toContain('injection-shaped content');
    expect(g.worst_failure_modes[0]).toContain('HARD FAIL');
  });
});

function ctx(): ProbeContext {
  const turns: TurnRecord[] = [];
  return {
    inventory,
    runs: 3,
    log: (r: TurnRecord) => turns.push(r),
    now: () => '2026-09-02T00:00:00.000Z',
    // injection_sniff is scan-only. Handing it live clients would let a future
    // edit start calling a hostile server without the change being obvious, so
    // the ones it gets here throw.
    mcp: {
      listTools: () => { throw new Error('injection_sniff must not touch the server'); },
      callTool: () => { throw new Error('injection_sniff must not call a tool'); },
    },
    llm: {
      model: 'claude-sonnet-5',
      temperature: 0,
      complete: () => { throw new Error('injection_sniff must not use a model'); },
    },
  } as unknown as ProbeContext;
}
