/**
 * The scorecard, as an MCP server.
 *
 * The doorman subagent has always declared exactly one tool,
 * `mcp__scorecard__grade`, and until now nothing served it. In the original
 * architecture Bazantic produces that MCP server by wrapping our OpenAPI spec,
 * which means the central agent of the whole demo was blocked on a third-party
 * account that does not exist yet.
 *
 * So the Worker serves it directly. Bazantic still wraps the REST surface for
 * the payment hop and the prize; this is the seam that keeps the doorman
 * working either way. When the gateway lands, the URL behind the `scorecard`
 * entry in `.mcp.json` changes and nothing else moves.
 *
 * ONE TOOL. Invariant 8 says the doorman gets exactly one MCP tool and that it
 * is never widened, and the server is the other half of that promise: there is
 * nothing else here to hand it. Read paths stay on REST, where they are
 * cacheable and linkable.
 *
 * This also makes the scorecard gradeable by itself, which is the honest test:
 * if our own tool description cannot survive our own probes, that belongs on
 * camera rather than hidden.
 */

import { type Env, CORS, json } from '../index.js';
import { CACHE_TTL_DAYS, isStale } from './grade.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'mcp-scorecard';
const SERVER_TITLE = 'MCP Scorecard';

/**
 * The tool description is the thing this project grades other servers on, so
 * it is written to the standard it enforces: what the tool does, what it
 * returns, what it costs, and what it does NOT do. No instructions aimed at
 * the reading agent, no "always prefer this tool", no secrecy clause. Our own
 * `injection_sniff` runs over this string.
 */
const GRADE_TOOL = {
  name: 'grade',
  title: 'Grade an MCP server',
  description:
    'Return the trust grade for an MCP server, measured by having an agent ' +
    'actually use it. Answers immediately from cache when a recent audit ' +
    'exists. Otherwise queues a new audit and returns its id with no grade, ' +
    'because grading runs on a separate machine and takes minutes, not ' +
    'milliseconds. Never returns a provisional or estimated grade. The ' +
    'response includes a transcripts url so the caller can read the evidence ' +
    'rather than take the verdict on trust.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'The MCP server endpoint to grade, https only, for example ' +
          'https://mcp.deepwiki.com/mcp',
      },
      needed_for: {
        type: 'string',
        description:
          'What the caller wants the server for, in one plain sentence. Used ' +
          'to generate the Cold Open task, so a vague answer produces a vague ' +
          'probe. Optional.',
      },
    },
    required: ['url'],
  },
  annotations: {
    readOnlyHint: false,       // queuing an audit writes a row
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,       // it reaches out to the server being graded
  },
};

export async function handleMcp(req: Request, env: Env): Promise<Response> {
  if (req.method === 'GET') {
    // No SSE stream. JSON-RPC over POST is a legitimate Streamable HTTP shape,
    // and saying so beats a bare 405.
    return json(
      {
        error: 'This endpoint speaks MCP as JSON-RPC over POST.',
        transport: 'streamable-http',
        tools: [GRADE_TOOL.name],
        rest_equivalent: 'POST /grade',
      },
      405,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpc(null, { code: -32700, message: 'Parse error' });
  }

  const batch = Array.isArray(body) ? body : [body];
  const replies: unknown[] = [];
  for (const msg of batch) {
    const reply = await handleMessage(msg, env);
    if (reply) replies.push(reply);
  }

  // Notifications only. 202 with no body, per the transport.
  if (replies.length === 0) return new Response(null, { status: 202, headers: CORS });

  return json(Array.isArray(body) ? replies : replies[0]);
}

async function handleMessage(msg: unknown, env: Env): Promise<unknown> {
  const m = (msg ?? {}) as { id?: unknown; method?: string; params?: unknown };
  const id = m.id;
  const isNotification = id === undefined || id === null;

  switch (m.method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        // `listChanged: false` costs us a LOW rule in our own audit
        // (`capability_tools_list_changed`) and stays false anyway. We do not
        // emit tools/list_changed notifications, and with one tool that never
        // changes we never will. Declaring a capability we do not have to buy
        // back a point is the exact dishonesty this service grades other
        // servers on. Taking the deduction is the cheaper price.
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: '0.1.0' },
        instructions:
          'One tool: grade. Grading is asynchronous because it runs on a ' +
          'machine that can execute Python. A queued audit returns an id and ' +
          'no grade; poll GET /grade/{id} or call grade again later. Evidence ' +
          'for every grade is public at GET /grade/{id}/transcripts.',
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return ok(id, {});

    case 'tools/list': {
      // One tool, so there is never a second page. An unrecognised cursor is
      // still a caller error and must be rejected rather than silently
      // ignored: returning page one for a cursor we never issued would hand
      // back data the caller did not ask for and look like success.
      const cursor = (m.params as { cursor?: unknown } | undefined)?.cursor;
      if (cursor !== undefined && cursor !== null) {
        return rpcBody(id, {
          code: -32602,
          message:
            'Invalid params: unknown pagination cursor. tools/list returns a ' +
            'single page and issues no nextCursor, so no cursor is valid here.',
        });
      }
      return ok(id, { tools: [GRADE_TOOL] });
    }

    case 'tools/call':
      return ok(id, await callTool(m.params, env));

    default:
      if (isNotification) return null;
      return rpcBody(id, { code: -32601, message: 'Method not found: ' + String(m.method) });
  }
}

