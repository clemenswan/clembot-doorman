/**
 * The spec is the first artifact a partner ingests, and nothing else works
 * until it does.
 *
 * Both documents are validated by a real OpenAPI parser rather than by
 * hand-written shape assertions. Hand assertions check the mistakes you
 * thought of; a validator checks the ones you did not, which is the whole
 * reason a 3.0 variant exists in the first place.
 */

import { describe, expect, it } from 'vitest';
import { validate } from '@readme/openapi-parser';
import {
  PRIVATE_TAG, downgradeNode, openApiSpec, openApiSpec30,
  publicOpenApiSpec, publicOpenApiSpec30,
} from '../src/routes/openapi.js';

const ORIGIN = 'https://scorecard.wanessalabs.com';

/** The failure message matters here: a bare `false` says nothing about why. */
function describeResult(r: unknown): string {
  const e = (r as { errors?: unknown }).errors;
  return e ? JSON.stringify(e, null, 1) : JSON.stringify(r, null, 1);
}

/** The parser mutates and resolves what it is given, so hand it a clone. */
async function check(doc: Record<string, unknown>) {
  return validate(JSON.parse(JSON.stringify(doc)));
}

describe('the served spec', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const r = await check(openApiSpec(ORIGIN));
    expect(r.valid, describeResult(r)).toBe(true);
  });

  it('is a valid OpenAPI 3.0 document after downgrade', async () => {
    const r = await check(openApiSpec30(ORIGIN));
    expect(r.valid, describeResult(r)).toBe(true);
  });

  it('declares the right version in each', () => {
    expect(openApiSpec(ORIGIN).openapi).toBe('3.1.0');
    expect(openApiSpec30(ORIGIN).openapi).toBe('3.0.3');
  });
});

describe('the 3.0 downgrade', () => {
  const doc30 = openApiSpec30(ORIGIN);

  it('leaves no 3.1-only construct anywhere in the document', () => {
    // The guard that survives the spec growing. A field added to the 3.1 doc
    // later cannot silently produce an invalid 3.0 one without failing here.
    const offenders: string[] = [];
    walk(doc30, '$', (key, value, path) => {
      if (key === 'type' && Array.isArray(value)) offenders.push(path + ' (union type)');
      if (key === 'const') offenders.push(path + ' (const)');
      if (key === 'examples' && Array.isArray(value)) offenders.push(path + ' (schema examples array)');
      if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof value === 'number') {
        offenders.push(path + ' (numeric exclusive bound)');
      }
      if (key === 'summary' && path === '$.info.summary') offenders.push(path + ' (info.summary)');
    });
    expect(offenders).toEqual([]);
  });

  it('turns a nullable union into type + nullable, not into a narrowed type', () => {
    // Ten fields in this spec are `['string', 'null']` or similar. Dropping
    // the null instead of setting nullable would tell a caller a field is
    // always present, and several of these are null on every partial audit.
    const audit = (doc30 as Any).components.schemas.Audit.properties;
    expect(audit.grade.type).toBe('string');
    expect(audit.grade.nullable).toBe(true);
    expect(audit.score.nullable).toBe(true);
    expect(audit.layers.properties.behavioral_pct.nullable).toBe(true);
  });

  it('keeps the non-nullable fields non-nullable', () => {
    const audit = (doc30 as Any).components.schemas.Audit.properties;
    expect(audit.audit_id.nullable).toBeUndefined();
    expect(audit.server_url.nullable).toBeUndefined();
  });

  it('keeps info.summary rather than dropping it', () => {
    // It is the one line that says what the service is. 3.0 has no home for
    // it as a field, so it is folded into the description.
    const info31 = (openApiSpec(ORIGIN) as Any).info;
    const info30 = (doc30 as Any).info;
    expect(info30.summary).toBeUndefined();
    expect(info30.description).toContain(info31.summary);
  });

  it('carries every path and operation across unchanged', () => {
    const p31 = Object.keys((openApiSpec(ORIGIN) as Any).paths).sort();
    const p30 = Object.keys((doc30 as Any).paths).sort();
    expect(p30).toEqual(p31);
    expect(opIds(doc30)).toEqual(opIds(openApiSpec(ORIGIN)));
  });

  it('refuses a union it cannot express, rather than narrowing it silently', () => {
    // A union of two non-null types has no 3.0 equivalent. Emitting the first
    // would quietly change the contract, which is worse than a build that
    // stops. Exercises the real transform, not a stand-in.
    expect(() => downgradeNode({ type: ['string', 'number'] })).toThrow(/cannot express type/);
  });

  it('still downgrades an ordinary nullable union', () => {
    // The other half of the rule above: refusing must not become refusing
    // everything. Watched this fail by feeding it ['string','number'].
    expect(downgradeNode({ type: ['string', 'null'] })).toEqual({ type: 'string', nullable: true });
  });

  it('rewrites the other 3.1 constructs even though this spec has none today', () => {
    // Handled so that adding one later cannot silently emit invalid 3.0.
    expect(downgradeNode({ const: 'A' })).toEqual({ enum: ['A'] });
    expect(downgradeNode({ examples: [1, 2] })).toEqual({ example: 1 });
    expect(downgradeNode({ exclusiveMinimum: 5 })).toEqual({ minimum: 5, exclusiveMinimum: true });
  });

  it('leaves a media-type examples OBJECT alone', () => {
    // 3.0 and 3.1 agree on this one. The array check is what distinguishes it
    // from the schema-level `examples`, and confusing the two would strip a
    // valid 3.0 field.
    const mediaType = { examples: { ok: { value: 1 } } };
    expect(downgradeNode(mediaType)).toEqual(mediaType);
  });
});

