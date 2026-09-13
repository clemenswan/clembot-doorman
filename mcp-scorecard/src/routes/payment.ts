/**
 * x402 — the discovery half, built, and the settlement half, refused.
 *
 * ## What is real here
 *
 * A correct x402 **v2** HTTP challenge: 402 with a base64 `PAYMENT-REQUIRED`
 * header carrying a `PaymentRequired` object. An agent that speaks x402 can
 * read it and learn the price, the network, the asset and the recipient. That
 * half is complete and it is the half that makes the service discoverable.
 *
 * ## What is deliberately NOT real
 *
 * We cannot verify a payment. There is no wallet and no facilitator wired to
 * this Worker. So a request arriving WITH a `PAYMENT-SIGNATURE` header is
 * **refused**, not admitted. Accepting an unverified header would be a paywall
 * that any string opens, which is worse than no paywall at all and is exactly
 * the "fabricate a credential" failure the project bans.
 *
 * The refusal uses the protocol's own failure channel — a `PAYMENT-RESPONSE`
 * header with `success: false` and `errorReason: unexpected_verify_error`,
 * which is a value from the spec's enum, not one invented here — so a client
 * that speaks x402 understands the refusal without special-casing us.
 *
 * ## Wire format provenance
 *
 * Read from `coinbase/x402` at `specs/x402-specification-v2.md` and
 * `specs/transports-v2/http.md` on 2026-09-04, not from memory. Three things
 * that a from-memory implementation gets wrong, and did before it was checked:
 *
 *   - the header is `PAYMENT-SIGNATURE`, not `X-PAYMENT`
 *   - the amount field is `amount`, not `maxAmountRequired`
 *   - `network` is CAIP-2 (`eip155:84532`), not a name like `base-sepolia`
 *
 * In v2 the protocol data lives in HEADERS; the response body is explicitly an
 * implementation concern. We send a JSON body as well, because a human running
 * curl should not have to base64-decode a header to find out what happened.
 *
 * ## Failing closed
 *
 * If payment is switched on but the deployment has no `PAY_TO` or `PAY_ASSET`,
 * the request is refused with 503. It does NOT fall through to the free path,
 * and it does NOT print a placeholder address: an agent that paid a made-up
 * recipient would lose real money.
 */

import { type Env, CORS } from '../index.js';

export const X402_VERSION = 2;

/** Default network: Base Sepolia in CAIP-2. Overridable, and only a default. */
export const DEFAULT_NETWORK = 'eip155:84532';
/** Default price in atomic units. 10000 = 0.01 USDC at 6 decimals. */
export const DEFAULT_AMOUNT_ATOMIC = '10000';
export const DEFAULT_TIMEOUT_SECONDS = 60;

export interface PaymentEnv {
  PAYMENTS_REQUIRED?: string;
  PAY_TO?: string;
  PAY_ASSET?: string;
  PAY_NETWORK?: string;
  PAY_AMOUNT_ATOMIC?: string;
  PAY_ASSET_NAME?: string;
  PAY_ASSET_DECIMALS?: string;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, string>;
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
}

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network: string;
  payer?: string;
}

/** Paid routes. Everything not listed here is free and must stay free. */
export const PAID_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'POST', path: '/grade' },
];

/**
 * The free tier, stated as a list rather than as "whatever is left over".
 *
 * `/grade/:id/transcripts` is on it deliberately and permanently. A grade is an
 * accusation, and evidence for an accusation cannot sit behind the accuser's
 * paywall any more than behind the accuser's token. A test asserts the tape is
 * never chargeable.
 */
export const NEVER_PAID = [
  '/', '/health', '/openapi.json', '/openapi-3.0.json',
  '/grade/:id', '/grade/:id/transcripts', '/grade?server=',
  '/allowlist/:owner', '/badge/*.svg', '/api/ledger', '/feed',
];

export function paymentsOn(env: PaymentEnv): boolean {
  return env.PAYMENTS_REQUIRED === '1' || env.PAYMENTS_REQUIRED === 'true';
}

export function isPaidRoute(method: string, path: string): boolean {
  return PAID_ROUTES.some((r) => r.method === method && r.path === path);
}

/** Missing configuration, named precisely. Empty array means good to charge. */
export function missingConfig(env: PaymentEnv): string[] {
  const gaps: string[] = [];
  if (!env.PAY_TO) gaps.push('PAY_TO');
  if (!env.PAY_ASSET) gaps.push('PAY_ASSET');
  return gaps;
}

