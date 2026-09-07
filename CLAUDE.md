# Clembot Doorman

ETHOnline 2026 build. Deadline **Sunday 13 September 2026, 12:00 EDT**.
Source of truth for scope: `clembot-doorman-project.md`. Current state: `roadmap.md`.

## Layout

| Path | What it is |
|---|---|
| `mcp-scorecard/` | The grading service. Worker + D1 + local probe runner. |
| `doorman/` | The client giveaway. Hook, subagent, registry, poller. Extract to a public repo before launch. |
| `fixtures/planted-bad-mcp/` | The hostile server the demo grades F. Deployed, inert, no bindings. |
| `doorman/recipes/` | Usage recipes drafted from real audits. NOT the Bazantic prize recipes. |
| `site/` | clembot-doorman.wanessalabs.com. Static, Direct Upload. |
| `evidence/` | Real audit bundles. Committed as proof, never hand-edited. |

## Invariants

These are not preferences. Breaking one silently makes the product dishonest.

1. **`src/` must never touch a platform API.** It is typechecked against
   Cloudflare Workers types alone (`tsconfig.json`), and the runner imports the
   *built* copy. A probe reaching for `node:fs` breaks the build, which is the
   intended behaviour, not an obstacle to route around.

2. **Never reimplement grade math.** One module, imported by both halves. Two
   implementations drift, and a laptop grade stops meaning what a Worker grade
   means.

3. **An unmeasured layer is `null`, never `0`.** Weights renormalise over what
   ran. Zeroing an unrun layer fails honest partial audits.

4. **Never compare raw mcpscore scores.** The denominator moves per server.
   Normalise through `staticPct` first, always.

5. **Transcripts are evidence.** Never truncated, never edited, never sampled.
   Summary fields may elide; the stored transcript may not.

6. **Never call `process.exit()`.** On Node 25 / Windows it trips a libuv
   assertion when sockets are open and replaces the real exit code with 127. Set
   `process.exitCode`.

7. **The gate stays offline and dependency-free.** No network verb, no jq, no
   node, no python in `mcp-gate.sh`. Refusals exit 2, never 1. Tests assert both
   statically.

8. **The doorman subagent gets exactly one MCP tool.** Never widen it.

9. **Never fabricate a grade, a score, or a credential.** Missing key means the
   run stops and says so. The anchor stub returns `anchored: false` and a null tx
   precisely so nothing downstream can mistake it for real. This applies to the
   registry too: the shipped denylist cites a real audit of a real server, not a
   plausible-looking entry for `example.com`.

10. **A scan-only probe runs even without a key.** `injection_sniff` needs no
    model, and it is the only probe that can cap a grade at F. Dropping it with
    the model-driven probes would have made the cheapest audits the ones that
    stayed quiet about hostile tool descriptions. `SCAN_ONLY_PROBES` is the list;
    `--static-only` filters on it rather than skipping probes wholesale.

11. **Readiness is reported, never graded.** mcpscore folds its forward-compat
    rules into the top-level totals for SOME servers (`readiness.counted_in_main`
    varies per server), so normalising `score/max_score` is not enough to make
    two servers comparable. `splitReadiness` removes it from the graded number.
    Invariant 4 is about the denominator moving; this is the composition moving.

12. **We pass our own gate, with no exemption.** The hook matches `mcp__.*` and
    `scorecard` is in the allowlist because it was graded, not because it is
    ours. If our own score drops below the bar, that is a real problem to fix,
    not a rule to bend.

13. **Fit before pay, and the stop path cannot spend.** `/vet` runs the free fit
    review first. On `redundant` or `out-of-scope` it returns BEFORE a scorecard
    client is constructed, not merely before one is called: a path that cannot
    spend money is easier to prove than a path that remembers not to. A test
    asserts the client is never even built.

14. **A skill or a repo is never sent to the scorecard.** It has no tools to
    drive, so a behavioural grade cannot exist for it. `mayBeGraded()` is the one
    place that rule lives, and the report says `behavioral grade: n/a` rather
    than leaving a null for a reader to misread.

15. **Nothing auto-approves.** The note writer only ever emits `status: pending`
    and a test asserts the word `approved` appears nowhere in its output. A human
    flips it. The poller then refuses a hard-failed server even when the note says
    approved, and appends that refusal to the note itself.

16. **A verdict ships with its tape.** Anything that can accuse a server puts
    the scanned surface, verbatim, on `run.transcript` and not only through
    `ctx.log`, which hosts wire to the console and drop. `GET
    /grade/:id/transcripts` is public and unauthenticated for the same reason:
    the evidence for an accusation cannot sit behind the accuser's token.

17. **The guidance pass is measured separately and never folded back in.**
    `behavioralPct` averages by probe id, so pushing the guided `cold_open` into
    the probe list would pay a server twice for one recovery. It is returned on
    its own, filed under `cold_open_guided` in the transcripts, and the report
    states that it is excluded. The guided agent is handed the recipe RULES
    only, never the grade or the hard-fail banner: telling it "Do not use this
    server" makes it refuse, and the delta then measures our own warning.

