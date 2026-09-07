/**
 * The spend cap.
 *
 * Five things could make this look like a limit while being none:
 *
 *   1. An unknown price defaulting to zero, which passes every cap forever.
 *   2. `enqueue` spending without a permit, so the cap is a suggestion.
 *   3. A permit being reusable, so one reservation buys many audits.
 *   4. A failed call keeping its reservation, so a retry storm locks you out.
 *   5. A per-run cap above the per-day cap, so the daily one can never bind.
 *
 * Each has a test, and each is mutation-checked.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe, rejects, throws } from './harness.mjs';
import {
  BudgetError, BudgetExceededError, openBudget, readLedger,
} from '../src/budget.mjs';
import { ScorecardError, scorecardClient } from '../src/scorecard.mjs';

const at = (iso) => () => new Date(iso);
let n = 0;
const ids = () => 'p' + ++n;

const fresh = (o = {}) => openBudget({
  perRunUsdc: 1, perDayUsdc: 2, now: at('2026-09-04T10:00:00.000Z'), randomId: ids, ...o,
});

describe('budget: an unknown price is not a free one');
{
  const b = fresh();
  for (const bad of [undefined, null, NaN, Infinity, '0.5', {}]) {
    const e = throws(() => b.reserve({ price_usdc: bad }));
    check(`refuses ${JSON.stringify(bad) ?? String(bad)}`, e instanceof BudgetError, String(e));
  }
  check('the message says why zero is the wrong default',
    /unknown price is not a free one/.test(throws(() => b.reserve({})).message));
  check('nothing was spent by asking', b.spentToday() === 0, String(b.spentToday()));

  // A DISCOVERED zero is fine. That is the distinction the whole design rests
  // on: the service was asked and said free.
  const p = b.reserve({ price_usdc: 0, server: 'https://free.test/mcp' });
  check('a discovered zero reserves cleanly', p.price_usdc === 0);
  check('and costs nothing', b.spentToday() === 0);
}

describe('budget: the caps bind');
{
  const b = fresh();
  const over = throws(() => b.reserve({ price_usdc: 1.5 }));
  check('a call above the per-run cap is refused', over instanceof BudgetExceededError);
  check('and says nothing was spent', /Nothing was spent/.test(over.message));
  check('the refusal did not charge', b.spentToday() === 0);

  b.reserve({ price_usdc: 1 });
  b.reserve({ price_usdc: 1 });
  check('two reservations reach the daily cap', b.spentToday() === 2, String(b.spentToday()));
  check('nothing is left', b.remainingToday() === 0, String(b.remainingToday()));
  const third = throws(() => b.reserve({ price_usdc: 0.01 }));
  check('a third is refused by the DAILY cap', third instanceof BudgetExceededError);
  check('the message quotes both numbers', /already 2/.test(third.message) && /cap is 2/.test(third.message),
    third.message);
}

describe('budget: an outstanding reservation still counts');
{
  // The safe direction. If the process dies between reserve and settle, today
  // is over-counted, which refuses a call you could afford. Under-counting
  // would spend money you did not have.
  const b = fresh();
  b.reserve({ price_usdc: 1 });
  check('an unsettled reservation is counted', b.spentToday() === 1);
  const p2 = b.reserve({ price_usdc: 1 });
  b.release(p2, 'call never made');
  check('a release gives the headroom back', b.spentToday() === 1, String(b.spentToday()));
  check('but a settle does not', (() => {
    const c = fresh();
    const p = c.reserve({ price_usdc: 1 });
    c.settle(p, { audit_id: 'aud_1' });
    return c.spentToday() === 1;
  })());
}

describe('budget: a permit is single use');
{
  const b = fresh();
  const p = b.reserve({ price_usdc: 1 });
  check('it is open once reserved', b.isOpen(p) === true);
  b.settle(p, { audit_id: 'aud_1' });
  check('it is closed once settled', b.isOpen(p) === false);
  check('settling twice throws', throws(() => b.settle(p)) instanceof BudgetError);
  check('releasing a settled permit throws', throws(() => b.release(p)) instanceof BudgetError);
  check('a fabricated permit is not open', b.isOpen({ id: 'p_made_up' }) === false);
  check('and neither is a non-permit', b.isOpen(null) === false && b.isOpen({}) === false);
}

describe('budget: a limit that cannot bind is a configuration error');
{
  const e = throws(() => openBudget({ perRunUsdc: 10, perDayUsdc: 5 }));
  check('per-run above per-day is refused at construction', e instanceof BudgetError);
  check('and says the daily cap could never bind', /could never bind/.test(e.message), e.message);
  check('a negative cap is refused', throws(() => openBudget({ perRunUsdc: -1 })) instanceof BudgetError);
}

describe('scorecard client: no budget, no client');
{
  const e = throws(() => scorecardClient({ api: 'https://s.test' }));
  check('constructing without a budget throws', e instanceof ScorecardError, String(e));
  check('the message says it is not optional', /not optional/.test(e.message), e.message);
  check('a fake budget object is rejected too',
    throws(() => scorecardClient({ api: 'https://s.test', budget: {} })) instanceof ScorecardError);
}

describe('scorecard client: no permit, no spend');
await (async () => {
  const b = fresh();
  let sent = 0;
  const client = scorecardClient({
    api: 'https://s.test',
    budget: b,
    fetch: async () => { sent++; return new Response('{}', { status: 200 }); },
  });

  const noPermit = await rejects(() => client.enqueue({ url: 'https://x.test/mcp' }));
  check('enqueue without a permit throws', noPermit instanceof ScorecardError, String(noPermit));
  check('and no request left the process', sent === 0, String(sent));

  const p = b.reserve({ price_usdc: 0.5 });
  b.settle(p, {});
  const spent = await rejects(() => client.enqueue({ url: 'https://x.test/mcp', permit: p }));
  check('a SETTLED permit cannot buy a second audit', spent instanceof ScorecardError);
  check('still nothing sent', sent === 0, String(sent));

  const forged = await rejects(() => client.enqueue({ url: 'https://x.test/mcp', permit: { id: 'p_forged' } }));
  check('a forged permit is rejected', forged instanceof ScorecardError);
  check('nothing sent for a forgery either', sent === 0, String(sent));
})();

describe('scorecard client: an unreadable price is null, never zero');
await (async () => {
  const b = fresh();
  const mk = (res) => scorecardClient({ api: 'https://s.test', budget: b, fetch: async () => res });

  const down = await mk(new Response('nope', { status: 500 })).price();
  check('a 500 gives an unknown price', down.known === false && down.price_usdc === null,
    JSON.stringify(down));

  const garbled = await mk(new Response('{"payment_required":true}', {
    status: 200, headers: { 'content-type': 'application/json' },
  })).price();
  check('a response with no decimal price is unknown', garbled.known === false,
    JSON.stringify(garbled));
  check('and it is null, not zero', garbled.price_usdc === null, String(garbled.price_usdc));

  const ok = await mk(new Response('{"payment_required":false,"price_usdc":0}', {
    status: 200, headers: { 'content-type': 'application/json' },
  })).price();
  check('a stated zero IS known', ok.known === true && ok.price_usdc === 0, JSON.stringify(ok));
})();

describe('budget: the ledger on disk');
{
  const dir = mkdtempSync(join(tmpdir(), 'doorman-budget-'));
  const path = join(dir, 'nested', 'spend.ndjson');

  const b1 = openBudget({ ledgerPath: path, perRunUsdc: 1, perDayUsdc: 2, now: at('2026-09-04T10:00:00.000Z'), randomId: ids });
  const p = b1.reserve({ price_usdc: 0.75, server: 'https://a.test/mcp' });
  b1.settle(p, { audit_id: 'aud_x' });

  const raw = readFileSync(path, 'utf8').trim().split('\n');
  check('it creates the directory it was pointed at', raw.length === 2, String(raw.length));
  check('the reserve is written BEFORE the settle',
    JSON.parse(raw[0]).event === 'reserve' && JSON.parse(raw[1]).event === 'settle',
    raw.join(' | '));
  check('the settle carries the audit id', JSON.parse(raw[1]).audit_id === 'aud_x');

  // A second process on the same day reads the first one's spend.
  const b2 = openBudget({ ledgerPath: path, perRunUsdc: 1, perDayUsdc: 2, now: at('2026-09-04T18:00:00.000Z'), randomId: ids });
  check('a new process sees the same day already spent', b2.spentToday() === 0.75, String(b2.spentToday()));

  // Yesterday's spend does not count against today.
  const b3 = openBudget({ ledgerPath: path, perRunUsdc: 1, perDayUsdc: 2, now: at('2026-09-05T09:00:00.000Z'), randomId: ids });
  check('the cap is daily, so tomorrow starts clean', b3.spentToday() === 0, String(b3.spentToday()));

  rmSync(dir, { recursive: true, force: true });
}

describe('budget: a damaged ledger does not lock the doorman out');
{
  const dir = mkdtempSync(join(tmpdir(), 'doorman-budget2-'));
  const path = join(dir, 'spend.ndjson');
  const b = openBudget({ ledgerPath: path, perRunUsdc: 1, perDayUsdc: 2, now: at('2026-09-04T10:00:00.000Z'), randomId: ids });
  b.reserve({ price_usdc: 0.5 });

  // A half-written line, the shape a killed process leaves behind.
  const { appendFileSync } = await import('node:fs');
  appendFileSync(path, '{"event":"reserve","price_usd', 'utf8');

  const after = openBudget({ ledgerPath: path, perRunUsdc: 1, perDayUsdc: 2, now: at('2026-09-04T11:00:00.000Z'), randomId: ids });
  check('the good lines still count', after.spentToday() === 0.5, String(after.spentToday()));
  check('the damage is REPORTED, not swallowed', after.damagedLines === 1, String(after.damagedLines));
  check('readLedger returns a shape, not an array with a stray property',
    Array.isArray(readLedger(path).entries) && typeof readLedger(path).skipped === 'number');

  rmSync(dir, { recursive: true, force: true });
}
