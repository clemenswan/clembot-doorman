---
project: clembot-doorman
cluster: agency
updated: 2026-09-05
---

# Roadmap

Deadline: **Sunday 13 September 2026, 12:00 EDT.** Twelve days from kickoff.

## Done (2026-09-01, session 1)

- [x] Phase 1 inventory: tooling verified, mcpscore installed and run, gap list produced
- [x] D1 schema: audits, transcripts, pending, allowlist, ledger
- [x] Grade math: 30/50/20, weight renormalisation, hard-fail cap, bands
- [x] mcpscore adapter with schema-version guard and denominator normalisation
- [x] Five probe modules behind one host-agnostic interface
- [x] Outputs: grade.json, one-page report.md, recipe.md, badge SVG, SHA-256 bundle
- [x] Anchor stub that refuses to claim success
- [x] Worker: /grade, /grade/:id, /allowlist/:owner, /badge/*.svg, /api/*, /openapi.json (the served spec omits the /api/* runner routes)
- [x] Node probe runner: --once and --poll, sharing the Worker's grade module
- [x] PreToolUse gate, offline, dependency-free, fails closed
- [x] doorman subagent, /vet command, registry files, poller
- [x] Explainer site on Wanessa Labs tokens
- [x] 89 unit tests, 47 API assertions, 29 gate tests, smoke test against a live server

## Done (2026-09-02, session 2)

- [x] **Planted F is real.** `fixtures/planted-bad-mcp/` deployed, inert, no
      bindings, labelled everywhere. Graded F 49/100 (audit `39d3ea0b`) on the
      deployed stack. Static layer 69.83%, a pass: the F is entirely behavioural.
- [x] **The gate blocks it**, against a registry rewritten from two live audits.
      `planted-bad` exit 2, `deepwiki` exit 0, ungraded exit 2.
- [x] Fabricated registry seeds removed. Both entries now cite a real audit id,
      evidence hash and transcript url.
- [x] `injection_sniff` runs under `--static-only`. It needs no model and is the
      only probe that can cap a grade at F; skipping it made keyless audits the
      quiet ones. The fixture would have graded C before this.
- [x] The scan ships its tape. It recorded through `ctx.log` and returned an
      empty transcript, so the first real F had a zero-byte transcripts.jsonl.
- [x] `GET /grade/:id/transcripts`, public and unauthenticated. Transcripts had
      been stored since day one with no way to read them back.
- [x] Provenance no longer names a model on an audit where no model ran.
- [x] 97 unit, 57 API assertions, 29 gate, poller. Two mutation checks.

## Done (2026-09-02, session 3)

- [x] **The scorecard is an MCP server.** `POST /mcp`, one tool, `grade`. The
      doorman subagent had declared a tool nothing served; it was blocked on a
      Bazantic account that does not exist. Now it works either way, and the
      config NAME is the seam: when the gateway lands only the url moves.
- [x] **It graded itself and had to pass its own gate.** First run B 71.55.
      Fixed two real static defects, refused a third on the record
      (`capability_tools_list_changed`: we will not claim a capability we do not
      have to buy back a point). Now **A 98.63**, audit `d4bc490c`.
- [x] **Normalising a percentage did not make grades comparable.** mcpscore
      folds a forward-compat `readiness` block into its totals for some servers
      and not others. The demo's own pair was inverted: the hostile fixture
      scored 69.83% against DeepWiki's 85.71%, when on the rules both were
      measured against it is **91.78% vs 85.71%**. `splitReadiness` excludes it
      from the grade and reports it as information.
- [x] `.mcp.json` wiring the doorman to `scorecard`; registry now three real
      entries; gate verified 0/0/2/2.
- [x] 109 unit, 75 API assertions, 29 gate, poller. Two more mutation checks.

## Done (2026-09-02, session 4)

- [x] **API on `scorecard.wanessalabs.com`.** Adding the custom domain disables
      the workers.dev url, so every committed reference was swept and the
      scorecard re-graded at its new address (`d4bc490c`).
- [x] **`/openapi-3.0.json`**, a transform of the 3.1 doc rather than a second
      copy. Both validated by `@readme/openapi-parser`; the downgrade throws on
      a union it cannot express. Mutation-checked.
- [x] **The site shows all three audits** with the configuration column first,
      each row linking its tape. Verified rendered at 390 and 768 px, no
      horizontal overflow, every text/background pair at or above 4.8:1 measured
      through a canvas rather than parsed from `oklch()`.
- [x] 121 unit, 75 API assertions, 29 gate, poller.

## Done (2026-09-03, session 5)

- [x] **Fit review shipped, all six steps.** `/vet` is now a program: fit first,
      paid grade second, and the stop path returns before a scorecard client is
      constructed. A test asserts the client is never built on a redundant verdict.
- [x] Skills and repos get fit + an injection scan of their instruction text and
      report `behavioral grade: n/a`. They are never sent to the scorecard.
- [x] Obsidian note writer. One page, recipe trimmed first, `status: pending`
      always, falls back to `registry/reviews/` rather than losing a report.
- [x] Poller `--reviews` mode: acts on `pending -> approved`, **refuses a
      hard-failed server even when approved**, and appends the refusal to the note.
- [x] **Two inventory bugs found by pointing it at the REAL Clembot roster:**
      folded YAML scalars were read as `>` (4 items lost their description), and
      MCP servers declared in agent frontmatter were never collected, so a TRUE
      overlap citing `claude_ai_Canva` would have been rejected as invented.
- [x] Demo fixture verified against the live roster: 5 real agents already cover
      "fetch a page and give me the text".
- [x] 243 doorman tests, all offline. 145 scorecard. 29 gate.

## Done (2026-09-03, session 6)

- [x] **Guidance delta built.** A second `cold_open` with the drafted recipe in
      the system prompt, wired through the runner behind `--no-guidance` because
      it costs a second cold pass in model calls.
- [x] **It is a recoverability claim, not a generalisation claim, and says so.**
      The recipe is derived from the same runs it is measured against. Rather
      than bury that, the question was narrowed to the one it can honestly
      answer: we told the agent exactly what went wrong, did that fix it? A LOW
      score is the finding. A server that still fails with the correction in
      front of it cannot be saved by documentation.
- [x] **Four `not measured` gates**, each mutation-checked: no rules derived, no
      baseline, a cold run already at 100 (zero headroom would have paid a
      perfect server 20 free points), and no model.
- [x] **The guided run is kept out of the behavioural mean.** `behavioralPct`
      averages by probe id, so folding it in would pay a server twice for one
      recovery. Filed as `cold_open_guided` in the transcripts, stated as
      excluded in the report's provenance, and pinned by a test that asserts the
      behavioural percentage is unchanged.
- [x] **The guided agent never sees the grade, the band, or the hard-fail
      banner.** Built from the structured rules, not by re-parsing recipe.md:
      hand it "Do not use this server" and it refuses, scores 0, and the delta
      measures our own warning instead of the guidance.
- [x] Guidance is in the evidence hash. 20 points that moved the score without
      moving the hash would have been a hole in the bundle.
- [x] Regression is a separate flag. `guidancePct` floors at 0, so "the recipe
      made it worse" and "the recipe changed nothing" render identically without
      it. The report says WORSE outright.
- [x] 162 scorecard tests (was 145), 5 mutation checks. 243 doorman, 29 gate.

## Done (2026-09-04, session 7)

- [x] **The spend cap, complete.** `openBudget()` with a hard per-run and
      per-day limit, an append-only NDJSON ledger, and a **permit** the paid
      call requires. `scorecardClient` refuses to exist without a budget and
      `enqueue()` refuses without an open permit, so nothing spends by
      forgetting to check. Reservations are written BEFORE the call and released
      only if it did not happen, so a crash over-counts the day rather than
      under-counting it.
- [x] **An unknown price is not a free one.** `GET /price` is new, free and
      unauthenticated. `/vet` reads the price rather than assuming it, and stops
      at `price-unknown` when it cannot. A `price_usdc: 0` from the service is a
      DISCOVERED zero; a missing field is not.
- [x] **x402 v2 challenge, wire format read from the spec, not from memory.**
      402 with a base64 `PAYMENT-REQUIRED` header. Checking was worth it: the
      header is `PAYMENT-SIGNATURE` not `X-PAYMENT`, the field is `amount` not
      `maxAmountRequired`, and `network` is CAIP-2 not a name. All three would
      have shipped wrong.
- [x] **Settlement is REFUSED, not faked.** No facilitator is wired, so a
      request carrying `PAYMENT-SIGNATURE` gets a 402 and a `PAYMENT-RESPONSE`
      saying so, using a value from the spec's own error enum. Payment on with
      `PAY_TO` unset fails closed at 503 and publishes no placeholder address.
- [x] **The tape is never chargeable.** `PAID_ROUTES` is exactly `POST /grade`.
      A mutation adding the transcripts route is caught.
- [x] **13 mutation checks, all caught** (8 on the cap, 5 on the challenge).
- [x] Two test-suite defects found and fixed while doing it: the doorman runner
      turned a load-time throw into a crash with no failure count, and the
      gate's "under 2s" timing test failed reproducibly under load. The real
      no-network guarantee is the static check next to it, so the timing test is
      now a hang detector at 10s.
- [x] 184 scorecard tests (was 162), 296 doorman (was 243), 29 gate.

## Done (2026-09-05, session 8)

- [x] **`install.sh`, and it proves itself.** The gate had a 29-test suite
      proving it works IN THIS REPO, and nothing proving it works after being
      copied into someone else's project. A control installed slightly wrong
      looks exactly like one that is working: quiet. The installer now drives
      the INSTALLED gate at its installed path and checks four outcomes.
- [x] **Three of the four checks are refusals, so the fourth is not optional.**
      A gate that blocked EVERYTHING would pass all three and be useless. The
      allow probe is what makes the self-check non-vacuous, and
      `test-install.sh` sabotages the gate both open and closed to prove the
      installer fails both ways.
- [x] **It never edits `settings.json`** (merging JSON in bash without jq
      clobbers configs, and the gate is dependency-free on purpose) **and never
      overwrites an existing `registry/`** (that is the user's trust list). It
      detects and reports instead.
- [x] Verified by hand first: installed into a clean directory as a stranger
      would, confirmed allow/deny/unknown behaviour, then turned that into
      `test-install.sh`. 16 checks, 3 mutation checks on the installer itself.
- [x] Stale roadmap claim corrected: `doorman/recipes/` is not empty.

## Done (2026-09-05, session 9)

- [x] **The site leads with the finding.** Order is hero, finding, board, flow.
      The opening line was a mechanism ("MCP vetting for multi-agent systems")
      and the one asset nobody else has was four screens down.
- [x] **"What this refuses to do"**, gathering the caveats that were scattered
      as apologies. Nothing softened: it states that 70 of the 100 points on
      every published grade are unmeasured.
- [x] **"If you are here for one thing"**, four cards sending a Bazantic,
      payments, evidence or giveaway judge straight to a live URL.
- [x] The one-liner now leads with the finding, with the reasoning recorded next
      to it in the scope doc so the videos do not drift back to architecture.
- [x] Three bugs the change introduced, all found by rendering rather than
      reading: hero copy running onto the decorative panel, a duplicate headline,
      and two nav items making the masthead two lines tall while every overflow
      check read clean (the LINKS wrapped their labels; wrapping is not
      overflow).
- [x] One fix reverted after mutation-testing it: a `scroll-margin-top` for a
      sticky-header collision that measurement showed never happened. Worst
      anchor already landed 35px clear.

## Done (2026-09-07, session 10)

- [x] **Nav cut from eleven links to six.** `The finding / Demo / Architecture /
      Bazantic / Verify / Judges`. Nothing deleted: the six removed sections live
      in a jump row inside `#architecture`, verified live as out-of-nav AND
      present-in-jump-row separately.
- [x] **New `#architecture` section** with a five-tier diagram: gate, doorman,
      gateway, scorecard, probe runner, each with a labelled connector. HTML not
      SVG, because a 900px viewBox at 390px renders 12px labels at 5px. The
      Bazantic tier is dashed and tagged "specified, not deployed".
- [x] **Bazantic section rewritten on the published spec**, with the real install
      sequence and `--source hosted` called out. Marked not yet run.
- [x] **`README.md` gains a Bazantic section**: the eight-field Recipe format,
      the async problem stated rather than hidden, `bazantic.yaml` marked
      unusable.
- [x] **The repo is public.** github.com/clemenswan/clembot-doorman, 145 files,
      snapshot not history graft. `clembot-doorman-project.md` held back.
- [x] **Deployed and verified.** `60a25dbd`, Production, source `e088dca`.

## Not done, and honest about it

- [ ] **The four model-driven probes have never run against a live model.** No
      `ANTHROPIC_API_KEY` was supplied. The runner refuses to fabricate. This is
      still the single biggest gap: 50 of the 100 grade points are unexercised
      end to end. `injection_sniff` is the exception and does run keyless, which
      is why the planted F is real.
- [x] ~~Guidance delta is not implemented.~~ Built. Like the four model probes it
      has never met a live model, so every guidance number in the repo is from a
      scripted stub. See the session-6 block.
- [ ] **Anchor is a stub.** Returns `anchored: false`, `tx: null`.
- [x] ~~No remote D1.~~ Done. Remote D1 live, Worker deployed, full round trip
      verified against it twice.
- [x] ~~x402 payment: nothing built.~~ Partly built, and the split is on
      purpose. The **challenge** is real and spec-correct; the **spend cap** is
      complete and mutation-checked. **Settlement is not built and is refused
      rather than faked**: no wallet, no facilitator. So there is still no
      "payment on camera" moment. What there is instead is a refusal on camera,
      which is more on-thesis and is the one that works today.
- [x] ~~**Bazantic: no account, no gateway.**~~ Done 2026-09-08. The account
      exists and the gateway `Doorman` is ACTIVE at
      `clembot-doorman.bazgateway.com`, upstream `scorecard.wanessalabs.com`,
      `POST /grade` priced at 1,000 millicents on Base mainnet, reads at 0, the
      two runner methods not routed. Registered with `baz gateway add`, which
      succeeds where the dashboard's connection test does not: that test probes
      `/grade` with no body and gets our correct 400.
      **Still open, and it is not the account:** the gateway advertises 11 MCP
      tools for an 8-method API. It parsed the spec at registration time and
      holds that snapshot, and CLI 0.8.0 has no `update` or `refresh`. The
      served spec was filtered the same day (8 operations, verified live), so
      what remains is a dashboard re-import. Re-running `gateway add` would
      create a second gateway and lose the handle and the price rows.
      The API it wraps is deployed, documented and self-graded.
      **Update 2026-09-07:** the recipe format is no longer unknown. It is
      published and recorded in `README.md` under Bazantic, along with the
      install sequence. A Recipe is ONE task published as a single MCP tool,
      not a multi-API flow, which changes the third prize plan.
      `bazantic.yaml` is preview-only and cannot be used. **The account is
      now the only blocker.**
      **Correction:** an earlier version of this line said `doorman/recipes/` is
      empty. It has not been for some time: three real recipes are in there,
      each drafted by the scorecard from a named audit id, plus a README. The
      Bazantic PRIZE recipes are a different artifact and those do not exist.
- [x] ~~The API has no stable hostname.~~ Done. Live at
      **`scorecard.wanessalabs.com`**. Adding the custom domain DISABLED the
      workers.dev url (wrangler warns, then 404s it), so every reference in the
      repo was swept and the scorecard was re-graded at its new address.
- [x] ~~OpenAPI is 3.1.0 and some importers only take 3.0.x.~~ Both are served:
      `/openapi.json` (3.1.0) and `/openapi-3.0.json` (3.0.3). The second is a
      transform of the first, not a copy, so they cannot drift. Both validated
      by a real parser in CI, and the downgrade refuses a union it cannot
      express rather than narrowing it silently.

## Next, in order

### Immediately (needs a secret, and only a secret)
1. **Supply an `ANTHROPIC_API_KEY`.** This is the only blocker left on the
   critical path. Run all four model-driven probes against DeepWiki and against
   the planted fixture, three times each, and read the transcripts. Expect
   tuning: they are unit-tested and have never met a real model. Until this
   happens, 50 of the 100 points are unexercised end to end and every grade in
   the product is a partial audit that says so.
   - Worth watching: the fixture is already F on the injection cap alone. The
     model probes should independently show `cold_open` obeying the planted
     instructions. If they do not, the probes are too weak.

### Also unblocked, no secret needed
2. ~~**Bazantic account.**~~ Done 2026-09-08, gateway live and priced. What is
   left is a dashboard re-import of the filtered spec so `tools/list` stops
   offering the two runner tools, and deleting the duplicate draft gateway
   `scvpdfyppzat3oiffx6h7aeywq`. Both are dashboard-only: the released CLI has
   neither a spec refresh nor a `gateway rm`.
### Week 1 remainder
4. Tune probes against three real servers of different shapes.
5. ~~Guidance delta.~~ Built. Needs the key from item 1 to produce a real number.

### Week 2
8. Bazantic gateway and the three prize recipes (after 3).
9. x402 **settlement**: a wallet and a facilitator. The challenge and the hard
   spend cap are done; this is the half that needs a funded key.
10. Real Hedera anchoring, replacing the stub.
11. Dress rehearsal, then the three videos.

## Cut order if slipping

Chain test, then site polish, then the ambiguity gauntlet. Guidance delta is no
longer in the cut order: it is built, and running it costs a key, not a day.
Never cut: cold open, the hook, the payment on camera, the planted F.
