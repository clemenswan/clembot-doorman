/**
 * OpenAPI 3.1 spec, served at /openapi.json.
 *
 * This is the surface Bazantic imports to agentify the API, so it is written
 * for a MACHINE READER that has never seen this service. Every description
 * says what the field means and what a caller should do with it, because a
 * spec that only names types produces an agent that guesses.
 *
 * Generated in code rather than kept as a static file so the served origin is
 * always correct and the spec cannot drift from the routes beside it.
 */

export function openApiSpec(origin: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MCP Scorecard',
      version: '0.1.0',
      summary: 'Grades MCP servers by actually using them.',
      description:
        'Audits a Model Context Protocol server across three layers: a static ' +
        'conformance scan, behavioural probes that drive a real agent against ' +
        'the server, and a guidance delta measuring how much a drafted usage ' +
        'recipe improves a cold run.\n\n' +
        'Grading is ASYNCHRONOUS. POST /grade enqueues work and returns an ' +
        'audit id; poll GET /grade/{audit_id} until status is "complete".\n\n' +
        'Every grade is relative to the model that produced it, which is ' +
        'reported on every response and printed on the badge. Do not compare ' +
        'grades produced by different models.',
      contact: { name: 'Wanessa Labs', url: 'https://clembot-doorman.wanessalabs.com' },
      license: { name: 'MIT' },
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'grading', description: 'Request and read audits' },
      { name: 'trust', description: 'Published allowlists and badges' },
      { name: 'runner', description: 'Probe-runner queue. Requires a bearer token.' },
    ],
    paths: {
      '/grade': {
        post: {
          operationId: 'requestGrade',
          tags: ['grading'],
          summary: 'Queue one or more MCP servers for grading',
          description:
            'Enqueues an audit and returns 202 with an audit id per server. ' +
            'Grading does not happen in this request: the static layer shells ' +
            'out to the mcpscore Python CLI on a probe runner. Poll ' +
            'GET /grade/{audit_id}. Supply needed_for whenever you can, as the ' +
            'Cold Open probe builds its task from it and the grade is more ' +
            'meaningful when the probe reflects your real use case. ' +
            'CALLING WITHOUT AUTHORIZATION IS SUPPORTED and returns 202: the ' +
            'audit is queued static-only, meaning the configuration layer is ' +
            'graded and no model tokens are spent, so the behavioural and ' +
            'guidance layers report as not measured rather than as zero. ' +
            'Send a Bearer gradeToken to authorise a full run. A token that ' +
            'is presented and not accepted returns 401 and queues nothing: ' +
            'it is never downgraded silently, because a caller that believes ' +
            'it is authenticated would otherwise learn it was not from a ' +
            'grade that is quietly missing 70 of its 100 points. Each entry ' +
            'in the response carries depth: full or static-only.',
          security: [{}, { gradeToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/GradeRequestItem' },
                    {
                      type: 'array',
                      maxItems: 20,
                      items: { $ref: '#/components/schemas/GradeRequestItem' },
                    },
                  ],
                },
                examples: {
                  single: {
                    summary: 'One server with a stated purpose',
                    value: {
                      name: 'DeepWiki',
                      url: 'https://mcp.deepwiki.com/mcp',
                      needed_for: 'look up how a public GitHub repository works',
                    },
                  },
                },
              },
            },
          },
          responses: {
            202: {
              description: 'Queued. Poll each returned poll URL.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/QueuedResponse' } },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: {
              description:
                'A grade token was presented and not accepted, so nothing was ' +
                'queued. Omit the Authorization header entirely for a free, ' +
                'static-only audit.',
            },
          },
        },
        get: {
          operationId: 'getLatestGrade',
          tags: ['grading'],
          summary: 'Read the most recent completed grade for a server',
          description:
            'The cheap read tier. Returns the newest completed audit for the ' +
            'given server URL, with a "stale" flag when it is older than 30 ' +
            'days. Returns 404 when the server has never been graded, which is ' +
            'not an error: it means you should POST /grade first.',
          parameters: [
            {
              name: 'server', in: 'query', required: true,
              schema: { type: 'string', format: 'uri' },
              description: 'The MCP server URL, exactly as it was graded.',
            },
          ],
          responses: {
            200: {
              description: 'The latest completed audit.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Audit' } } },
            },
            404: { description: 'Never graded.' },
          },
        },
      },
      '/grade/{audit_id}': {
        get: {
          operationId: 'getAudit',
          tags: ['grading'],
          summary: 'Read one audit by id',
          description:
            'Poll this after POST /grade. status moves queued -> running -> ' +
            'complete (or failed). The grade, one-page report, drafted recipe ' +
            'and evidence hash are all present once status is "complete".',
          parameters: [
            {
              name: 'audit_id', in: 'path', required: true,
              schema: { type: 'string' },
              description: 'The id returned by requestGrade.',
            },
          ],
          responses: {
            200: {
              description: 'The audit.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Audit' } } },
            },
            404: { description: 'No such audit.' },
          },
        },
      },
      '/grade/{audit_id}/transcripts': {
        get: {
          operationId: 'getTranscripts',
          tags: ['grading'],
          summary: 'Every probe turn behind a grade, verbatim',
          description:
            'The tape. Returns newline-delimited JSON, one object per turn, in ' +
            'probe and run order, never truncated and never sampled. Add ' +
            '?format=json for the same records grouped by run. ' +
            'Unauthenticated on purpose. A grade is a public accusation about ' +
            'software somebody else wrote, and the evidence for it cannot sit ' +
            'behind the token held by the party making it. ' +
            'An audit that ran no probes returns 200 and an empty body. That is ' +
            'an answer, not an error.',
          parameters: [
            {
              name: 'audit_id', in: 'path', required: true,
              schema: { type: 'string' },
              description: 'The id returned by requestGrade.',
            },
            {
              name: 'format', in: 'query', required: false,
              schema: { type: 'string', enum: ['jsonl', 'json'] },
              description: 'Default jsonl. Use json for grouped records.',
            },
          ],
          responses: {
            200: {
              description: 'The transcript.',
              content: { 'application/x-ndjson': { schema: { type: 'string' } } },
            },
            404: { description: 'No such audit.' },
          },
        },
      },
      '/allowlist/{owner}': {
        get: {
          operationId: 'getAllowlist',
          tags: ['trust'],
          summary: 'Published trust list for an owner',
          description:
            'A snapshot for syncing into a local registry file. The doorman ' +
            'hook deliberately reads its local copy rather than calling this: ' +
            'a security gate that needs the network fails open when the ' +
            'network fails.',
          parameters: [
            { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Allow and deny lists.' } },
        },
      },
      '/badge/{server}.svg': {
        get: {
          operationId: 'getBadge',
          tags: ['trust'],
          summary: 'Grade badge as SVG',
          description:
            'Renders the band, score, pinned model and probe date. An ungraded ' +
            'server returns an explicit "ungraded" badge rather than a default ' +
            'letter, so a badge never implies a grade that does not exist.',
          parameters: [
            {
              name: 'server', in: 'path', required: true, schema: { type: 'string' },
              description: 'URL-encoded server URL or server name.',
            },
          ],
          responses: {
            200: { description: 'SVG badge.', content: { 'image/svg+xml': { schema: { type: 'string' } } } },
          },
        },
      },
      '/api/ledger': {
        get: {
          operationId: 'getLedger',
          tags: ['grading'],
          summary: 'Append-only activity and spend ledger',
          description:
            'Poll this for live activity. Pass ?since= an ISO timestamp to get ' +
            'only newer entries. There is no streaming endpoint by design: ' +
            'WebSockets would need Durable Objects, which are not on the free tier.',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200, default: 50 } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Totals and recent entries.' } },
        },
      },
      '/api/pending': {
        get: {
          operationId: 'claimPendingWork',
          tags: ['runner'],
          summary: 'Claim queued audits (probe runners only)',
          description:
            'Atomically claims up to `limit` queued audits. A claim expires ' +
            'after 15 minutes so a dead runner does not strand work. Requires ' +
            'a bearer token.',
          security: [{ runnerToken: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 5, default: 1 } },
            { name: 'runner', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Claimed work.' }, 401: { description: 'Unauthorized.' } },
        },
      },
      '/api/result': {
        post: {
          operationId: 'postResult',
          tags: ['runner'],
          summary: 'Post a finished audit back (probe runners only)',
          description:
            'Stores the grade, report, recipe, evidence hash and every probe ' +
            'transcript verbatim. Requires a bearer token: without one, anyone ' +
            'could publish a grade for any server.',
          security: [{ runnerToken: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'Stored.' }, 401: { description: 'Unauthorized.' } },
        },
      },
      '/health': {
        get: {
          operationId: 'health',
          tags: ['grading'],
          summary: 'Liveness and the currently pinned probe model',
          responses: { 200: { description: 'OK.' } },
        },
      },
    },
    components: {
      securitySchemes: {
        runnerToken: { type: 'http', scheme: 'bearer', description: 'Shared probe-runner token.' },
        gradeToken: {
          type: 'http', scheme: 'bearer',
          description:
            'Authorises a FULL audit on POST /grade. Optional: omitting it is a ' +
            'supported, free path that queues a static-only audit. Presenting one ' +
            'that is not accepted is a 401, never a silent downgrade.',
        },
      },
      responses: {
        BadRequest: {
          description: 'Invalid request.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { error: { type: 'string' } } },
            },
          },
        },
      },
      schemas: {
        GradeRequestItem: {
          type: 'object',
          required: ['url'],
          properties: {
            url: {
              type: 'string', format: 'uri',
              description: 'The MCP server endpoint. Must be https (plaintext is a hard fail).',
            },
            name: { type: 'string', description: 'Optional display name.' },
            needed_for: {
              type: 'string',
              description:
                'What you actually want this server to do, in plain language. ' +
                'The Cold Open probe builds its task from this, so supplying it ' +
                'makes the behavioural score reflect your real use case.',
            },
          },
        },
        QueuedResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['queued'] },
            count: { type: 'integer' },
            audits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  audit_id: { type: 'string' },
                  server_url: { type: 'string' },
                  status: { type: 'string' },
                  poll: { type: 'string', description: 'Path to poll for this audit.' },
                },
              },
            },
          },
        },
        Audit: {
          type: 'object',
          properties: {
            audit_id: { type: 'string' },
            server_url: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'running', 'complete', 'failed'] },
            grade: {
              type: ['string', 'null'], enum: ['A', 'B', 'C', 'F', null],
              description: 'A >= 85, B >= 70, C >= 50, F < 50.',
            },
            score: { type: ['number', 'null'], description: 'Final weighted score out of 100.' },
            layers: {
              type: 'object',
              description:
                'Per-layer percentages. A null layer was NOT MEASURED and the ' +
                'remaining weights were renormalised over it. It is not a zero.',
              properties: {
                static_pct: { type: ['number', 'null'] },
                behavioral_pct: { type: ['number', 'null'] },
                guidance_pct: { type: ['number', 'null'] },
              },
            },
            hard_fail: {
              type: ['string', 'null'],
              description:
                'When set, the grade was capped at F regardless of the other ' +
                'layers. Causes: injection-shaped content in tool descriptions, ' +
                'or a non-TLS transport.',
            },
            model: {
              type: ['string', 'null'],
              description: 'Pinned model. The grade is relative to it.',
            },
            evidence_sha256: {
              type: ['string', 'null'],
              description: 'SHA-256 over the canonicalised evidence bundle including transcripts.',
            },
            report_md: { type: ['string', 'null'], description: 'One-page human report.' },
            recipe_md: {
              type: ['string', 'null'],
              description:
                'Usage recipe drafted from observed failures. Every rule traces ' +
                'to a probe. Feed this to an agent that must use the server.',
            },
          },
        },
      },
    },
  };
}

