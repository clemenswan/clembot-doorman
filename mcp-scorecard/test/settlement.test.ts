/**
 * The origin noticing that it was paid.
 *
 * Written after the first real payment settled on Base and `/api/ledger` still
 * reported `spent: 0`, because nothing here looked at the request. These tests
 * exist so that stays fixed: the failure mode is silence, and silence is what
 * a passing suite looks like when the feature is simply absent.
 */
import { describe, it, expect } from 'vitest';
import { b64, gatewaySettlement, forwardedHeaderNames } from '../src/routes/payment.js';

const withHeaders = (h: Record<string, string>) =>
  new Request('https://example.com/grade', { method: 'POST', headers: h });

describe('gatewaySettlement', () => {
  it('is null when the gateway forwarded nothing', () => {
    expect(gatewaySettlement(withHeaders({}))).toBeNull();
  });

  it('reads the receipt shape the live gateway actually sent', () => {
    // Exactly the payload from tx 0xf1d7aa96..., minus the payer address.
    const r = gatewaySettlement(withHeaders({
      'payment-response': b64({
        success: true,
        transaction: '0xf1d7aa9696c92b012c8f1eebd222d353c0e452e264294145fb7825000e2d01a0',
        network: 'base',
      }),
    }));
    expect(r?.transaction).toBe('0xf1d7aa9696c92b012c8f1eebd222d353c0e452e264294145fb7825000e2d01a0');
    expect(r?.network).toBe('base');
    expect(r?.header).toBe('payment-response');
  });

  it('records the AMOUNT as null, because that receipt carries none', () => {
    // The cent is the gateway's price, set out of band. Inventing a figure
    // here would be a fabricated revenue number, which is worse than no number.
    const r = gatewaySettlement(withHeaders({
      'payment-response': b64({ success: true, transaction: '0xabc', network: 'base' }),
    }));
    expect(r?.amount_usd).toBeNull();
  });

  it('takes an amount only when a gateway actually states one', () => {
    const r = gatewaySettlement(withHeaders({
      'x-payment-response': b64({ success: true, transaction: '0xabc', amountUsd: 0.01 }),
    }));
    expect(r?.amount_usd).toBe(0.01);
  });

  it('REFUSES a failed settlement rather than booking it as revenue', () => {
    const r = gatewaySettlement(withHeaders({
      'payment-response': b64({ success: false, errorReason: 'unexpected_verify_error' }),
    }));
    expect(r).toBeNull();
  });

  it('still reports a header it cannot decode, rather than going blind', () => {
    // Something WAS forwarded. Returning null here would look identical to a
    // gateway that forwards nothing, which is the state this whole module
    // exists to distinguish.
    const r = gatewaySettlement(withHeaders({ 'payment-response': 'not-base64-json' }));
    expect(r).not.toBeNull();
    expect(r?.transaction).toBeNull();
    expect(r?.header).toBe('payment-response');
  });

  it('names the header it read, so a gateway change is visible in the ledger', () => {
    const r = gatewaySettlement(withHeaders({
      'x-payment': b64({ success: true, transaction: '0xdef' }),
    }));
    expect(r?.header).toBe('x-payment');
  });
});

describe('forwardedHeaderNames', () => {
  it('returns names only, never values', () => {
    const names = forwardedHeaderNames(withHeaders({
      authorization: 'Bearer super-secret-value',
      'x-owner': 'someone',
    }));
    expect(names).toContain('authorization');
    expect(names.join(' ')).not.toContain('super-secret-value');
    expect(names.join(' ')).not.toContain('someone');
  });

  it('is sorted and deduplicated, so two runs are comparable', () => {
    const names = forwardedHeaderNames(withHeaders({ 'x-b': '1', 'x-a': '2' }));
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });
});
