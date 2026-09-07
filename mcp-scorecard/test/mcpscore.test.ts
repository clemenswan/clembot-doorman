import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  McpscoreSchemaError, SUPPORTED_SCHEMA_VERSION, describeExit, toStaticLayer,
  type McpscoreReport,
} from '../src/grade/mcpscore.js';

/**
 * These run against a REAL mcpscore 1.11.0 report, captured on 2026-09-01 by
 * running `mcpscore --json https://mcp.deepwiki.com/mcp`. Not a hand-written
 * fixture. If mcpscore changes its output, this is where we find out.
 */
const fixturePath = fileURLToPath(
  new URL('./fixtures/mcpscore-deepwiki.json', import.meta.url).href,
);
const real = JSON.parse(readFileSync(fixturePath, 'utf8')) as McpscoreReport;

describe('real mcpscore fixture', () => {
  it('is the report we think it is', () => {
    expect(real.schema_version).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(real.mcpscore_version).toBe('1.11.0');
    expect(real.target).toBe('https://mcp.deepwiki.com/mcp');
    expect(real.score).toBe(78);
    expect(real.max_score).toBe(91);
  });

  it('has a denominator that is not 100, which is the whole problem', () => {
    expect(real.max_score).not.toBe(100);
  });
});

describe('toStaticLayer', () => {
  it('normalises the real report', () => {
    const layer = toStaticLayer(real);
    expect(layer.pct).toBe(85.71);
    expect(layer.score).toBe(78);
    expect(layer.max_score).toBe(91);
    expect(layer.mcpscore_version).toBe('1.11.0');
    expect(layer.server_name).toBe('DeepWiki');
    expect(layer.transport).toBe('streamable-http');
    expect(layer.negotiated_version).toBe('2025-11-25');
  });

  it('extracts exactly the failed rules, not the passed ones', () => {
    const layer = toStaticLayer(real);
    // The captured run had 25 passed and 10 failed out of 35.
    expect(layer.failed_rules).toHaveLength(10);
    const ids = layer.failed_rules.map((r) => r.rule_id);
    expect(ids).toContain('protocol_version_latest');
    expect(ids).toContain('tools_annotations_present');
    expect(ids).not.toContain('security_tls_enabled'); // this one passed
  });

  it('strips the leading status glyph from messages', () => {
    const layer = toStaticLayer(real);
    for (const r of layer.failed_rules) {
      expect(r.message.startsWith('❌')).toBe(false);
      expect(r.message).not.toMatch(/^\s/);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it('does NOT hard-fail a TLS-enabled server', () => {
    expect(toStaticLayer(real).hard_fail).toBeUndefined();
  });
});

describe('hard fail detection', () => {
  it('hard-fails when the TLS rule fails', () => {
    const plaintext: McpscoreReport = {
      ...real,
      results: [
        {
          rule_id: 'security_tls_enabled',
          severity: 'CRITICAL',
          passed: false,
          message: 'Server is not using TLS',
        },
      ],
    };
    const layer = toStaticLayer(plaintext);
    expect(layer.hard_fail).toBe('transport is not TLS-encrypted');
  });

  it('does not hard-fail on an unrelated critical failure', () => {
    const other: McpscoreReport = {
      ...real,
      results: [
        { rule_id: 'tools_at_least_one', severity: 'CRITICAL', passed: false, message: 'no tools' },
      ],
    };
    expect(toStaticLayer(other).hard_fail).toBeUndefined();
  });
});

describe('schema guarding', () => {
  it('refuses to grade an unknown schema version rather than mis-scoring', () => {
    const future = { ...real, schema_version: 2 };
    expect(() => toStaticLayer(future)).toThrow(McpscoreSchemaError);
    expect(() => toStaticLayer(future)).toThrow(/schema_version 2/);
  });

  it('refuses a report with no score', () => {
    const broken = { ...real, score: undefined } as unknown as McpscoreReport;
    expect(() => toStaticLayer(broken)).toThrow(McpscoreSchemaError);
  });
});

describe('exit codes', () => {
  it('separates a bad server from an audit that never ran', () => {
    expect(describeExit(0)).toMatch(/completed/);
    expect(describeExit(2)).toMatch(/could not connect/);
    expect(describeExit(3)).toMatch(/below/);
    // 3 means we DID grade it and it scored badly. That is a result, not an
    // error, and the runner must not retry it as a failure.
    expect(describeExit(3)).toMatch(/completed/);
  });
});