/**
 * The same spec, expressed as OpenAPI 3.0.3.
 *
 * Not a second source of truth: it is a transform of the 3.1 document above,
 * so the two cannot drift. Served at /openapi-3.0.json.
 *
 * It exists because importers are not uniform about 3.1 and this spec is the
 * one artifact a partner has to ingest before anything else works. Finding out
 * on onboarding day that the importer only speaks 3.0.x would cost the day.
 * Generating both up front costs one function.
 *
 * 3.1 aligned JSON Schema with the 2020-12 draft; 3.0 predates that. The
 * differences that actually appear in real specs:
 *
 *   type: ['string','null']        ->  type: 'string', nullable: true
 *   examples: [a, b]               ->  example: a
 *   const: x                       ->  enum: [x]
 *   exclusiveMinimum: 5 (number)   ->  minimum: 5, exclusiveMinimum: true
 *
 * The last three do not occur in this spec today. They are handled anyway, so
 * that adding a field later cannot silently produce an invalid 3.0 document.
 */
export function openApiSpec30(origin: string): Record<string, unknown> {
  const doc = openApiSpec(origin) as Record<string, unknown>;
  const out = downgradeNode(doc) as Record<string, unknown>;
  out.openapi = '3.0.3';

  // `summary` on Info is 3.1 only. Fold it into description rather than drop
  // it: it is the one line that says what the service does.
  const info = out.info as Record<string, unknown> | undefined;
  if (info && typeof info.summary === 'string') {
    info.description = info.summary + '\n\n' + String(info.description ?? '');
    delete info.summary;
  }
  return out;
}

