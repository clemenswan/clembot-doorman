/**
 * mcp-scorecard Worker.
 *
 * Deliberately small. The Worker does not grade anything: it cannot, because
 * mcpscore is Python with native dependencies and a Worker cannot spawn a
 * process. What it does is own the queue, the database, and the read surface.
 *
 *   POST /grade              enqueue an audit, return an id to poll
 *   GET  /grade/{id}         one audit by id
 *   GET  /grade?server=URL   latest cached grade for a server (cheap tier)
 *   GET  /allowlist/{owner}  published trust list
 *   GET  /badge/{server}.svg badge SVG
 *   GET  /api/pending        runners claim work here
 *   POST /api/result         runners post finished audits back
 *   GET  /api/ledger         demo site polls this (no streaming, free tier)
 *   POST /mcp                the scorecard AS an MCP server, one tool: grade
 *   GET  /price              what an audit costs, free to ask
 *   GET  /openapi.json       Bazantic import surface (3.1), runner routes filtered out
 *   GET  /openapi-3.0.json   the same filtered spec as 3.0.3, for importers that need it
 *
 * Hand-rolled routing on purpose: one fewer dependency, and the whole request
 * path stays readable in one screen.
 */

import {
  handleGrade, handleGetAudit, handleGetLatest, handleTranscripts,
} from './routes/grade.js';
import { handleAllowlist } from './routes/allowlist.js';
import { handleBadge } from './routes/badge.js';
import { handlePending, handleResult } from './routes/runner.js';
import { handleLedger } from './routes/ledger.js';
import { handleMcp } from './routes/mcp.js';
import { publicOpenApiSpec, publicOpenApiSpec30 } from './routes/openapi.js';
import { type PaymentEnv, handlePrice, paymentGate } from './routes/payment.js';

export interface Env extends PaymentEnv {
  DB: D1Database;
  PROBE_MODEL: string;
  PROBE_TEMPERATURE: string;
  PROBE_RUNS: string;
  ANTHROPIC_API_KEY?: string;
  RUNNER_TOKEN?: string;
  /** Authorises a PAID audit on POST /grade. Unset = static-only for everyone. */
  GRADE_TOKEN?: string;
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,payment-signature',
  // x402 v2 carries its protocol data in HEADERS and treats the body as an
  // implementation detail. Without expose-headers a browser client reads the
  // 402 and finds nothing in it, which looks exactly like a broken server.
  'access-control-expose-headers': 'payment-required,payment-response',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // Payment first, and it can only ever ADD a refusal. With payments off it
      // returns null and this line is a no-op, which is why the deployed demo
      // keeps working while the challenge is testable.
      const toll = paymentGate(req, env, path);
      if (toll) return toll;

      if (path === '/' || path === '/health') {
        return json({ ok: true, service: 'mcp-scorecard', model: env.PROBE_MODEL });
      }
      // Free and unauthenticated on purpose: a client that cannot look up the
      // price has to assume one, and an assumed price is always zero.
      if (path === '/price' && req.method === 'GET') {
        return handlePrice(env, url.origin + '/grade');
      }
      // PUBLIC document, not the full one. `/api/pending` and `/api/result`
      // stay routed below for self-hosted runners but are not described here:
      // an importer turns every described operation into a tool, and those two
      // are not reachable through the gateway. See stripPrivate().
      if (path === '/openapi.json') {
        return json(publicOpenApiSpec(url.origin));
      }
      // Same spec, transformed to 3.0.3. Not a second source of truth. Here
      // because importers are not uniform about 3.1 and the spec is the first
      // thing a partner has to ingest.
      if (path === '/openapi-3.0.json') {
        return json(publicOpenApiSpec30(url.origin));
      }

      if (path === '/grade' && req.method === 'POST') return handleGrade(req, env);
      if (path === '/grade' && req.method === 'GET') return handleGetLatest(url, env);

      const auditMatch = /^\/grade\/([A-Za-z0-9_-]+)$/.exec(path);
      if (auditMatch && req.method === 'GET') return handleGetAudit(auditMatch[1], env);

      // The evidence behind the grade above. Public on purpose: see the note
      // on handleTranscripts.
      const tapeMatch = /^\/grade\/([A-Za-z0-9_-]+)\/transcripts$/.exec(path);
      if (tapeMatch && req.method === 'GET') return handleTranscripts(tapeMatch[1], url, env);

      const allowMatch = /^\/allowlist\/([^/]+)$/.exec(path);
      if (allowMatch && req.method === 'GET') {
        return handleAllowlist(decodeURIComponent(allowMatch[1]), env);
      }

      if (path.startsWith('/badge/') && path.endsWith('.svg')) {
        return handleBadge(path.slice('/badge/'.length, -'.svg'.length), env);
      }

      // The scorecard as an MCP server. The doorman subagent's one tool lives
      // here, so it works with or without the Bazantic gateway.
      if (path === '/mcp') return handleMcp(req, env);

      if (path === '/api/pending' && req.method === 'GET') return handlePending(req, url, env);
      if (path === '/api/result' && req.method === 'POST') return handleResult(req, env);
      if (path === '/api/ledger' && req.method === 'GET') return handleLedger(url, env);

      return err('not found: ' + path, 404);
    } catch (e) {
      // Never leak a stack trace to a caller. The message is enough to act on.
      const message = e instanceof Error ? e.message : String(e);
      console.error('unhandled', message);
      return err('internal error: ' + message, 500);
    }
  },
};
