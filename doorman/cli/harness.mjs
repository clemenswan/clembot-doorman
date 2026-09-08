/**
 * Runs INSIDE the sandbox container. One task, one agent loop, one JSON line out.
 *
 * This file is copied into both images verbatim, so the only thing that differs
 * between arms is whether the candidate's install layer is present. It reads the
 * task on stdin and prints exactly one metrics object on stdout as its last line.
 *
 * Success is decided by the task's own machine-checkable conditions, never by
 * asking a model whether it did well. A model-judged pass is not comparable
 * across arms: the judge sees a different transcript each time, and its leniency
 * is one more thing varying between the two numbers you are trying to compare.
 */

const MODEL = process.env.DOORMAN_MODEL || 'claude-sonnet-5';
const KEY = process.env.ANTHROPIC_API_KEY;
// Derived from the money, not a constant. cli/cost.mjs works out how many
// turns fit the ceiling and passes it in; 24 is only the fallback when this
// file is run outside that orchestration.
const MAX_TURNS = Number(process.env.DOORMAN_MAX_TURNS) || 24;

/** Priced per million tokens. Unknown model means cost is reported as null. */
const PRICES = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
};

const files = new Map();

const TOOLS = [
  {
    name: 'write_file',
    description: 'Write text to a file in the working directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file previously written in this session.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'fetch_url',
    description: 'HTTP GET a public URL and return the response body as text.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
];

async function callTool(name, input) {
  if (name === 'write_file') {
    files.set(String(input.path), String(input.content ?? ''));
    return `wrote ${input.path} (${String(input.content ?? '').length} chars)`;
  }
  if (name === 'read_file') {
    return files.has(String(input.path)) ? files.get(String(input.path)) : 'ENOENT';
  }
  if (name === 'fetch_url') {
    try {
      const r = await fetch(String(input.url), { redirect: 'follow' });
      const t = await r.text();
      return `HTTP ${r.status}\n${t.slice(0, 20000)}`;
    } catch (e) {
      // With --network none this is the expected path, and it is reported to the
      // model rather than crashing the run: how an agent copes with a dead
      // network is itself part of what the two arms are being compared on.
      return `fetch failed: ${e.message}`;
    }
  }
  return `unknown tool ${name}`;
}

/** Every condition must be machine-checkable. See the note at the top. */
function checkSuccess(success) {
  const failures = [];
  const all = [...files.values()].join('\n');

  if (success.file_exists) {
    const want = Array.isArray(success.file_exists) ? success.file_exists : [success.file_exists];
    for (const f of want) if (!files.has(f)) failures.push(`missing file ${f}`);
  }
  if (success.contains) {
    const want = Array.isArray(success.contains) ? success.contains : [success.contains];
    for (const s of want) {
      if (!all.toLowerCase().includes(String(s).toLowerCase())) failures.push(`missing text "${s}"`);
    }
  }
  if (success.sections) {
    const n = Number(success.sections);
    const found = (all.match(/^#{1,6} /gm) || []).length;
    if (found < n) failures.push(`wanted ${n} sections, found ${found}`);
  }
  return failures;
}

async function main() {
  const raw = await new Promise((res) => {
    let b = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { b += d; });
    process.stdin.on('end', () => res(b));
  });
  const task = JSON.parse(raw);

  if (!KEY) {
    // Invariant 9: a missing key stops the run and says so. It never produces a
    // number, because a fabricated benchmark is worse than no benchmark.
    console.log(JSON.stringify({
      success: false, blocked: true,
      error: 'ANTHROPIC_API_KEY is not set inside the sandbox, so no run happened.',
    }));
    return;
  }

  const messages = [{ role: 'user', content: task.prompt }];
  let turns = 0, toolCalls = 0, inTok = 0, outTok = 0, stop = 'max_turns';

  while (turns < MAX_TURNS) {
    turns++;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, temperature: 0, tools: TOOLS, messages }),
    });
    if (!res.ok) {
      console.log(JSON.stringify({
        success: false, turns, tool_calls: toolCalls,
        error: `model call failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
      }));
      return;
    }
    const body = await res.json();
    inTok += body.usage?.input_tokens ?? 0;
    outTok += body.usage?.output_tokens ?? 0;
    messages.push({ role: 'assistant', content: body.content });

    const uses = (body.content || []).filter((c) => c.type === 'tool_use');
    if (!uses.length) { stop = 'end_turn'; break; }

    const results = [];
    for (const u of uses) {
      toolCalls++;
      results.push({ type: 'tool_result', tool_use_id: u.id, content: await callTool(u.name, u.input || {}) });
    }
    messages.push({ role: 'user', content: results });
  }

  const failures = checkSuccess(task.success || {});
  const p = PRICES[MODEL];
  console.log(JSON.stringify({
    success: failures.length === 0,
    failures,
    turns,
    tool_calls: toolCalls,
    tokens: inTok + outTok,
    input_tokens: inTok,
    output_tokens: outTok,
    cost_usd: p ? (inTok / 1e6) * p.in + (outTok / 1e6) * p.out : null,
    stop_reason: stop,
    files_written: [...files.keys()],
  }));
}

main().catch((e) => {
  console.log(JSON.stringify({ success: false, error: String(e && e.message ? e.message : e) }));
});
