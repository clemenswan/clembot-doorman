/**
 * We hold ourselves to the standard we enforce.
 *
 * The scorecard is now an MCP server, which means its own tool description is
 * exactly the kind of string it caps other servers at F for. A grader whose own
 * advertising would fail its own scanner has no standing, and the failure would
 * be invisible: nothing else in the suite reads our tool description.
 *
 * Also pins invariant 8 from the server side. The doorman subagent promises to
 * hold exactly one MCP tool; this file is the other half, checking there is
 * nothing else here for it to be handed.
 */

import { describe, expect, it } from 'vitest';
import { GRADE_TOOL } from '../src/routes/mcp.js';
import { scanInventory } from '../src/probes/injection_sniff.js';
import type { Inventory, ToolSpec } from '../src/probes/types.js';

const inventory: Inventory = {
  server_url: 'https://scorecard.wanessalabs.com/mcp',
  server_name: 'mcp-scorecard',
  tools: [GRADE_TOOL as ToolSpec],
  resources_count: 0,
  prompts_count: 0,
};

describe('the scorecard as an MCP server', () => {
  it('passes its own injection scan', () => {
    const hits = scanInventory(inventory);
    expect(
      hits,
      'our own tool description trips our own scanner: ' +
        hits.map((h) => h.pattern + ' at ' + h.location).join(', '),
    ).toEqual([]);
  });

  it('exposes exactly one tool', () => {
    // Invariant 8. Widening this is a deliberate decision, not a refactor, and
    // it should have to delete this test to happen.
    expect(inventory.tools).toHaveLength(1);
    expect(GRADE_TOOL.name).toBe('grade');
  });

  it('says what it does NOT do, not only what it does', () => {
    // The one claim that keeps an async grader honest. An agent that reads
    // this description must not come away expecting a number on the first call.
    const d = GRADE_TOOL.description;
    expect(d).toContain('Never returns a provisional or estimated grade');
    expect(d.toLowerCase()).toContain('queues');
  });

  it('points the caller at the evidence, not just the verdict', () => {
    expect(GRADE_TOOL.description).toContain('transcripts');
  });

  it('documents its required argument well enough to self-correct', () => {
    // Bad Input Recovery grades other servers on exactly this. A required
    // param with no example is the failure we penalise elsewhere.
    const url = (GRADE_TOOL.inputSchema.properties as Record<string, { description: string }>).url;
    expect(GRADE_TOOL.inputSchema.required).toContain('url');
    expect(url.description).toContain('https://');
  });

  it('marks itself open-world, because it reaches out to a third party', () => {
    // A caller deciding whether to allow this tool needs to know it makes an
    // outbound request to a server it names. Understating that would be the
    // annotation equivalent of a misleading description.
    expect(GRADE_TOOL.annotations.openWorldHint).toBe(true);
    expect(GRADE_TOOL.annotations.readOnlyHint).toBe(false);
  });
});
