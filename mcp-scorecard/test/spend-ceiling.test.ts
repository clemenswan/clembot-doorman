import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAID_AUDITS_PER_DAY,
  ceilingFor, decideDispense, paidDispensedSince, spendPosture,
} from '../src/spend-ceiling.js';

/**
 * Every other spend guard here protects the caller. This one protects whoever
 * pays the model bill, and it is built before `ANTHROPIC_API_KEY` exists
 * rather than after the first invoice.
 */

describe('ceilingFor: a typo must not read as "no limit"', () => {
  it('uses the default when unset', () => {
    expect(ceilingFor({})).toBe(DEFAULT_PAID_AUDITS_PER_DAY);
  });

  it('takes a valid override, including zero', () => {
    expect(ceilingFor({ PAID_AUDITS_PER_DAY: '5' })).toBe(5);
    expect(ceilingFor({ PAID_AUDITS_PER_DAY: '0' })).toBe(0);
  });

  for (const bad of ['', 'lots', '-1', 'NaN']) {
    it(`falls back to the default on ${JSON.stringify(bad)}`, () => {
      expect(ceilingFor({ PAID_AUDITS_PER_DAY: bad })).toBe(DEFAULT_PAID_AUDITS_PER_DAY);
    });
  }
});

describe('decideDispense', () => {
  it('leaves an unpaid audit unpaid, and calls it no downgrade', () => {
    const d = decideDispense({ paidAllowed: 0, dispensed: 0, cap: 10 });
    expect(d).toEqual({ paidAllowed: 0, downgraded: false, reason: null });
  });

  it('pays under the ceiling', () => {
    expect(decideDispense({ paidAllowed: 1, dispensed: 9, cap: 10 }).paidAllowed).toBe(1);
  });

  it('downgrades AT the ceiling, not one past it', () => {
    const d = decideDispense({ paidAllowed: 1, dispensed: 10, cap: 10 });
    expect(d.paidAllowed).toBe(0);
    expect(d.downgraded).toBe(true);
    expect(d.reason).toMatch(/ceiling of 10/);
  });

  it('a ceiling of zero pays for nothing', () => {
    expect(decideDispense({ paidAllowed: 1, dispensed: 0, cap: 0 }).paidAllowed).toBe(0);
  });

  it('an UNREADABLE count is not a licence to spend', () => {
    const d = decideDispense({ paidAllowed: 1, dispensed: null, cap: 10 });
    expect(d.paidAllowed).toBe(0);
    expect(d.reason).toMatch(/could not be read/);
  });
});

