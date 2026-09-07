#!/usr/bin/env node
/**
 * The payment gate on the REAL runtime, not as a unit.
 *
 * test/payment.test.ts calls paymentGate() directly, which proves the function
 * and says nothing about whether the Worker routes through it. A gate that is
 * correct and unwired is indistinguishable from no gate at all, so this drives
 * the actual request path.
 *
 * Needs a local Worker with payment switched ON, which the deployed one is not:
 *
 *   npx wrangler dev --port 8799 --local --var PAYMENTS_REQUIRED:1
 *     --var PAY_TO:0x209693Bc6afc0C5328bA36FaF03C514EF312287C
 *     --var PAY_ASSET:0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *     --var PAY_ASSET_NAME:USDC --var PAY_ASSET_DECIMALS:6
 *
 *   (that is one command, wrapped to fit)
 *
 *   node test/smoke-x402.mjs
 *
 * The two addresses above are the spec's own example values, used here as test
 * fixtures. They are NOT this project's wallet, and nothing in the repo ships a
 * real recipient: the Worker refuses to charge rather than default one.
 *
 * Never calls process.exit(). See the note in runner/run.mjs.
 */

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:8799').replace(/\/+$/, '');

const dec = (h) => JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   ' + detail));
  if (!cond) fails++;
};

// 1. The price is askable, free, and states its own decimals.
{
  const r = await fetch(BASE + '/price');
  const j = await r.json();
  ok('GET /price is 200 and unauthenticated', r.status === 200, String(r.status));
  ok('it reports payment is required', j.payment_required === true, JSON.stringify(j));
  ok('and converts atomic units with the configured decimals',
    j.amount_atomic === '10000' && j.price_usdc === 0.01, JSON.stringify(j));
  ok('it names the CAIP-2 network', /^eip155:\d+$/.test(j.network), String(j.network));
}

// 2. POST /grade is challenged by the real router.
{
  const r = await fetch(BASE + '/grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ url: 'https://mcp.deepwiki.com/mcp' }]),
  });
  ok('POST /grade is 402 through the Worker', r.status === 402, String(r.status));

  const hdr = r.headers.get('payment-required');
  ok('PAYMENT-REQUIRED header is present', Boolean(hdr));
  const p = hdr ? dec(hdr) : {};
  ok('it decodes to x402 v2', p.x402Version === 2, JSON.stringify(p).slice(0, 120));
  ok('the accepts entry uses `amount`, not `maxAmountRequired`',
    p.accepts?.[0]?.amount === '10000' && !('maxAmountRequired' in (p.accepts?.[0] ?? {})),
    JSON.stringify(p.accepts?.[0]));
  ok('payTo is the configured recipient',
    p.accepts?.[0]?.payTo === (process.env.SMOKE_PAY_TO || '0x209693Bc6afc0C5328bA36FaF03C514EF312287C'));
  ok('the browser can read the header (expose-headers)',
    (r.headers.get('access-control-expose-headers') ?? '').includes('payment-required'),
    String(r.headers.get('access-control-expose-headers')));
}

// 3. An unverified payment is REFUSED, and nothing is queued.
{
  const r = await fetch(BASE + '/grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': 'eyJhIjoxfQ==' },
    body: JSON.stringify([{ url: 'https://mcp.deepwiki.com/mcp' }]),
  });
  ok('a request carrying a payment is still 402', r.status === 402, String(r.status));
  const s = dec(r.headers.get('payment-response'));
  ok('PAYMENT-RESPONSE says it failed', s.success === false, JSON.stringify(s));
  ok('with a reason from the spec enum', s.errorReason === 'unexpected_verify_error', s.errorReason);
  const body = await r.json();
  ok('and the body says nothing was queued', /nothing was queued/i.test(body.error), body.error);
}

// 4. The free tier is genuinely free with payments fully on.
for (const path of ['/health', '/price', '/openapi.json', '/api/ledger',
                    '/grade?server=https%3A%2F%2Fmcp.deepwiki.com%2Fmcp']) {
  const r = await fetch(BASE + path);
  ok('free with payments on: GET ' + path.slice(0, 34), r.status !== 402, String(r.status));
}

// 5. The tape specifically. Invariant 16, as money.
{
  const r = await fetch(BASE + '/grade/does-not-exist/transcripts');
  ok('the transcripts route is never 402', r.status !== 402, String(r.status));
}

console.log(fails === 0 ? '\n  x402 LIVE CHECK PASSED' : `\n  ${fails} FAILED`);
process.exitCode = fails ? 1 : 0;
