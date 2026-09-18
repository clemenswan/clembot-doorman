/**
 * Node host implementations of the probe-runner interface.
 *
 * These are the ONLY files in the probe path allowed to touch the network, the
 * filesystem, or a subprocess. Probes themselves receive these objects and can
 * do nothing the interface does not expose, which is what lets the same probe
 * code run in a Cloudflare Workflow later without edits.
 */

import { spawn } from 'node:child_process';

/* -------------------------------------------------------------------------
 * MCP client - Streamable HTTP
 * ---------------------------------------------------------------------- */

/**
 * A deliberately small MCP client. We speak just enough of the protocol to
 * list tools and call one. Pulling in the full SDK would add a dependency for
 * two methods.
 */
export class HttpMcpClient {
  constructor(url, { headers = {}, timeoutMs = 30_000 } = {}) {
    this.url = url;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.nextId = 1;
    this.initialized = false;
  }

  async rpc(method, params) {
    const id = this.nextId++;
    const headers = {
      'content-type': 'application/json',
      // Streamable HTTP servers may reply with either, so accept both.
      accept: 'application/json, text/event-stream',
      ...this.headers,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const body = await res.text();
    const payload = parseMaybeSse(body);
    if (payload?.error) {
      const e = new Error(payload.error.message ?? 'MCP error');
      e.rpcCode = payload.error.code;
      e.rpcData = payload.error.data;
      throw e;
    }
    return payload?.result;
  }

  async initialize() {
    if (this.initialized) return;
    const result = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-scorecard-probe', version: '0.1.0' },
    });
    // The notification is fire-and-forget; a server that rejects it is not
    // broken enough to abort the audit over.
    await this.notify('notifications/initialized').catch(() => {});
    this.initialized = true;
    this.serverInfo = result?.serverInfo;
    return result;
  }

  async notify(method, params) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.headers,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
  }

  async listTools() {
    await this.initialize();
    const out = [];
    let cursor;
    // Paginate. A server with 40 tools that we only read 20 of would be graded
    // on half its surface.
    do {
      const res = await this.rpc('tools/list', cursor ? { cursor } : {});
      for (const t of res?.tools ?? []) {
        out.push({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        });
      }
      cursor = res?.nextCursor;
    } while (cursor && out.length < 200);
    return out;
  }

  /**
   * Call a tool. A protocol-level error and a tool-level `isError` are BOTH
   * failures from the caller's point of view, and Bad Input Recovery grades
   * the message either way, so both are normalised into the same shape.
   */
  async callTool(name, args) {
    await this.initialize();
    try {
      const res = await this.rpc('tools/call', { name, arguments: args ?? {} });
      if (res?.isError) {
        return { ok: false, content: res.content, error: { message: textOf(res.content) } };
      }
      return { ok: true, content: res?.structuredContent ?? res?.content ?? res };
    } catch (e) {
      return {
        ok: false,
        content: e.rpcData ?? null,
        error: { code: e.rpcCode, message: String(e.message ?? e) },
      };
    }
  }
}

/**
 * Client options carrying a bearer credential, or nothing at all.
 *
 * Returns `{}` rather than `{ headers: {} }` for the anonymous case so that an
 * audit nobody gave a token to sends no Authorization header, instead of one
 * built from an empty string. A server answering a `Bearer ` with no value can
 * fail in a third way that is neither authenticated nor anonymous.
 *
 * Bearer only, deliberately: see mcpscoreSpawn for why the static half cannot
 * safely carry an arbitrary header, and a credential that reached one half of
 * the audit and not the other would produce a grade over two different
 * surfaces.
 */
export function authOptions(token) {
  return token ? { headers: { authorization: `Bearer ${token}` } } : {};
}

/** Streamable HTTP may answer as SSE. Pull the JSON payload out of either. */
export function parseMaybeSse(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  let last = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data && data !== '[DONE]') {
        try {
          last = JSON.parse(data);
        } catch {
          /* keep the last parseable frame */
        }
      }
    }
  }
  return last;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c?.text ?? JSON.stringify(c))).join(' ');
  }
  return JSON.stringify(content ?? '');
}

/* -------------------------------------------------------------------------
 * LLM client - Anthropic Messages API
 * ---------------------------------------------------------------------- */

/**
 * Pinned model, temperature 0. Both are recorded on every grade because a
 * behavioural grade is only meaningful relative to the model that produced it.
 */
