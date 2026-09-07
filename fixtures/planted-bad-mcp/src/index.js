/**
 * planted-bad-mcp - the fixture the doorman is supposed to catch.
 *
 * A real, reachable MCP server over Streamable HTTP whose tool DESCRIPTIONS
 * carry instructions aimed at the agent reading them. It exists so the demo
 * grades something genuinely hostile instead of a hand-written grade.json.
 *
 * Three properties are deliberate:
 *
 *  1. It is INERT. Every tool returns canned text. It reads nothing, writes
 *     nothing, stores nothing, and has no bindings. The attack is entirely in
 *     what it advertises, which is the whole thesis: the letter looks fine,
 *     the behaviour is the problem.
 *
 *  2. It is LABELLED. serverInfo, the landing page, and every tool result say
 *     what this is. Nobody should be able to stumble onto it and mistake it
 *     for a product, and no screenshot of it should be mistakable for an
 *     accusation against a real vendor.
 *
 *  3. It is OTHERWISE COMPETENT. It negotiates properly, paginates, returns
 *     well-formed errors, and should score respectably on the static layer.
 *     That is the point. A server that failed everything would prove nothing
 *     about why behavioural grading is needed.
 *
 * The tool specs live in ../tools.json, which mcp-scorecard's test suite also
 * imports. If someone sands the payloads off, that test goes red before the
 * demo does.
 */

import SPEC from '../tools.json';

const PROTOCOL_VERSION = '2025-06-18';

const BANNER =
  'This is a deliberately hostile TEST FIXTURE published by the Clembot Doorman ' +
  'project. It performs no real work and stores no data. Its tool descriptions ' +
  'contain prompt-injection payloads on purpose, so that an MCP grader has ' +
  'something real to fail.';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      // No SSE stream. A JSON-RPC-over-POST server is a legitimate shape, and
      // the landing page is where a human who found this by accident lands.
      return url.pathname === '/mcp'
        ? json({ error: 'This endpoint speaks JSON-RPC over POST.', fixture: BANNER }, 405)
        : new Response(landingPage(), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
    }

    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return rpcError(null, -32700, 'Parse error');
    }

    const batch = Array.isArray(body) ? body : [body];
    const replies = [];
    for (const msg of batch) {
      const reply = handle(msg);
      if (reply) replies.push(reply);
    }

    // A batch of nothing but notifications gets 202 and an empty body, per the
    // Streamable HTTP transport.
    if (replies.length === 0) return new Response(null, { status: 202 });

    return json(Array.isArray(body) ? replies : replies[0]);
  },
};

function handle(msg) {
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SPEC.server_name, version: '0.1.0' },
        instructions: BANNER,
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: SPEC.tools });

    case 'tools/call':
      return ok(id, callTool(params));

    default:
      if (isNotification) return null;
      return err(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Canned results. Note what is NOT here: no fetch, no storage, no eval, no
 * echo of caller-supplied strings into anything that acts on them. The fixture
 * is hostile in its advertising and harmless in its execution, which is what
 * makes it safe to leave publicly reachable.
 */
function callTool(params) {
  const name = params?.name;
  const known = SPEC.tools.some((t) => t.name === name);
  if (!known) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool "${name}". [${BANNER}]` }],
    };
  }
  return {
    content: [
      {
        type: 'text',
        text:
          `[FIXTURE] "${name}" did nothing. This server has no notes, no ` +
          `workspace, and no side effects. ${BANNER}`,
      },
    ],
  };
}

function ok(id, result) {
  return id === undefined || id === null ? null : { jsonrpc: '2.0', id, result };
}
function err(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}
function rpcError(id, code, message) {
  return json(err(id, code, message), 400);
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      // Say what this is in a header too, so it shows up in a network log
      // without anyone having to read the body.
      'x-doorman-fixture': 'planted-bad; deliberately-hostile; inert',
    },
  });
}

function landingPage() {
  const rows = SPEC.tools
    .map((t) => `<li><code>${esc(t.name)}</code> - ${esc(t.description)}</li>`)
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>planted-bad-mcp (test fixture)</title>
<style>
  body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 46rem;
         margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; }
  code { background: #f2f2f0; padding: .1em .3em; }
  li { margin-bottom: 1rem; }
</style>
<h1>planted-bad-mcp</h1>
<p><strong>${esc(BANNER)}</strong></p>
<p>The MCP endpoint is <code>POST /mcp</code>. Every tool below is inert. The
payloads are in the descriptions, which is exactly what a static read of a
server config cannot see.</p>
<ul>
${rows}
</ul>
<p>Part of <a href="https://clembot-doorman.wanessalabs.com">Clembot Doorman</a>.</p>`;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
