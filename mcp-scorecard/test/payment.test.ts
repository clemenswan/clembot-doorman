/**
 * x402, and the four ways a half-built paywall lies.
 *
 *   1. Letting an unverified PAYMENT-SIGNATURE through, so any string opens it.
 *   2. Printing a placeholder recipient when unconfigured, so an agent pays a
 *      made-up address and loses real money.
 *   3. Charging for the transcripts, so the evidence for an accusation sits
 *      behind the accuser's paywall.
 *   4. Getting the wire format wrong, so a real x402 client sees nothing it
 *      recognises and reports a broken server.
 *
 * The field names below are pinned against the spec deliberately. They were
 * read from coinbase/x402 `specs/x402-specification-v2.md` and
 * `specs/transports-v2/http.md` on 2026-09-04, and three of them contradict
 * what a from-memory implementation produces.
 */

import { describe, expect, it } from 'vitest';
import type { Env } from '../src/index.js';
import {
  DEFAULT_NETWORK, NEVER_PAID, PAID_ROUTES, X402_VERSION,
  b64, buildChallenge, decodeHeader, handlePrice, isPaidRoute,
  missingConfig, paymentGate, paymentsOn,
  type PaymentRequired, type SettlementResponse,
} from '../src/routes/payment.js';

/** paymentGate never touches D1, so the binding is deliberately absent. */
const env = (o: Record<string, string> = {}) => ({
  PROBE_MODEL: 'claude-sonnet-5', PROBE_TEMPERATURE: '0', PROBE_RUNS: '3',
  ...o,
} as unknown as Env);

const CONFIGURED = {
  PAYMENTS_REQUIRED: '1',
  PAY_TO: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
  PAY_ASSET: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  PAY_ASSET_NAME: 'USDC',
  PAY_ASSET_DECIMALS: '6',
};

const post = (headers: Record<string, string> = {}) =>
  new Request('https://scorecard.test/grade', { method: 'POST', headers });

describe('x402: off by default', () => {
  it('lets everything through when PAYMENTS_REQUIRED is unset', () => {
    expect(paymentsOn(env())).toBe(false);
    expect(paymentGate(post(), env(), '/grade')).toBeNull();
  });

  it('only "1" or "true" turn it on, so a typo fails OPEN rather than half on', () => {
    // A misread flag that half-enabled payment would 402 the live demo with no
    // way to pay. Failing open on a typo is the right direction here: the
    // service loses revenue it was not collecting anyway.
    for (const v of ['0', 'yes', 'TRUE', '', 'on']) {
      expect(paymentsOn(env({ PAYMENTS_REQUIRED: v })), v).toBe(false);
    }
    for (const v of ['1', 'true']) {
      expect(paymentsOn(env({ PAYMENTS_REQUIRED: v })), v).toBe(true);
    }
  });
});

describe('x402: the challenge matches the v2 spec', () => {
  const res = paymentGate(post(), env(CONFIGURED), '/grade')!;

  it('is a 402 carrying a base64 PAYMENT-REQUIRED header', () => {
    expect(res.status).toBe(402);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
  });

  it('decodes to a PaymentRequired with the spec field names', () => {
    const p = decodeHeader<PaymentRequired>(res.headers.get('PAYMENT-REQUIRED')!)!;
    expect(p.x402Version).toBe(2);
    expect(p.resource.url).toContain('/grade');
    expect(Array.isArray(p.accepts)).toBe(true);

    const a = p.accepts[0] as unknown as Record<string, unknown>;
    // The three a from-memory version gets wrong.
    expect(a).toHaveProperty('amount');                    // not maxAmountRequired
    expect(a).not.toHaveProperty('maxAmountRequired');
    expect(String(a.network)).toMatch(/^eip155:\d+$/);     // CAIP-2, not "base-sepolia"
    expect(a).not.toHaveProperty('resource');              // resource is top level in v2

    for (const k of ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds']) {
      expect(a, k).toHaveProperty(k);
    }
    expect(a.payTo).toBe(CONFIGURED.PAY_TO);
    expect(a.asset).toBe(CONFIGURED.PAY_ASSET);
  });

  it('also puts the challenge in the body, for a human with curl', async () => {
    // v2 says the body is an implementation concern. Leaving it empty is legal
    // and unkind: nobody debugging should have to base64-decode a header.
    const body = await res.clone().json() as PaymentRequired;
    expect(body.x402Version).toBe(X402_VERSION);
    expect(body.error).toContain('PAYMENT-SIGNATURE');
  });

  it('round-trips non-ASCII through the header without mangling it', () => {
    // btoa alone throws or corrupts above U+00FF. The description is ours today
    // and may not always be ASCII.
    const round = decodeHeader<{ s: string }>(b64({ s: 'grade — ✓ £' }));
    expect(round!.s).toBe('grade — ✓ £');
  });
});

describe('x402: an unverified payment is REFUSED, not admitted', () => {
  const res = paymentGate(
    post({ 'PAYMENT-SIGNATURE': 'eyJhbnkiOiJ0aGluZyJ9' }), env(CONFIGURED), '/grade',
  )!;

  it('does not let the request through', () => {
    // The whole point. A paywall that accepts any header is worse than none:
    // it looks like revenue protection and is not.
    expect(res).not.toBeNull();
    expect(res.status).toBe(402);
  });

  it('answers in the protocol\'s own failure channel', () => {
    const s = decodeHeader<SettlementResponse>(res.headers.get('PAYMENT-RESPONSE')!)!;
    expect(s.success).toBe(false);
    expect(s.transaction).toBe('');
    // From the spec's error enum, not invented here.
    expect(s.errorReason).toBe('unexpected_verify_error');
  });

  it('says plainly that nothing was charged and nothing was queued', async () => {
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/NOT verified/);
    expect(body.error).toMatch(/nothing was queued/i);
  });
});