export function buildRequirements(env: PaymentEnv): PaymentRequirements {
  const extra: Record<string, string> = {};
  if (env.PAY_ASSET_NAME) extra.name = env.PAY_ASSET_NAME;
  return {
    scheme: 'exact',
    network: env.PAY_NETWORK || DEFAULT_NETWORK,
    amount: env.PAY_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
    asset: env.PAY_ASSET as string,
    payTo: env.PAY_TO as string,
    maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

export function buildChallenge(
  env: PaymentEnv, resourceUrl: string, error?: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    resource: {
      url: resourceUrl,
      description:
        'One behavioural audit of one MCP server: static layer, probes driven ' +
        'by a real agent, a drafted usage recipe, and the full transcript.',
      mimeType: 'application/json',
    },
    accepts: [buildRequirements(env)],
  };
}

/** Base64 for a header value. UTF-8 safe: btoa alone mangles non-ASCII. */
export function b64(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeHeader<T>(value: string): T | null {
  try {
    const bin = atob(value);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/**
 * GET /price — free, unauthenticated, and the reason a client never has to
 * ASSUME what an audit costs.
 *
 * A client that defaults an unknown price to zero passes every spend cap it
 * has, forever. So the doorman refuses to spend against a price nobody gave
 * it, and this is where it gets one. When payments are off the answer is
 * `price_usdc: 0` and `payment_required: false`, which is a **discovered**
 * zero: the caller knows it asked and was told free, rather than having
 * guessed free because a field was missing.
 *
 * The atomic amount is authoritative. `price_usdc` is a decimal convenience
 * derived from it, and it is omitted rather than guessed when the asset's
 * decimals are not configured, because dividing by the wrong power of ten is
 * how a client cheerfully authorises a thousand times the intended amount.
 */
export function handlePrice(env: Env & PaymentEnv, resourceUrl: string): Response {
  if (!paymentsOn(env)) {
    return new Response(JSON.stringify({
      payment_required: false,
      price_usdc: 0,
      x402Version: X402_VERSION,
      note:
        'This deployment does not currently charge for POST /grade. This is a ' +
        'discovered zero, not a default: ask before you assume.',
    }, null, 2), { status: 200, headers: jsonHeaders() });
  }

  const gaps = missingConfig(env);
  if (gaps.length > 0) {
    return new Response(JSON.stringify({
      payment_required: true,
      price_usdc: null,
      error: 'payment is required but unconfigured: ' + gaps.join(', ') + ' unset',
      x402Version: X402_VERSION,
    }, null, 2), { status: 503, headers: jsonHeaders() });
  }

  const reqs = buildRequirements(env);
  const decimals = Number(env.PAY_ASSET_DECIMALS ?? NaN);
  const price_usdc = Number.isInteger(decimals) && decimals >= 0
    ? Number(reqs.amount) / 10 ** decimals
    : null;

  return new Response(JSON.stringify({
    payment_required: true,
    amount_atomic: reqs.amount,
    asset: reqs.asset,
    network: reqs.network,
    // Null means "we did not tell you the decimals", never "free".
    price_usdc,
    x402Version: X402_VERSION,
    accepts: [reqs],
    paid_routes: PAID_ROUTES,
    never_paid: NEVER_PAID,
  }, null, 2), { status: 200, headers: jsonHeaders() });
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json; charset=utf-8', ...CORS };
}

/**
 * The gate. Returns a Response to send instead of the handler's, or null to
 * let the request through.
 *
 * Three outcomes and no fourth:
 *
 *   1. payments off, or a free route      -> null, proceed
 *   2. on but unconfigured                -> 503, refuse. Never a fake address.
 *   3. on and configured                  -> 402 challenge, or, if the client
 *                                            sent PAYMENT-SIGNATURE, a refusal
 *                                            saying verification is not wired
 *
 * There is no path here that lets an unverified payment through. That is the
 * point of the function.
 */
export function paymentGate(
  req: Request, env: Env & PaymentEnv, path: string,
): Response | null {
  if (!paymentsOn(env)) return null;
  if (!isPaidRoute(req.method, path)) return null;

  const gaps = missingConfig(env);
  if (gaps.length > 0) {
    return new Response(
      JSON.stringify({
        error:
          'This deployment requires payment but is not configured to receive ' +
          'it: ' + gaps.join(', ') + ' unset. Refusing rather than publishing a ' +
          'placeholder recipient, because an agent that paid one would lose ' +
          'real money.',
        x402Version: X402_VERSION,
      }, null, 2),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } },
    );
  }

  const signature = req.headers.get('PAYMENT-SIGNATURE');
  const resourceUrl = new URL(req.url).toString();

  if (signature) {
    // A payment arrived. We cannot check it, so we do not honour it.
    const settlement: SettlementResponse = {
      success: false,
      errorReason: 'unexpected_verify_error',
      transaction: '',
      network: env.PAY_NETWORK || DEFAULT_NETWORK,
    };
    return new Response(
      JSON.stringify({
        error:
          'Payment received but NOT verified, and therefore not honoured. This ' +
          'deployment has no facilitator wired, so it cannot check that a ' +
          'PAYMENT-SIGNATURE is real. Admitting an unverified payment would be ' +
          'a paywall any string opens. Nothing was charged and nothing was queued.',
        x402Version: X402_VERSION,
      }, null, 2),
      {
        status: 402,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'PAYMENT-RESPONSE': b64(settlement),
          'PAYMENT-REQUIRED': b64(buildChallenge(env, resourceUrl)),
          ...CORS,
        },
      },
    );
  }

  const challenge = buildChallenge(
    env, resourceUrl, 'PAYMENT-SIGNATURE header is required',
  );
  return new Response(JSON.stringify(challenge, null, 2), {
    status: 402,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'PAYMENT-REQUIRED': b64(challenge),
      ...CORS,
    },
  });
}