/** Exported for tests: the union-refusal path needs to be exercised directly. */
export function downgradeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(downgradeNode);
  if (!node || typeof node !== 'object') return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (key === 'type' && Array.isArray(value)) {
      // A union type in 3.0 can only be expressed as one type plus nullable.
      const types = value.filter((t) => t !== 'null');
      const nullable = value.length !== types.length;
      // More than one non-null type has no 3.0 equivalent at all. Emitting the
      // first would quietly narrow the contract, so refuse instead: a spec
      // that fails to build is recoverable, one that lies is not.
      if (types.length > 1) {
        throw new Error(
          'cannot express type ' + JSON.stringify(value) + ' in OpenAPI 3.0; ' +
          'use a single type plus null, or add a oneOf by hand',
        );
      }
      out.type = types[0];
      if (nullable) out.nullable = true;
      continue;
    }

    if (key === 'const') {
      out.enum = [value];
      continue;
    }

    if (key === 'examples' && Array.isArray(value)) {
      // Schema-level `examples` (an array) is 3.1. The 3.0 spelling is a
      // single `example`. Media-type `examples` is an OBJECT in both and is
      // left alone by the Array check.
      if (value.length > 0) out.example = downgradeNode(value[0]);
      continue;
    }

    if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof value === 'number') {
      const bound = key === 'exclusiveMinimum' ? 'minimum' : 'maximum';
      out[bound] = value;
      out[key] = true;
      continue;
    }

    out[key] = downgradeNode(value);
  }

  return out;
}