describe('x402: unconfigured fails closed', () => {
  it('refuses with 503 rather than falling through to the free path', () => {
    const res = paymentGate(post(), env({ PAYMENTS_REQUIRED: '1' }), '/grade')!;
    expect(res).not.toBeNull();
    expect(res.status).toBe(503);
  });

  it('names exactly what is missing', () => {
    expect(missingConfig(env({ PAYMENTS_REQUIRED: '1' }))).toEqual(['PAY_TO', 'PAY_ASSET']);
    expect(missingConfig(env({ ...CONFIGURED }))).toEqual([]);
  });

  it('never publishes a placeholder recipient', async () => {
    const res = paymentGate(post(), env({ PAYMENTS_REQUIRED: '1' }), '/grade')!;
    const text = await res.text();
    // An agent that paid a made-up address would lose real money, so there must
    // be no address-shaped string anywhere in the refusal.
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(text).toMatch(/PAY_TO/);
  });
});

describe('x402: the free tier stays free', () => {
  it('charges for exactly one route', () => {
    expect(PAID_ROUTES).toEqual([{ method: 'POST', path: '/grade' }]);
  });

  it('never charges for the transcripts', () => {
    // Invariant 16, as money instead of as auth. A grade is an accusation and
    // the evidence for it cannot sit behind the accuser's paywall.
    expect(isPaidRoute('GET', '/grade/abc123/transcripts')).toBe(false);
    expect(NEVER_PAID).toContain('/grade/:id/transcripts');
    const res = paymentGate(
      new Request('https://scorecard.test/grade/abc123/transcripts'),
      env(CONFIGURED), '/grade/abc123/transcripts',
    );
    expect(res).toBeNull();
  });

  it('lets every other read through with payments fully on', () => {
    const free = [
      ['GET', '/'], ['GET', '/health'], ['GET', '/openapi.json'],
      ['GET', '/openapi-3.0.json'], ['GET', '/price'], ['GET', '/grade'],
      ['GET', '/grade/abc'], ['GET', '/allowlist/doorman'],
      ['GET', '/badge/example.svg'], ['GET', '/api/ledger'],
    ];
    for (const [method, path] of free) {
      const r = paymentGate(
        new Request('https://scorecard.test' + path, { method }), env(CONFIGURED), path,
      );
      expect(r, `${method} ${path} should be free`).toBeNull();
    }
  });

  it('does not charge for a GET to the paid path', () => {
    // POST /grade spends compute. GET /grade?server= is a cache read.
    expect(isPaidRoute('POST', '/grade')).toBe(true);
    expect(isPaidRoute('GET', '/grade')).toBe(false);
  });
});

describe('/price: a discovered zero, not an assumed one', () => {
  it('states the zero explicitly when payments are off', async () => {
    const body = await handlePrice(env(), 'https://scorecard.test/grade').json() as
      { payment_required: boolean; price_usdc: number; note: string };
    expect(body.payment_required).toBe(false);
    expect(body.price_usdc).toBe(0);
    expect(body.note).toMatch(/discovered zero/);
  });

  it('converts atomic units with the CONFIGURED decimals', async () => {
    const body = await handlePrice(
      env({ ...CONFIGURED, PAY_AMOUNT_ATOMIC: '250000' }), 'https://scorecard.test/grade',
    ).json() as { price_usdc: number; amount_atomic: string; network: string };
    expect(body.amount_atomic).toBe('250000');
    expect(body.price_usdc).toBe(0.25);
    expect(body.network).toBe(DEFAULT_NETWORK);
  });

  it('returns null rather than guessing when decimals are unset', async () => {
    // Dividing by the wrong power of ten is how a client authorises a thousand
    // times the intended amount. Null forces the caller to refuse.
    const { PAY_ASSET_DECIMALS, ...noDecimals } = CONFIGURED;
    const body = await handlePrice(env(noDecimals), 'https://scorecard.test/grade').json() as
      { price_usdc: number | null; amount_atomic: string };
    expect(body.price_usdc).toBeNull();
    expect(body.amount_atomic).toBeTruthy();
  });

  it('is 503 and null-priced when payment is on but unconfigured', async () => {
    const res = handlePrice(env({ PAYMENTS_REQUIRED: '1' }), 'https://scorecard.test/grade');
    expect(res.status).toBe(503);
    expect((await res.json() as { price_usdc: number | null }).price_usdc).toBeNull();
  });
});

describe('x402: the challenge builder', () => {
  it('omits `extra` entirely rather than sending an empty object', () => {
    const { PAY_ASSET_NAME, ...noName } = CONFIGURED;
    const c = buildChallenge(env(noName), 'https://scorecard.test/grade');
    expect(c.accepts[0]).not.toHaveProperty('extra');
  });

  it('omits `error` when there is nothing to say', () => {
    expect(buildChallenge(env(CONFIGURED), 'https://x.test')).not.toHaveProperty('error');
  });
});