async function callTool(params: unknown, env: Env): Promise<unknown> {
  const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  if (p.name !== GRADE_TOOL.name) {
    return toolError(
      'Unknown tool "' + String(p.name) + '". This server exposes exactly one: grade.',
    );
  }

  const args = p.arguments ?? {};
  const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
  if (!rawUrl) {
    return toolError('Missing required argument "url" (string): the MCP endpoint to grade.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return toolError(
      'Argument "url" is not a valid URL: "' + rawUrl + '". ' +
      'Expected something like https://mcp.deepwiki.com/mcp',
    );
  }
  if (parsed.protocol !== 'https:') {
    // Refusing here rather than grading and hard-failing later: a plaintext
    // endpoint cannot be audited honestly, since anything on the wire can be
    // rewritten before we read it.
    return toolError(
      'Refusing to grade a non-https endpoint (' + parsed.protocol + '). ' +
      'A transport that can be rewritten in flight cannot produce evidence.',
    );
  }

  const needed_for = typeof args.needed_for === 'string' ? args.needed_for : undefined;

  const cached = await env.DB.prepare(
    'SELECT id, server_name, grade, score, hard_fail, model, mcpscore_version, ' +
    'evidence_sha256, report_md, recipe_md, completed_at, created_at FROM audits ' +
    "WHERE server_url = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1",
  ).bind(parsed.toString()).first();

  if (cached && !isStale(String(cached.completed_at ?? cached.created_at))) {
    return toolResult({
      graded: true,
      server_url: parsed.toString(),
      server_name: cached.server_name,
      grade: cached.grade,
      score: cached.score,
      hard_fail: cached.hard_fail,
      model: cached.model,
      mcpscore_version: cached.mcpscore_version,
      evidence_sha256: cached.evidence_sha256,
      audit_id: cached.id,
      graded_at: cached.completed_at,
      cache_ttl_days: CACHE_TTL_DAYS,
      transcripts: '/grade/' + cached.id + '/transcripts',
      report_md: cached.report_md,
      recipe_md: cached.recipe_md,
    });
  }

  // No usable cache. Queue, and say plainly that there is no grade yet. The
  // one thing this must never do is return a number that looks like a grade.
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO audits (id, server_url, needed_for, status, model, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, parsed.toString(), needed_for ?? null, 'queued', env.PROBE_MODEL, now),
    env.DB.prepare(
      'INSERT INTO pending (id, server_url, needed_for, requested_by, created_at) ' +
      'VALUES (?, ?, ?, ?, ?)',
    ).bind(id, parsed.toString(), needed_for ?? null, 'mcp', now),
    env.DB.prepare(
      'INSERT INTO ledger (id, audit_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), id, 'queued', parsed.toString(), now),
  ]);

  return toolResult({
    graded: false,
    reason: cached ? 'cached grade is older than ' + CACHE_TTL_DAYS + ' days' : 'never graded',
    server_url: parsed.toString(),
    audit_id: id,
    status: 'queued',
    poll: '/grade/' + id,
    note:
      'Queued. Grading runs on a probe runner, not in this Worker, because the ' +
      'static layer shells out to a Python tool. There is no grade yet and no ' +
      'estimate of one. Do not treat an ungraded server as trusted.',
  });
}

/**
 * MCP tool results carry their payload as text. Sending JSON the caller has to
 * parse is still better than prose it has to interpret, so the structured copy
 * goes in `structuredContent` and the text block is the same object.
 */
function toolResult(payload: Record<string, unknown>): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/**
 * A tool-level error, not a protocol error.
 *
 * `isError: true` with a message the caller can act on is what Bad Input
 * Recovery grades other servers on. Returning "Invalid input" here while
 * scoring other people on their error messages would be indefensible.
 */
function toolError(message: string): unknown {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function ok(id: unknown, result: unknown): unknown {
  return id === undefined || id === null ? null : { jsonrpc: '2.0', id, result };
}
function rpcBody(id: unknown, error: { code: number; message: string }): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error };
}
function rpc(id: unknown, error: { code: number; message: string }): Response {
  return json(rpcBody(id, error), 400);
}

/** Exported so tests can assert the description we advertise. */
export { GRADE_TOOL };