describe('the public document', () => {
  /**
   * Spelled out rather than derived. Bazantic turns every operation here into
   * an MCP tool an agent can read and call, so the set is a decision, not a
   * by-product. Adding one should be a deliberate edit to this line.
   */
  const PUBLIC_OPS = [
    'getAllowlist', 'getAudit', 'getBadge', 'getLatestGrade',
    'getLedger', 'getTranscripts', 'health', 'requestGrade',
  ];
  const PRIVATE_OPS = ['claimPendingWork', 'postResult'];

  it('is what the full document is NOT', () => {
    // Half of the guard, and the half that is easy to lose. If someone
    // "fixes" this by deleting the runner operations from the source instead
    // of filtering them, every other test below still passes and the full
    // document quietly stops describing routes the Worker still answers.
    expect(opIds(openApiSpec(ORIGIN))).toEqual([...PUBLIC_OPS, ...PRIVATE_OPS].sort());
  });

  it('describes exactly the operations meant to be callable', () => {
    expect(opIds(publicOpenApiSpec(ORIGIN))).toEqual([...PUBLIC_OPS].sort());
    expect(opIds(publicOpenApiSpec30(ORIGIN))).toEqual([...PUBLIC_OPS].sort());
  });

  it('drops the emptied paths, not just the operations', () => {
    // A path object left behind with no methods is still an advertised route.
    const paths = Object.keys((publicOpenApiSpec(ORIGIN) as Any).paths);
    expect(paths).not.toContain('/api/pending');
    expect(paths).not.toContain('/api/result');
    expect(paths).toContain('/api/ledger');
  });

  it('leaves nothing tagged private anywhere in the document', () => {
    const offenders: string[] = [];
    walk(publicOpenApiSpec(ORIGIN), '$', (k, v, path) => {
      if (k === 'tags' && Array.isArray(v) && v.includes(PRIVATE_TAG)) offenders.push(path);
      if (k === 'name' && v === PRIVATE_TAG) offenders.push(path);
    });
    expect(offenders).toEqual([]);
  });

  it('removes the credential that only the removed routes used', () => {
    // Leaving `runnerToken` behind still names the credential and the surface
    // it opens, which is most of what taking the routes off was for.
    const schemes = (publicOpenApiSpec(ORIGIN) as Any).components.securitySchemes;
    expect(Object.keys(schemes)).toEqual(['gradeToken']);
  });

  it('keeps a security scheme that a surviving operation still references', () => {
    // The other half of the rule above: pruning must not become pruning
    // everything. requestGrade declares gradeToken, so it stays.
    const doc = publicOpenApiSpec(ORIGIN) as Any;
    expect(doc.paths['/grade'].post.security).toEqual([{}, { gradeToken: [] }]);
    expect(doc.components.securitySchemes.gradeToken).toBeDefined();
  });

  it('never says the words a removed route was described by', () => {
    // A description elsewhere that explains the runner queue would put the
    // surface back on the page by prose alone.
    const text = JSON.stringify(publicOpenApiSpec(ORIGIN));
    expect(text).not.toContain('/api/pending');
    expect(text).not.toContain('/api/result');
    expect(text).not.toContain('probe-runner token');
  });

  it('is still a valid document in both versions', async () => {
    // Removing nodes from a valid document is not automatically valid: an
    // orphaned $ref or an empty required list would both fail here.
    const r31 = await check(publicOpenApiSpec(ORIGIN));
    expect(r31.valid, describeResult(r31)).toBe(true);
    const r30 = await check(publicOpenApiSpec30(ORIGIN));
    expect(r30.valid, describeResult(r30)).toBe(true);
    expect((publicOpenApiSpec30(ORIGIN) as Any).openapi).toBe('3.0.3');
  });

  it('does not mutate the document it filtered', () => {
    // stripPrivate clones. If it ever stopped, the full spec would lose its
    // runner routes the first time anything asked for the public one, and the
    // order tests happen to run in would decide whether that was caught.
    publicOpenApiSpec(ORIGIN);
    expect(opIds(openApiSpec(ORIGIN))).toContain('claimPendingWork');
  });
});

type Any = Record<string, any>;

function walk(node: unknown, path: string, visit: (k: string, v: unknown, p: string) => void): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, path + '[' + i + ']', visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    visit(k, v, path + '.' + k);
    walk(v, path + '.' + k, visit);
  }
}

function opIds(doc: unknown): string[] {
  const ids: string[] = [];
  walk(doc, '$', (k, v) => {
    if (k === 'operationId' && typeof v === 'string') ids.push(v);
  });
  return ids.sort();
}



