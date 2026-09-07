/**
 * A fake system, small enough to reason about.
 *
 * Deliberately NOT a snapshot of the real vault. A fixture that mirrors
 * production drifts silently and then tests nothing in particular; this one is
 * shaped around the three verdicts it has to distinguish.
 *
 * - `researcher` already fetches and reads web pages  -> a web-fetch candidate
 *   is REDUNDANT.
 * - nothing here touches a calendar                   -> a calendar candidate
 *   FITS, and `scheduler` is its obvious owner.
 * - nothing here has any business trading             -> a brokerage candidate
 *   is OUT-OF-SCOPE.
 */

export const inventory = {
  root: '/fake/project',
  agents: [
    {
      name: 'researcher',
      description: 'Fetches web pages and summarises them into a research brief.',
      tools: ['Read', 'WebFetch', 'WebSearch'],
      skills: [],
    },
    {
      name: 'scheduler',
      description: 'Plans and sequences work across a week. Owns no external integrations yet.',
      tools: ['Read', 'Write'],
      skills: [],
    },
    {
      name: 'reviewer',
      description: 'Reviews code for correctness and security. Read-only.',
      tools: ['Read', 'Grep', 'Glob'],
      skills: [],
    },
  ],
  skills: [
    { name: 'defuddle', description: 'Extracts clean readable text from a web page URL.' },
    { name: 'prd', description: 'Writes a product requirements document from a brief.' },
  ],
  mcpServers: [{ name: 'scorecard', url: 'https://scorecard.example.test/mcp' }],
  allowlisted: [{ key: 'scorecard', url: 'https://scorecard.example.test/mcp', grade: 'A' }],
  claudeMd: '# Fake Project\n\nA research and planning system. It does not handle money.',
  claudeMdTruncated: false,
  notes: [],
};

export const candidates = {
  redundant: {
    id: 'https://mcp.fetcher.example/mcp',
    type: 'mcp-server',
    needed_for: 'fetch a web page and give me the readable text',
    description: 'Fetches URLs and returns cleaned article text.',
  },
  fits: {
    id: 'https://mcp.calendar.example/mcp',
    type: 'mcp-server',
    needed_for: 'read and create events on my work calendar',
    description: 'Calendar read and write over MCP.',
  },
  outOfScope: {
    id: 'https://mcp.brokerage.example/mcp',
    type: 'mcp-server',
    needed_for: 'place equity trades from my account',
    description: 'Executes market orders.',
  },
};

/**
 * An llm stub that returns canned responses in order.
 *
 * Records every prompt it was given, so a test can assert that the retry
 * actually carried the problems forward rather than just asking again.
 */
export function stubLlm(responses, { model = 'claude-sonnet-5' } = {}) {
  const queue = [...responses];
  const calls = [];
  return {
    model,
    temperature: 0,
    calls,
    async complete(req) {
      calls.push(req);
      if (queue.length === 0) throw new Error('stubLlm ran out of responses');
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return { text: next, stop_reason: 'end_turn', raw: {} };
    },
  };
}

/** The real renderer, so tests exercise the block the model actually sees. */
export { renderInventory } from '../src/inventory.mjs';

export const json = (obj) => JSON.stringify(obj);
