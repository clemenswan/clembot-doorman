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
import { downgradeNode, openApiSpec, openApiSpec30 } from '../src/routes/openapi.js';

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