/** A ledger stub that counts only what the query asks for. */
function ledgerDb(rows: Array<{ event: string; created_at: string }>, opts: { fail?: boolean } = {}) {
  return {
    DB: {
      prepare(sql: string) {
        let bound: unknown[] = [];
        return {
          bind(...args: unknown[]) { bound = args; return this; },
          async first() {
            if (opts.fail) throw new Error('D1 unavailable');
            const [cutoff] = bound as [string];
            const n = rows.filter(
              (r) => sql.includes("'dispensed_paid'") && r.event === 'dispensed_paid' && r.created_at >= cutoff,
            ).length;
            return { n };
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe('paidDispensedSince', () => {
  const now = Date.parse('2026-09-21T12:00:00.000Z');
  const rows = [
    { event: 'dispensed_paid', created_at: '2026-09-21T11:00:00.000Z' },  // inside
    { event: 'dispensed_paid', created_at: '2026-09-20T13:00:00.000Z' },  // inside
    { event: 'dispensed_paid', created_at: '2026-09-19T12:00:00.000Z' },  // outside
    { event: 'claimed', created_at: '2026-09-21T11:30:00.000Z' },         // wrong event
  ];

  it('counts paid dispenses inside the rolling day only', async () => {
    expect(await paidDispensedSince(ledgerDb(rows), now)).toBe(2);
  });

  it('is null, never zero, when it cannot be read', async () => {
    expect(await paidDispensedSince(ledgerDb(rows, { fail: true }), now)).toBeNull();
  });
});

describe('spendPosture, for /health', () => {
  const now = Date.parse('2026-09-21T12:00:00.000Z');

  it('reports the position and stays quiet under the ceiling', async () => {
    const p = await spendPosture(
      { ...ledgerDb([{ event: 'dispensed_paid', created_at: '2026-09-21T11:00:00.000Z' }]), PAID_AUDITS_PER_DAY: '10' },
      now,
    );
    expect(p).toMatchObject({ dispensed_24h: 1, cap: 10, capped: false, note: null });
  });

  it('says so at the ceiling', async () => {
    const p = await spendPosture(
      { ...ledgerDb([{ event: 'dispensed_paid', created_at: '2026-09-21T11:00:00.000Z' }]), PAID_AUDITS_PER_DAY: '1' },
      now,
    );
    expect(p.capped).toBe(true);
    expect(p.note).toMatch(/static-only/);
  });

  it('an unreadable counter is unknown, and says paid work is downgraded meanwhile', async () => {
    const p = await spendPosture({ ...ledgerDb([], { fail: true }) }, now);
    expect(p.dispensed_24h).toBeNull();
    expect(p.capped).toBeNull();
    expect(p.note).toMatch(/could not be read/);
  });
});

/**
 * The dispense point, driven.
 *
 * Four mutants in this branch have already survived by the shape "correct
 * logic, caller that ignores it", so the ceiling is tested through
 * `handlePending` rather than only through its own function.
 */
describe('GET /api/pending applies the operator ceiling', () => {
  const build = (pending: Array<{ id: string; paid_allowed: number }>, cap: string, priorPaid = 0) => {
    const ledger: Array<{ event: string; detail: string }> = [];
    for (let i = 0; i < priorPaid; i++) ledger.push({ event: 'dispensed_paid', detail: 'earlier' });
    const binding = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        return {
          sql,
          bind(...args: unknown[]) { bound = args; return this; },
          async all() { return { results: pending.map((p) => ({ ...p, server_url: 'https://x/' + p.id })) }; },
          async first() {
            if (sql.includes("'dispensed_paid'")) {
              return { n: ledger.filter((l) => l.event === 'dispensed_paid').length };
            }
            return null;
          },
          async run() {
            if (sql.includes('INSERT INTO ledger')) {
              const [, , event, detail] = bound as [string, string, string, string];
              ledger.push({ event, detail });
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;
    return { ledger, env: { DB: binding, RUNNER_TOKEN: 'a-long-enough-runner-token', PAID_AUDITS_PER_DAY: cap } as never };
  };

  const poll = (env: never) => {
    const url = new URL('https://scorecard.example/api/pending?runner=r&limit=5');
    return import('../src/routes/runner.js').then(({ handlePending }) => handlePending(
      new Request(url, { headers: { authorization: 'Bearer a-long-enough-runner-token' } }),
      url, env,
    ));
  };

  it('pays under the ceiling and records the dispense', async () => {
    const { ledger, env } = build([{ id: 'a', paid_allowed: 1 }], '10');
    const body = await (await poll(env)).json() as { work: Array<{ paid_allowed: number }> };
    expect(body.work[0].paid_allowed).toBe(1);
    expect(ledger.filter((l) => l.event === 'dispensed_paid')).toHaveLength(1);
  });

  it('downgrades over the ceiling, hands the work out anyway, and says why', async () => {
    const { ledger, env } = build([{ id: 'a', paid_allowed: 1 }], '1', 1);
    const body = await (await poll(env)).json() as
      { work: Array<{ paid_allowed: number; downgraded_reason?: string }> };
    expect(body.work).toHaveLength(1);                       // still dispensed
    expect(body.work[0].paid_allowed).toBe(0);               // but not paid for
    expect(body.work[0].downgraded_reason).toMatch(/ceiling/);
    expect(ledger.some((l) => l.event === 'spend_capped')).toBe(true);
    expect(ledger.filter((l) => l.event === 'dispensed_paid')).toHaveLength(1);  // the prior one only
  });

  it('counts forward WITHIN one poll, so a batch cannot all pass the same check', async () => {
    // Three paid rows, ceiling of two. A check read once and never updated
    // would pay for all three.
    const { ledger, env } = build(
      [{ id: 'a', paid_allowed: 1 }, { id: 'b', paid_allowed: 1 }, { id: 'c', paid_allowed: 1 }],
      '2',
    );
    const body = await (await poll(env)).json() as { work: Array<{ paid_allowed: number }> };
    expect(body.work.filter((w) => w.paid_allowed === 1)).toHaveLength(2);
    expect(ledger.filter((l) => l.event === 'dispensed_paid')).toHaveLength(2);
    expect(ledger.filter((l) => l.event === 'spend_capped')).toHaveLength(1);
  });

  it('never upgrades: an unpaid audit stays unpaid however much room there is', async () => {
    const { ledger, env } = build([{ id: 'a', paid_allowed: 0 }], '100');
    const body = await (await poll(env)).json() as { work: Array<{ paid_allowed: number }> };
    expect(body.work[0].paid_allowed).toBe(0);
    expect(ledger.some((l) => l.event === 'dispensed_paid')).toBe(false);
    expect(ledger.some((l) => l.event === 'spend_capped')).toBe(false);
  });
});