export class AnthropicLlmClient {
  constructor({ apiKey, model, temperature = 0, maxTokens = 1024 }) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for behavioural probes');
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  async complete({ system, messages, tools, max_tokens }) {
    const body = {
      model: this.model,
      max_tokens: max_tokens ?? this.maxTokens,
      temperature: this.temperature,
      system,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };

    if (tools?.length) {
      body.tools = tools.map((t) => ({
        name: sanitizeToolName(t.name),
        description: t.description ?? t.title ?? t.name,
        input_schema: normaliseSchema(t.inputSchema),
      }));
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 400)}`);
    }

    const data = await res.json();
    const textParts = [];
    const toolCalls = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') textParts.push(block.text);
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
      }
    }

    return {
      stop_reason: data.stop_reason ?? 'unknown',
      text: textParts.join('\n'),
      tool_calls: toolCalls,
      raw: data,
    };
  }
}

/** Anthropic tool names are stricter than MCP's. Keep the mapping reversible. */
export function sanitizeToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * A tool with a missing or malformed schema still has to be offered to the
 * model, or the probe measures our strictness instead of the server's quality.
 */
export function normaliseSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const s = { ...schema };
  if (s.type !== 'object') s.type = 'object';
  if (!s.properties || typeof s.properties !== 'object') s.properties = {};
  return s;
}

/* -------------------------------------------------------------------------
 * mcpscore - the static layer
 * ---------------------------------------------------------------------- */

/**
 * The mcpscore invocation, split into argv and child environment.
 *
 * Separate from runMcpscore so a test can assert WHICH of the two a credential
 * lands in without spawning a process.
 *
 * WHY A TOKEN GOES IN THE ENVIRONMENT AND NEVER ON THE COMMAND LINE.
 *
 * mcpscore 1.11.0 offers three ways to authenticate and they are not equally
 * safe. `--token TOKEN` and `--header 'Authorization: Bearer ...'` both put the
 * secret in argv, which any other local user can read out of the process list
 * and which a shell may persist in its history. The third way is an
 * environment variable, and mcpscore's own `--help` says so:
 *
 *   --token TOKEN   Convenience for --header 'Authorization: Bearer <TOKEN>'.
 *                   Defaults to the MCPSCORE_TOKEN environment variable
 *                   (keeps tokens out of shell history).
 *
 * Verified in its source, not taken from the help text alone: `collect_headers`
 * at mcpscore/cli.py:271 reads `args.token or os.environ.get("MCPSCORE_TOKEN")`
 * and turns it into `Authorization: Bearer <token>`. So the env form is
 * exactly equivalent to `--token` with none of the exposure, and it is the only
 * form this runner uses.
 *
 * The consequence, stated because it is a real limit and not an oversight:
 * mcpscore has NO env-var path for an arbitrary header NAME. `--header` is argv
 * only. That is why this runner authenticates with a bearer token and offers no
 * general `--header` flag of its own: the general version could only have been
 * built by putting a secret in argv.
 *
 * The `headers` option below is the pre-existing escape hatch and IS argv
 * exposed. Nothing in this repo passes it. Do not route a credential through it.
 */
export function mcpscoreSpawn(target, { headers = [], token = null, env = process.env } = {}) {
  const args = ['--json'];
  // ARGV EXPOSED. Anything passed here is visible in the OS process list.
  for (const h of headers) args.push('--header', h);
  args.push(target);

  const childEnv = { ...env };
  // An anonymous audit must be anonymous. Without this delete, an ambient
  // MCPSCORE_TOKEN in the parent shell would silently authenticate a run the
  // caller asked to be public, and the grade's `authenticated` flag would be
  // correct while the caller's belief about what was measured was wrong.
  delete childEnv.MCPSCORE_TOKEN;
  if (token) childEnv.MCPSCORE_TOKEN = token;

  return { args, env: childEnv };
}

/**
 * Shell out to the mcpscore CLI and return its parsed JSON report.
 *
 * This function is the reason the Worker cannot do this job: mcpscore is
 * Python with native dependencies (cryptography, pydantic-core), so it cannot
 * run in a Worker isolate at all.
 *
 * Exit 3 means "graded, and it scored badly" - a RESULT, not a failure. Only
 * exits 1 and 2 mean the audit did not happen.
 *
 * `token`, when given, is a bearer credential. It is never logged, never
 * printed, and never placed in argv: see mcpscoreSpawn.
 */
export function runMcpscore(target, { bin = 'mcpscore', timeoutMs = 240_000, headers = [], token = null } = {}) {
  return new Promise((resolve, reject) => {
    const { args, env } = mcpscoreSpawn(target, { headers, token });

    const child = spawn(bin, args, { windowsHide: true, env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mcpscore timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`could not run "${bin}": ${e.message}. Is mcpscore installed?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 1 || code === 2) {
        reject(new Error(`mcpscore exit ${code}: ${lastLines(stderr, 4)}`));
        return;
      }
      try {
        resolve({ report: JSON.parse(stdout), exitCode: code, stderr });
      } catch (e) {
        reject(new Error(`mcpscore produced unparseable JSON (exit ${code}): ${e.message}`));
      }
    });
  });
}

function lastLines(s, n) {
  return s.trim().split(/\r?\n/).slice(-n).join(' | ');
}
