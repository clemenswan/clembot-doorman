# Runbook: proving this works end to end

Four tests, in order. **Three of them are free.** The fourth costs one cent per
call and must not be run until the first three pass, for a reason stated in
full under [Test 4](#test-4-the-paid-path-through-the-gateway).

Every command and every response in this file was run against the live system on
**2026-09-08**. Where a number is quoted it was observed, not estimated. Where
something has never been run, it says so.

---

## The chain

A grade travels through seven hops. Each test below closes a different one, and
the tests are ordered so that a failure tells you which hop broke.

```
1  agent discovers the gateway            tools/list          free
2  agent asks the price                   402 challenge       free
3  agent pays                             x402 on Base        $0.01
4  gateway forwards to the Worker         + GRADE_TOKEN
5  Worker enqueues, returns 202 + id      POST /grade
6  a probe runner claims and grades       GET /api/pending
7  runner posts back, caller polls        POST /api/result
```

Hops 1, 2, 4 and 5 are verified working. **Hop 6 is the one that is not
running**, and hops 3 and 7 have never been exercised against a paid call.

---

## Prerequisites

| Thing | Needed for | How to check |
|---|---|---|
| Node 22+ | everything | `node --version` |
| `mcpscore` (Python) | the static layer | `pip show mcpscore` |
| `RUNNER_TOKEN` | Test 2 onward | see below |
| `GRADE_TOKEN` | Test 3 | see below |
| `ANTHROPIC_API_KEY` | Test 3 | your own key |
| USDC on Base mainnet | Test 4 only | `baz wallet balance` |

**Both tokens are write-only secrets.** `wrangler secret list` shows that
`GRADE_TOKEN` and `RUNNER_TOKEN` exist and will not show their values. There is
no way to read one back. If you do not have a value to hand, **rotate rather
than hunt**:

```bash
cd mcp-scorecard
npx wrangler secret put RUNNER_TOKEN     # paste a new value, it takes effect immediately
```

`.dev.vars` holds a LOCAL value for `wrangler dev`. It is not necessarily the
production one and must not be assumed to be.

A token is checked for strength, not just presence. Under 24 characters, under
10 distinct characters, or no uppercase and no digit is refused with **503**,
not 401, because 401 would send you hunting a caller problem that does not
exist. Generate one rather than typing a phrase:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Test 0: the client half, which needs nothing at all

**Cost: nothing. Needs: no key, no Docker, no `mcpscore`, no runner.** Run this
first. It is the only test that exercises what a user touches on day one, and
if it fails, nothing downstream is worth debugging yet.

```bash
cd doorman
node cli/doorman.mjs doctor .
node cli/doorman.mjs needs .
node cli/doorman.mjs watch . --all
```

**What each should print, and what a failure means:**

| Command | Expected | If it does not |
|---|---|---|
| `doctor` | Your harness, your servers, and whether the gate is installed AND wired | Those are two different lines on purpose. "Installed" with "not wired" is a gate that does nothing, and it is the most common broken state |
| `needs` | Needs counted from your own prompts, with `UNMET` / `GAP` / `COVERED` | `0 prompts read` means it found no history. Claude Code keeps it under `~/.claude/projects/<path-with-dashes>`; pass `--history DIR` if yours is elsewhere |
| `watch --all` | Every graded row, classified against your build | A `BLOCKED (do not adopt)` section containing WebZum is the expected output today, with a tape link |

**The one assertion worth making by hand.** `needs` must never print the word
`fits`, and `watch` must never print it either. Both do a mechanical match and
neither drove anything, so neither may claim a server will work:

```bash
node cli/doorman.mjs needs . --json | grep -c '"fits"'     # must be 0
node cli/doorman.mjs watch . --all --json | grep -c '"fits"' # must be 0
```

**A fresh machine with no history** is the demo case, and it is supported:

```bash
node cli/doorman.mjs needs /path/to/brand-new-project \
  --history ~/.claude/projects/<a-project-you-have-used>
```

`evidence/needs-demo/` holds verbatim captures of exactly this, with the input
history committed beside them, so you can diff your run against a known one.

---

## Test 1: the grader alone

**Free. No key, no token, no network beyond the server being graded.** This
proves `mcpscore`, the report writer and the scoring maths work on your machine.
The Worker is not involved at all.

```bash
cd mcp-scorecard
node runner/run.mjs --once \
  --server https://mcp.deepwiki.com/mcp \
  --needed-for "look up how a public repository works" \
  --static-only
```

**Observed 2026-09-08:**

```
| Static (mcpscore)   | 85.71%        | 100% | 85.71 |
| Behavioral (probes) | _not measured_|   0% |     0 |
| Guidance delta      | _not measured_|   0% |     0 |
| **Final**           |               |      | **85.71/100** |

mcpscore 1.11.0
```

**Pass:** a score, a report, and three named failure modes.
**Fail with `mcpscore: not found`:** `pip install mcpscore`.
**Fail with an Anthropic error:** you dropped `--static-only`. Test 1 must not
need a key. If it asks for one, that is the finding.

Note what the report does NOT do: it renormalises the weights and prints
`not measured` rather than scoring an unrun layer zero. A 0 and an absence are
different claims and the report keeps them different.

---

## Test 2: the queue chain

**Free. No key, no money.** This is the hop that is currently broken, so this is
the test that matters most.

There is already a real audit waiting in the production queue, enqueued
2026-09-08 to make this test concrete:

```
audit_id      1fa627e1-b0f3-40c5-b2d8-52b7d83b730c
server        https://mcp.deepwiki.com/mcp
depth         static-only
paid_allowed  false
```

### 2a. Confirm the queue state before you start

```bash
cd mcp-scorecard
npx wrangler d1 execute mcp-scorecard --remote --json \
  --command "SELECT COUNT(*) AS queued, SUM(CASE WHEN claimed_at IS NULL THEN 1 ELSE 0 END) AS unclaimed, SUM(paid_allowed) AS paid FROM pending;"
```

**Observed:** `{ "queued": 1, "unclaimed": 1, "paid": 0 }`

> The `pending` table has no `status` column. Grouping by one returns
> `no such column: status`, which reads like an outage and is a typo.

### 2b. Start the runner

```bash
cd mcp-scorecard
export RUNNER_TOKEN=<the production value>
export SCORECARD_API=https://scorecard.wanessalabs.com
node runner/run.mjs --poll --static-only
```

It polls every 5 seconds by default (`--interval SEC` to change it) and runs
until you stop it.

### 2c. Watch the audit complete

```bash
curl -s https://scorecard.wanessalabs.com/grade/1fa627e1-b0f3-40c5-b2d8-52b7d83b730c
```

**While queued (observed):**

```json
{
  "status": "queued",
  "grade": null,
  "score": null,
  "layers": { "static_pct": null, "behavioral_pct": null, "guidance_pct": null },
  "mcpscore_version": null,
  "evidence_sha256": null
}
```

**Pass:** `status` becomes `complete`, `score` and `grade` are non-null,
`mcpscore_version` is filled in, and `evidence_sha256` is a real hash.

**This is the whole test.** If it completes, hops 5, 6 and 7 all work and the
service can actually deliver what a customer would be buying.

### 2d. The cheap read path, while you are here

```bash
curl -s "https://scorecard.wanessalabs.com/grade?server=https%3A%2F%2Fmcp.deepwiki.com%2Fmcp"
```

Returns the latest **complete** grade for that server without queueing
anything. Observed: `A`, `85.71`, `mcpscore 1.11.0`. That is the same static
number Test 1 produced locally, which is a useful consistency check between the
two paths.

---

## Test 3: the behavioural layer

**Free in crypto terms. Costs Anthropic tokens.** This is the 70 of 100 points
that have never been measured, and the layer the site and README describe.

### 3a. Run the poller with a key and without `--static-only`

```bash
cd mcp-scorecard
export RUNNER_TOKEN=<production>
export SCORECARD_API=https://scorecard.wanessalabs.com
export ANTHROPIC_API_KEY=<your key>
node runner/run.mjs --poll
```

`--no-guidance` skips the guidance pass, which re-runs `cold_open` with the
drafted recipe and therefore costs a second `cold_open` in model calls. Skipping
leaves that layer `not measured`, never zero.

### 3b. Queue a FULL audit, which needs the grade token

```bash
curl -s -X POST https://scorecard.wanessalabs.com/grade \
  -H "content-type: application/json" \
  -H "authorization: Bearer $GRADE_TOKEN" \
  -d '{"name":"DeepWiki","url":"https://mcp.deepwiki.com/mcp","needed_for":"look up how a public repository works"}'
```

**The body shape is a bare object, or an array of them.** There is no `servers`
wrapper and no `server` key. `{"url": ..., "needed_for": ...}` is the whole
thing, and `url` is the only required field. The OpenAPI spec documents this
correctly with a worked example; guessing does not work.

**Pass:** `202`, and the returned audit shows `"depth": "full"` with
`"paid_allowed": true`. If it says `static-only`, the token was not accepted as
authorising a paid run.

### 3c. Confirm the layer actually filled in

```bash
curl -s https://scorecard.wanessalabs.com/grade/<audit_id> | grep behavioral_pct
```

**Pass:** `behavioral_pct` is a number. If it is still `null` on a `complete`
audit, the runner graded it static-only. See the hazard below.

---

## Test 4: the paid path through the gateway

**This is the only test that costs money, and it must be last.**

### Why last

Until Test 2 passes, a paid call settles on chain, returns `202` with an audit
id, and queues work that nothing claims. The caller polls forever. Bazantic's
own documentation is explicit that a failed call still costs money: the gateway
takes payment, forwards, and returns whatever the provider said. **A 202 reads
as success to every layer in between.** Paying before the runner is up is
charging for something that cannot be delivered.

### 4a. Confirm the price without paying

A price probe is free. A wrong path 404s; a correct one returns 402 with the
price in both the v2 header and the v1 body.

```bash
curl -s -i -X POST https://clembot-doorman.bazgateway.com/grade \
  -H "content-type: application/json" \
  -d '{"url":"https://mcp.deepwiki.com/mcp","needed_for":"price probe only"}'
```

**Observed 2026-09-08**, decoded from the `PAYMENT-REQUIRED` header:

```json
{ "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "10000",
    "payTo": "0x72Bb2c966297FcDd7BdC2dcDaD1F62e4DDD2586D",
    "maxTimeoutSeconds": 60 }] }
```

Read that carefully before funding anything:

- `eip155:8453` is Base **mainnet**. Not a testnet. Real money.
- `0x8335...2913` is the canonical USDC contract on Base.
- `amount: "10000"` is base units of a 6 decimal token, so **$0.01**.
- The v1 body says the same thing in the older spelling: `network: "base"`,
  `maxAmountRequired: "10000"`.

`GET /price` returns **404 through the gateway** because it is not in the
OpenAPI document and therefore is not routed. Free price discovery through the
gateway is the 402 challenge above, which works. The origin's own `/price`
answers `payment_required: false, price_usdc: 0`, which is correct and not a
contradiction: the origin does not charge, the gateway does.

### 4b. Fund it, the safe way

Two routes, and they are not equivalent.

| Route | Cap | Revocable | Verdict |
|---|---|---|---|
| Hosted balance + a grant | yes | yes | **use this** |
| Self-custody wallet | no | no | the doorman refuses it |

```bash
# the slug is the `slug` FIELD from `baz gateway list --json`, not the subdomain
baz grant create --name doorman --cap 1 --service fcpwnq7vanbpdjyv7lzyy2icha
```

`--cap 1` is one USDC, which at a cent a call is 100 grades. But **a cap is a
ceiling, not a prefund**: the hosted balance is the real limit, and it was $0.23
on 2026-09-11, which is 23 calls. `--service` restricts the credential to this
one gateway. The command prints an approval URL and waits for you to approve it
in a browser, cross-checking a device fingerprint. It cannot be done unattended.

**The service slug is opaque.** `gateway list --json` returns
`slug: fcpwnq7vanbpdjyv7lzyy2icha` for the gateway whose endpoint is
`clembot-doorman.bazgateway.com`, so the two are not the same string and the
subdomain is derived from the listing name. This file said `--service
clembot-doorman` until 2026-09-11. Which string the flag accepts is `[VERIFY]`:
the command has never been run. Read the field, do not type either one.

`--network` accepts `base` or `base-sepolia` and defaults to `base` on
production. **A sepolia grant cannot pay a mainnet gateway**, and this gateway is
registered on mainnet, so leave the default alone.

### 4c. Make one paid call

```bash
baz curl https://clembot-doorman.bazgateway.com/grade \
  --account doorman --max-amount 0.05 --json \
  -X POST -H "content-type: application/json" \
  -d '{"url":"https://mcp.deepwiki.com/mcp","needed_for":"paid end to end test"}'
```

**There is no `--source` flag.** This file required `--source hosted` and called
it not optional until 2026-09-11, when `baz curl --help` was finally read on the
installed CLI 0.8.0. Its flags are `--method --header --data --account
--max-amount --network --x402-version --passphrase-stdin --json --yes`, and that
is the whole list. The hazard was real; the guard was imaginary. What actually
holds a call to the hosted balance is `--account <grant-name>`, because `wallet`
and `local` are reserved names that reach the self-custody wallet instead.
`grant list` reports `wallet none`, so there is currently nothing to fall
through to. Fund a wallet and that stops being true.

**Check what the gateway forwards upstream before trusting the result.**
`spendPermit` (`mcp-scorecard/src/routes/spend.ts`) reads
`Authorization: Bearer <GRADE_TOKEN>`; with no header it returns `anonymous`,
which sets `paid_allowed: 0` and grades static-only. If the Doorman listing was
registered with the default `--auth-type x402-mpp` and carries no provider
credential, a buyer pays a cent and receives a 30-percent-weight static grade
with nothing raising an error. `gateway list --json` does not return `authType`,
so this is `[VERIFY]` from the Bazantic side, and it is the first thing to
confirm once a grant exists.

### 4d. Confirm the money bought something

```bash
curl -s https://scorecard.wanessalabs.com/grade/<audit_id>
curl -s https://scorecard.wanessalabs.com/api/ledger?limit=5
```

**Pass:** the audit reaches `complete` with a non-null `behavioral_pct`, and the
`baz curl` response carries a `transaction` hash you can open on Basescan.

**The ledger does NOT move, and this criterion used to say it would.** Corrected
2026-09-13 after the first real payment. `/api/ledger` still reports
`"spent": 0` and `amount_usd: null` on the paid audit's own rows, because the
payment settles at the GATEWAY and nothing forwards a receipt to the origin.
The Worker never learns it was paid. That number will read 0 no matter how many
people buy, so it is a measure of nothing until the origin reads the x402
payment response header and records it. Until then the chain is the proof:

```bash
curl -s https://scorecard.wanessalabs.com/grade/<audit_id>
# and the tx from the baz response, which is the authoritative record
open https://basescan.org/tx/<transaction>
```

---

## Hazards

**THE MONEY SETTLES BEFORE THE WORK, AND NOBODY CAN TELL.** Proven with real
funds on Base, 2026-09-13, at a cost of one cent. `POST /grade` answers **202 at
queue time**, the gateway settles against that 202, and grading happens minutes
later on a machine the gateway never hears from. Two paid calls:

| tx | delivered |
|---|---|
| `0xf1d7aa96...` | A 91.36 |
| `0x2748fc43...` | **nothing.** Gemini 429 mid-probe, no grade published |

The second call is the whole problem in one line. The buyer paid, the runner
correctly refused to publish a partial grade, and **the origin does not know a
payment happened**, so there is no refund path and no way to even detect the
loss from the service's own data. Three separate things have to change before
this is a product: charge on delivery rather than on enqueue, or hold the
settlement until the audit completes; forward a settlement receipt upstream;
and give the runner a model budget that cannot 429 mid-audit.

**The gateway forwards no payment evidence at all.** Measured, not assumed. A
paid call arrives at the origin carrying 29 headers, and not one is about
payment: `accept`, `accept-encoding`, `accept-language`, `authorization`,
`cf-*`, `fly-*`, `host`, `user-agent`, `via`, `x-forwarded-*`, `x-real-ip`,
`x-request-start`. No `payment-response`, no `x-payment`, nothing x402. This is
a property of the gateway pattern rather than a bug here: x402 v2 standardises
the client leg and the resource leg and says nothing about what a gateway tells
the API behind it. `gatewaySettlement()` reads for it anyway and
`paid_unaccounted` records the miss, so the ledger states the gap instead of
reading zero and looking like an answer.

**`--static-only` on the poller applies to paid jobs too.** The runner computes
`jobStaticOnly = staticOnly || !permitted`, so a poller started with
`--static-only` grades everything static-only, including audits someone paid a
cent for. The resulting report is honest, it says `not measured`, but it is not
what was bought. Safe while nothing is paid. The moment you are selling, the
poller must run with a key and without that flag.

**A claim expires after 15 minutes.** A runner that dies mid-audit does not
strand the work; it returns to the queue. A runner that is merely slow can
therefore have its job taken by a second runner. Do not run two pollers against
production while testing.

**Verifying a Pages deploy too early poisons your own browser cache** for four
hours with the SPA fallback. Not a runbook step, but it is the failure that
looks most like a broken deploy and is not one.

**The gateway holds a snapshot of the OpenAPI spec taken at registration.** It
does not re-read it. CLI 0.8.0 has `gateway add` and `gateway list` and nothing
else: no update, no refresh, no rm. Changing the spec on the origin does not
change what the gateway advertises, and re-running `gateway add` creates a
second gateway with a new slug rather than updating the first.

Measured 2026-09-12, all 8 described operations against the live gateway:

| Routed | 404 |
|---|---|
| `/health` `/api/ledger` `/grade` (GET+POST) `/grade/{audit_id}` `/mcp` | **`/feed`** and **`/badge/{server}.svg`** |

`/feed` fits the snapshot story exactly: it entered the spec in `c5424022` on
2026-09-10 and the gateway registered on 2026-09-08, so the gateway has never
seen it. **`/badge` does not.** It has been in the spec since `164110a5` on
2026-09-01, a week before registration, and still 404s, so something other than
staleness is dropping it. `[VERIFY]`, and not from this side: `gateway list
--json` returns no routing table.

This matters more than it looks. `/feed` is the operation the whole push model
reads, so an agent that reaches the doorman THROUGH Bazantic cannot see new
grades at all. Direct callers to `scorecard.wanessalabs.com/feed` are unaffected,
and that is what the shipped CLI uses, so the product works and the gateway
listing under-advertises it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `400 each item needs a url` | body shape | bare object with `url`, no `servers` wrapper |
| `401` on POST /grade | token presented but not accepted | omit the header entirely for the free tier, or fix the token |
| `503` on POST /grade | `GRADE_TOKEN` is too weak to be a secret | rotate to 32 random bytes, base64url |
| `--poll needs RUNNER_TOKEN` | not exported | see Prerequisites; rotate if unknown |
| Audit stays `queued` forever | no runner polling | that is Test 2 |
| `complete` but `behavioral_pct` is null | poller ran `--static-only`, or no key | drop the flag, export the key |
| `no such column: status` | `pending` has no such column | query `claimed_at IS NULL` instead |
| Dashboard says "Gateway unreachable" | its health check probes `/grade` with no body and gets our correct 400 | ignore it; a real `tools/list` returns 200 |
| `tools/list` returns 11 not 9 | gateway snapshot predates the spec filter | dashboard re-import; there is no CLI path |

---

## What "working" means, as a checklist

- [x] `tools/list` answers through the gateway
- [x] a 402 price probe returns the real price, free
- [x] anonymous `POST /grade` queues a static-only audit and says so
- [x] a wrong token is 401 and explains the free path
- [x] a weak token is 503, not 401
- [x] the served OpenAPI spec describes 8 operations, and the two runner routes
      are neither described nor reachable through the gateway
- [x] `--once --static-only` grades a live server on this machine
- [x] a queued audit reaches `complete` (Test 2): `204ac9a0`, 2026-09-11
- [x] a `complete` audit carries a non-null behavioural layer (Test 3): 91.75
- [x] **one paid call settles and delivers** (Test 4). 2026-09-13T04:25:23Z,
      Base block 51242088, tx
      `0xf1d7aa9696c92b012c8f1eebd222d353c0e452e264294145fb7825000e2d01a0`.
      USDC 0.01 moved, audit `8ff6bba8` came back **A 91.36** with
      `behavioral_pct 94.75` forty seconds later.
- [ ] the gateway advertises what the origin serves: `/feed` and `/badge` still
      404 through it, and there is no CLI path to re-import
- [ ] **the origin can see its own revenue.** New, and only visible once
      something was actually paid: the ledger reports `spent: 0` and
      `amount_usd: null` on the rows of an audit that WAS paid for. Settlement
      happens at the gateway and no receipt reaches the Worker.

Ten of twelve. The paid path is closed. What is left is the gateway advertising
less than the origin serves, and the origin being unable to account for money it
has already been paid.