/**
 * What the ORIGIN can learn about a payment that settled somewhere else.
 *
 * The gateway takes the money. x402 settlement happens on its side, and this
 * Worker is the upstream it proxies to, so by default the origin never learns
 * it was paid at all. That is not a theory: the first real payment settled on
 * Base on 2026-09-13 (`0xf1d7aa96...`, USDC 0.01) and `/api/ledger` reported
 * `spent: 0` with `amount_usd: null` on that audit's own rows, because nothing
 * here looked. A revenue counter that reads zero after a real sale is worse
 * than no counter, because it looks like an answer.
 *
 * NOTHING IS STANDARDISED FOR THE UPSTREAM LEG. x402 v2 standardises what the
 * client sends (`PAYMENT-SIGNATURE`) and what the resource returns
 * (`PAYMENT-RESPONSE`). It says nothing about what a gateway forwards to the
 * API behind it, so this reads a candidate list rather than asserting a shape,
 * and records WHICH header it came from so a change is visible in the ledger
 * instead of silently reverting us to blind.
 *
 * One thing we already know from the same payment: the gateway does NOT
 * forward `PAYMENT-SIGNATURE`, because `paymentGate` would have refused it and
 * the call returned 202.
 *
 * THE AMOUNT IS NOT HERE, and cannot be. The receipt we have seen carries
 * `{ success, transaction, network, payer }` and no figure, and the origin's
 * own price is zero: the cent is the GATEWAY's price, set out of band, so this
 * Worker genuinely does not know what was charged. `amount_usd` therefore
 * stays null unless a gateway sends one, and the ledger records the
 * transaction hash instead, which is the auditable fact either way.
 */
export interface GatewaySettlement {
  transaction: string | null;
  network: string | null;
  /** Which header carried it. Recorded so a gateway change is visible. */
  header: string;
  /** Present only if some gateway ever sends a figure. Usually null. */
  amount_usd: number | null;
}

/** Checked in order. Lowercase; Headers.get is case-insensitive anyway. */
export const SETTLEMENT_HEADERS = [
  'payment-response',
  'x-payment-response',
  'x-payment',
  'x-402-payment-response',
];

export function gatewaySettlement(req: Request): GatewaySettlement | null {
  for (const name of SETTLEMENT_HEADERS) {
    const raw = req.headers.get(name);
    if (!raw) continue;
    const body = decodeHeader<Record<string, unknown>>(raw);
    // A header that is present but unreadable is still evidence that SOMETHING
    // was forwarded, and losing that would put us back to guessing. Record it
    // with a null transaction rather than returning null.
    const tx = typeof body?.transaction === 'string' ? body.transaction : null;
    const net = typeof body?.network === 'string' ? body.network : null;
    const amt = typeof body?.amount_usd === 'number' ? body.amount_usd
      : typeof body?.amountUsd === 'number' ? (body.amountUsd as number)
      : null;
    // `success: false` is a settlement that did NOT happen. Recording it as
    // revenue would be the fabrication this project exists to refuse.
    if (body && body.success === false) return null;
    return { transaction: tx, network: net, header: name, amount_usd: amt };
  }
  return null;
}

/**
 * Header NAMES only, never values, sorted, capped.
 *
 * Written to the ledger when an authorised call arrives carrying no settlement
 * we can read. It is the only way to find out what a gateway actually forwards
 * without another paid call, and names alone cannot leak a credential.
 */
export function forwardedHeaderNames(req: Request): string[] {
  const names: string[] = [];
  req.headers.forEach((_v, k) => names.push(k.toLowerCase()));
  return [...new Set(names)].sort().slice(0, 40);
}