18. **The guidance layer says `not measured` rather than guessing.** No rules
    derived, no baseline, a cold run already at 100, or no model: all four are
    skips with a recorded reason, not a score. A vacuous 100 on zero headroom
    would hand a perfect server twenty free points. This is invariant 3 applied
    to the one layer where a plausible number was easiest to invent.

19. **Nothing spends without a permit, and a permit is single-use.**
    `scorecardClient` refuses to be constructed without a budget, and
    `enqueue()` refuses without an OPEN permit from that budget. A required
    argument cannot be forgotten by a new code path the way a check can. Same
    reasoning as invariant 13, one layer down.

20. **An unknown price is not a free one.** `budget.reserve()` refuses a null,
    undefined or non-numeric price, and `/vet` reads the price from `GET /price`
    rather than assuming it. A client that defaults an unknown price to zero
    passes every spend cap it has, forever. This is invariant 3 pointed at money
    instead of at a grade, and a `price_usdc: 0` from the service is a
    **discovered** zero, which is a different thing from a missing field.

21. **We do not accept a payment we cannot verify.** There is no facilitator
    wired, so a request carrying `PAYMENT-SIGNATURE` is REFUSED, not admitted.
    A paywall that opens for any string is worse than no paywall: it looks like
    protection. The refusal goes out through the protocol's own failure channel
    with `errorReason: unexpected_verify_error`, a value from the spec's enum.
    With payment on but `PAY_TO`/`PAY_ASSET` unset the Worker fails **closed**
    with 503 and publishes no placeholder address, because an agent that paid a
    made-up recipient would lose real money.

22. **The tape is never chargeable.** `PAID_ROUTES` holds exactly `POST /grade`.
    Invariant 16 says evidence for an accusation cannot sit behind the accuser's
    token; it cannot sit behind the accuser's paywall either. A test asserts the
    transcripts route is free with payments fully on, and a mutation that adds it
    to `PAID_ROUTES` is caught.

23. **An install script that cannot fail is not a check.** `install.sh` ends by
    driving the INSTALLED gate at its installed path, not the one in this repo,
    because a security control installed slightly wrong looks exactly like one
    that is working: quiet. Three of its four probes are refusals, and a gate
    that blocked EVERYTHING would pass all three, so the allow probe is not
    optional. `test-install.sh` sabotages the gate open and closed and asserts
    the installer fails both ways.

24. **The installer never edits `settings.json` and never overwrites a
    `registry/`.** The first because merging JSON in bash without `jq` clobbers
    configs and the gate is dependency-free on purpose; the second because the
    registry is the user's trust list and replacing it with our three entries
    would be the most destructive thing the script could do. It reports `KEPT`
    instead.

## Testing

`mcpscore` must be on `PATH`. It is a Python console script, so a fresh
worktree usually needs `pip install mcpscore` and the interpreter's `Scripts/`
(or `bin/`) directory exported, or the runner exits with `spawn mcpscore ENOENT`
before it grades anything.

```bash
cd mcp-scorecard && npm test              # 184 unit
node test/smoke-grade.mjs                 # grades a live public server
node test/smoke-api.mjs                   # 75 assertions, needs wrangler dev
node test/smoke-x402.mjs                  # 20, needs wrangler dev with PAYMENTS_REQUIRED
cd ../doorman && node test/run.mjs        # 296, all offline
bash test-gate.sh                         # 29 adversarial
bash test-install.sh                      # 16, installs into temp dirs
node test-poller.mjs
```

The doorman suite runs with `globalThis.fetch` replaced by a throw as part of
verification. Every network and every paid call is injected.

`smoke-x402.mjs` exists because `payment.test.ts` calls `paymentGate()` directly
and proves nothing about whether the Worker routes through it. A gate that is
correct and unwired looks exactly like no gate. Its header carries the wrangler
flags to switch payment on locally; the deployed Worker leaves it off.

**Mutation-check anything security-relevant before trusting it green.** Two gate
tests originally passed for the wrong reason: the denylist case was satisfied by
the unknown path, and nothing covered substring key matching. A green suite is
not evidence until you have watched it fail.

## Deploying

- Worker: `cd mcp-scorecard && npx wrangler deploy`. D1 id is in `wrangler.toml`.
  Serves the REST API **and** `POST /mcp`, the MCP server the doorman calls.
- Fixture: `cd fixtures/planted-bad-mcp && npx wrangler deploy`. Separate Worker,
  no bindings.
- Site: Direct Upload. `cd site && npx wrangler pages deploy . --project-name=clembot-doorman --branch=main`.
  Pushing does NOT deploy it. Verify with `wrangler pages deployment list` that
  the row says **Production**, not Preview.
- `compatibility_date` is pinned to what wrangler 4.95.0 supports. Raising it
  requires upgrading wrangler first, or the local runtime refuses to start.

## Secrets

Never in a file. `wrangler secret put`:

| Secret | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | behavioural probes |
| `RUNNER_TOKEN` | the probe runner claiming and posting work |

**Absent `RUNNER_TOKEN` means the runner endpoints reject everything.** That is
deliberate: an unconfigured deployment accepts nothing rather than everything.

## Copy

No em dashes. The site follows Wanessa Labs tokens
(`wanessalabs-astro/design/tokens.css`), borders and never shadows, one forest
green, proof over promise.
