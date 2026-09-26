# Clembot Doorman

An AI ops tool. It reads a build's own prompt history, says what that build is
missing, and refuses tools that should not be installed. **Started during
ETHOnline 2026 and outgrew it**; the submission is closed and the deadline is
history, not scope.

Source of truth for scope: `clembot-doorman-project.md`. Direction and open
product decisions: `positioning.md`. Current state: `roadmap.md`.

## Layout

| Path | What it is |
|---|---|
| `mcp-scorecard/` | The grading service. Worker + D1 + local probe runner. |
| `doorman/` | The client giveaway. Hook, subagent, registry, poller. Public since 2026-09-07 at github.com/clemenswan/clembot-doorman, as part of the whole-project snapshot. |
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

25. **Nothing arriving from outside may spend, unless it presented a permit.**
    Invariant 19 refuses to spend on the way OUT without a permit; this is the
    same rule pointed inward. `POST /grade` and the MCP `grade` tool are open on
    purpose, because the site's demo queues a real audit, so an anonymous call
    is accepted and marked `paid_allowed = 0`: it gets the free static layer and
    the runner may never spend a model token on it. **A missing credential is a
    choice, a wrong one is a mistake**, so a token that is presented and not
    accepted is a 401 that queues nothing, never a silent downgrade. A caller
    who believes it is authenticated would otherwise find out from a grade
    quietly missing 70 of its 100 points. The migration column defaults to `0`
    and the runner ORs the flag into `staticOnly`, so the permit can only ever
    REMOVE the behavioural layer, never add one. Twelve mutants, all caught.

26. **There is exactly one `INSERT INTO pending`.** There were two, this file
    and the MCP tool, and when the permit landed only one of them learned about
    it, so every MCP-queued audit silently defaulted to static-only. It failed
    safe, which is why nothing broke and why nobody would have noticed. This is
    invariant 2 applied to a write path instead of to grade math, and a test
    counts the statement in `src/` and fails at two.

27. **The user's trust list outranks the one we shipped, structurally.** The
    gate resolves its registry in a fixed order: `$DOORMAN_REGISTRY_DIR`, then
    `$CLAUDE_PROJECT_DIR/registry`, then the copy beside the script. Invariant
    24 said the INSTALLER must never overwrite a registry; as a plugin that is
    not enough, because a plugin update replaces the plugin directory wholesale
    and the gate used to read the allowlist sitting next to itself. The user's
    list now lives somewhere the plugin cannot reach. Four gate tests assert the
    ORDER rather than one outcome, and `plugin-manifest.test.mjs` fails if the
    registry ever becomes a declared plugin component.

28. **`needs` counts prompts, never tool results.** 1548 of 1656 `user` records
    in a real transcript directory are tool results, hook attachments,
    compaction summaries or expanded slash-command bodies. Counting them
    inflates every need roughly threefold and quotes skill files back at the
    user as evidence of their own intent. `isRealPrompt()` is the one place that
    rule lives, and the filters are structural fields rather than text sniffing.

29. **A match is `worth-measuring`, never `fits`.** This is invariant 9 pointed
    at the recommendation layer. `needs` drives nothing, so a match means only
    that a candidate's own published text claims a capability the build keeps
    asking for. A need with no candidate prints as `GAP` rather than being
    dropped, because a hole in our catalogue is information and silence is not.
    Prompt matching and catalogue matching use different thresholds on purpose:
    prose needs precision (`search` would match "search the codebase"), a
    product name does not (`exa-search-server` is unambiguous).

30. **A credential is named, never passed.** `--token-env NAME` and
    `.doorman/tokens.json` carry the NAME of an environment variable. The value
    reaches the runner and mcpscore by environment INHERITANCE and appears in no
    argv anywhere in the chain, because a command line is readable from the OS
    process list and can land in shell history. mcpscore's env path
    (`MCPSCORE_TOKEN`, `cli.py:271`) exists only for a bearer token, so a
    bearer is all this offers: an arbitrary-header option could only have been
    built by putting a secret in argv. One credential goes to BOTH halves of an
    audit or neither, or the grade spans two surfaces. A mapped variable that
    is not set is a REFUSAL, not an anonymous audit, because the anonymous
    audit SUCCEEDS and hands back a confident grade of a login page. This is
    invariant 9 pointed at a credential. Every grade, review row and dashboard
    cell carries `authenticated`: two rows both reading A over different
    surfaces invite a comparison that cannot be made. No refusal echoes what
    was passed, so a token typed where a name belongs does not land in a log.
    `--poll` refuses the flag outright: the queue is open, so one token would
    be presented to every url anyone queued.

31. **The open endpoint has a ceiling, and it is charged in items.** Invariant
    25 opens `POST /grade` to anonymous callers on purpose; the 2026-09-19
    launch audit found nothing limiting how often. One request carries up to 20
    servers and each writes 3 to 5 D1 rows, so the exposure was quota, queue
    growth, and being an amplifier against a third party. The quota counts
    ITEMS, because "10 requests an hour" is 200 servers an hour through a batch.
    It **fails closed**: if the counter cannot be read or written the request is
    refused, since the resource being protected is the database the check just
    failed to reach. It is charged only on an allowed decision, so retrying does
    not push a caller's own window out. `enqueueAudit` REQUIRES an `Admission`,
    which is invariant 19's reasoning pointed at quota rather than money, and
    the identity comes from `CF-Connecting-IP`, never `X-Forwarded-For`, which a
    client can set. **Two mutants survived the first pass**: the REST route
    ignoring its own refusal, and the MCP tool calling the limiter and
    discarding the answer. Both passed a test that grepped for the call site, so
    both paths are now driven rather than grepped.

32. **The queue says whether anything is listening.** The probe runner is a
    laptop process. When it is not running, `POST /grade` still answered 202
    with a poll url and the audit sat in `pending` forever: on 2026-09-19 the
    last claim was six days old and the endpoint was still accepting work.
    Nothing fabricated a grade; the service fabricated the EXPECTATION of one,
    which is invariant 9 pointed at availability. `POST /grade`, the MCP tool
    and `/health` now carry runner presence, and the note is folded into the
    reply rather than left in a status endpoint nobody polls.

    **The heartbeat is the POLL, never the CLAIM.** A runner polling an empty
    queue claims nothing and writes no ledger row, so claims cannot tell a quiet
    day from an absent runner, and that false negative would announce "nobody is
    listening" at the moment the service was working. It is recorded AFTER auth,
    so an anonymous caller cannot fake presence, and throttled to one write a
    minute, because a write per poll is ~17k D1 writes a day on the same quota
    invariant 31 exists to protect.

    **Unknown is `null`, never `false`.** An unreadable table means the question
    could not be answered, and reporting that as offline would put a false alarm
    in front of every caller. Invariant 3, applied to a status. The heartbeat
    itself fails OPEN, the opposite of the rate limiter and deliberately so: it
    only describes the world, it does not guard anything.

33. **The operator has a ceiling of their own.** Every other spend guard here
    protects the CALLER: `scorecardClient` refuses a missing budget, `enqueue()`
    refuses a missing permit, invariant 20 refuses an unknown price. None of
    them stop somebody else's audits spending Clemens's money, and `CLAUDE.md`
    already warned that the first key turns an open endpoint into an open
    wallet. `PAID_AUDITS_PER_DAY` caps paid dispenses per rolling 24h, and it
    was built BEFORE `ANTHROPIC_API_KEY` exists rather than after an invoice.

    **It sits at the DISPENSE point, not the queue.** `paid_allowed` travels to
    the runner and the runner holds the model key, so that is where money is
    committed. Over the ceiling an audit is still handed out, with
    `paid_allowed = 0`: structurally safe by invariant 25, because the permit
    can only ever REMOVE the behavioural layer. It is **never silent** (a
    `spend_capped` ledger row, a `downgraded_reason` on the work, and the
    posture on `/health`), and it **counts forward inside one poll**, so a batch
    of five cannot all pass a check that only saw the position before any of
    them.

    **An unknown position is not a licence to spend.** An unreadable counter
    dispenses static-only, which is invariant 20's "an unknown price is not a
    free one" pointed at a counter. An EMPTY `PAID_AUDITS_PER_DAY` is unset, not
    zero: `Number('')` is 0, and reading a blank config value as "pay for
    nothing" would silently stop the expensive half of the service. A typo or a
    negative falls back to the default, because the most expensive reading of a
    mistake must never be the one that wins.

34. **`0 observed` has two meanings and the ledger printed both the same way.**
    Production logged `0 observed, 0 pruned` on seven consecutive days. That
    line is what the sweep writes when every source refused AND when there was
    nothing to ask about, and the two need opposite responses. It was the
    second: `popularity_subject` is empty, `popularity-subjects.json` was never
    pushed through `runner/link.mjs`, and the sweep has been working perfectly
    on no input since it shipped. The tell was in the line's own grammar, since
    the failure segment is omitted when nothing failed, so `0 observed` with no
    `failed` block means nothing was attempted.

    `SweepResult` now carries `subjects`, `describeSweep()` says "no subjects
    mapped" and names the command that fixes it, and `/health` carries the
    posture. Invariant 3 pointed at an axis instead of a layer: unmeasured is
    not a measured zero, and a number that cannot say which one it is will be
    read as the flattering one.

    **A count is only proven by a case where the right answer is not zero.** A
    mutant that hardcoded `subjects: 0` passed every test, because every test
    swept an empty table. The fix was a sweep with two mappings, not a better
    assertion about none.

35. **A contribution carries a count, never a sentence.** `doorman contribute`
    is the first command in the giveaway that SENDS anything derived from the
    user's machine, and `needs.mjs` promises in its own header that the prompts
    never leave it. `buildPayload` therefore reads the `id` off a need and
    nothing else, so `matched`, `label`, `hits` and every prompt fragment are
    dropped BY CONSTRUCTION rather than by a filter someone has to remember to
    maintain. Invariant 28 is why that matters: most `user` records in a
    transcript directory are tool results and expanded skill bodies, so a
    free-text field here would ship the contributor's own files under a feature
    described as telling us what they were missing. A server NAME is allowed
    because it is all the gate can ever see. The Worker owns the vocabulary and
    NAMES every term it drops, rather than both halves shipping the list and
    trusting the copies to agree, which is invariant 2's reasoning applied to a
    word list instead of to grade math.

    **Nothing is sent without `--send`.** The default prints the exact JSON and
    stops. A claim about what a tool transmits is worth less than a command
    that shows you, and every other guarantee here would otherwise rest on the
    reader having taken this file's word for it.

    **The gate was not touched.** The obvious source for the blocked list is
    the gate's own refusals, and it records none. Invariant 7 keeps
    `mcp-gate.sh` offline and dependency-free, and adding a write path to the
    one security control in the product to feed a telemetry feature is a bad
    trade. The inventory already knows which declared servers are missing from
    the allowlist, which is the same set computed without going near it. An
    unreadable allowlist reports NOTHING rather than reporting every server as
    unreviewed, which is invariant 3 pointed at somebody else's configuration.

36. **Demand rides along and never mixes in.** `GET /signals` counts what
    builds asked for and could not find. It is not evidence about quality, and
    no grade, band, weight or hard-fail reads it. This is the same shelf
    `feed.ts` already puts popularity on, for the same reason: the grade is
    what happened when an agent drove the server, and a popular F is the most
    useful row the feed can carry. Holding that line is what keeps the PRD's
    non-goal ("not a universal trust authority", no central verdict) true while
    a community contributes, and it is what bounds gaming, since an inflated
    count can only ever reorder the queue of what to grade next.

    The field is `reports`, never `builds`. Nothing here knows who is asking,
    so nothing here can count builds, and one build reporting the same gap on
    thirty days is thirty reports. Contributions are anonymous permanently:
    there is no contributor column in `signal_count`, which rules out
    reputation rather than merely not building it yet.

37. **A skipped check must not be able to raise a grade in silence.** Measured
    2026-09-23 against `marketing-bootstrap`, the same target in the same
    minute, by two copies of doorman **both printing `0.2.1`**: the one 29
    commits behind reported **A 14/15** and `no MCP servers declared, so there
    is nothing to review`, while `origin/main` reported **C 15/20** and `35 of
    42 not on the trust list`.

    The older copy cannot read `claude.ai` connectors or plugin-synced servers,
    so it did not FAIL the servers-reviewed check, it **skipped** it. A skip
    leaves the denominator (20 becomes 15) rather than scoring zero, which is
    the right rule for a build that genuinely has no subagents and the wrong
    outcome here: the check it skipped was the one the build was failing.
    Blindness read as an A, on the check this project exists for.

    `no MCP servers declared` is a POSITIVE CLAIM and it was false. That is
    invariant 3 somewhere it was not looking: an unmeasured thing reported as a
    measured absence, by a checker that did not know it could not look.

    **Code written now cannot make an older copy honest.** What it can do is
    make the two distinguishable, so `doctor` returns `searchedSources` and the
    skip names it: `no MCP servers found, searched 9: .mcp.json, ..., claude.ai
    account, ~/.claude/plugins (enabled)`. A run that searched five paths and
    one that also searched the user scope now differ on screen, on exactly the
    axis that was invisible. A build too old to report the list says so rather
    than inventing one.

    `USER_SCOPE_SOURCES` lives beside the lookups it describes, in
    `reachable-servers.mjs`, for invariant 2's reason: a label list that drifts
    from the code it names is worse than no list. And every test but one hands
    `searchedSources` to `gradeBuild` directly, so one test **drives `doctor`**
    instead, because all of the others would pass while the caller quietly
    stopped supplying it. That is invariant 26's shape, caught before it shipped
    rather than after. Five mutants, five caught.

38. **A fix may change the property. It may never change only the text that
    proves the property.** `doorman fix` closes one open profile check, and the
    tempting version of it is a scaffolder: eight of the ten checks pass on a
    regex over a doc, so writing `## Declined` into a rules file moves the
    tool-vetting dimension without recording a single declined tool, and naming
    a handoff file in CLAUDE.md passes `mem-handoff` with no state behind it.
    Every one of those would raise a grade and leave the harness identical.

    So exactly ONE check is in the `generate` class, and it is `reg-drift`,
    whose correct content is the list of agents and commands on disk. That one
    cannot be gamed: the content IS what the check looks for. The other nine
    measure a human decision (which tools does this agent need, which commands
    do you actually run, what did you reject and why) and a decision is not
    derivable from a repo that does not contain it, so each returns a worklist
    naming the files and the refusal. `vet-registry` routes to `doorman allow`,
    which already exists to record that decision one reviewed entry at a time.

    The ratio is the finding, not a gap in the command. `MUST_STAY_WORKLIST`
    pins all nine by name, and promoting one is an argument to be made there.

    **Two asymmetries carry the safety.** It may propose a DENY and never an
    allow, because a deny can only remove capability while an allow grants it on
    a guess. And `--write` refuses `.claude/settings.json`, `.mcp.json`,
    anything under `registry/` (invariant 24: the gate reads it) and anything
    under `.claude/agents/` (a `tools` line is a security control, and a guessed
    control is worse than a visibly missing one), plus any existing file with no
    `doorman:generated` marker. That list is data in `writable()`, so "could
    this overwrite my config" is read rather than traced.

    Seven mutants, seven caught. Three killed nothing at first, because the
    refusal tests looped over the implementation's own lists and a shorter list
    simply meant fewer assertions. The literals in `profile-fix.test.mjs` are
    there for that reason.

## Testing

**End-to-end proof lives in `RUNBOOK.md`**, not here. This section is the
unit and smoke suites; the runbook is the four ordered tests that prove a
grade can travel from a paid call to a completed audit, three of which cost
nothing.

`mcpscore` must be on `PATH`. It is a Python console script, so a fresh
worktree usually needs `pip install mcpscore` and the interpreter's `Scripts/`
(or `bin/`) directory exported, or the runner exits with `spawn mcpscore ENOENT`
before it grades anything.

```bash
cd mcp-scorecard && npm test              # 363 unit, measured 2026-09-17
node test/smoke-grade.mjs                 # grades a live public server
node test/smoke-api.mjs                   # 75 assertions, needs wrangler dev
node test/smoke-x402.mjs                  # 20, needs wrangler dev with PAYMENTS_REQUIRED
cd ../doorman && node test/run.mjs        # 610, all offline
node test/cli-run.mjs                     # 48, the CLI's own parsers and guards
bash test-gate.sh                         # 38 adversarial
bash test-install.sh                      # 16, installs into temp dirs
node test-poller.mjs
```

Counts drift as tests are added, and a count that will not move is the tell for
a suite that stopped loading. Each figure above is what the command printed on
the date named, not a target.

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
| `GRADE_TOKEN` | authorising a PAID audit on `POST /grade` and the MCP `grade` tool |

A credential for a THIRD-PARTY server being audited is not a project secret and
is never one of these: it lives in your own environment and is referenced by
NAME from `.doorman/tokens.json` or `--token-env`. See invariant 30.

`GRADE_TOKEN` unset is a supported state and is what is deployed today: every
caller is anonymous, every audit is static-only, and nothing can spend. It is
NOT a state in which a presented token is accepted. **Set it before supplying
`ANTHROPIC_API_KEY`**, or the first key turns an open endpoint into an open
wallet.

**Absent `RUNNER_TOKEN` means the runner endpoints reject everything.** That is
deliberate: an unconfigured deployment accepts nothing rather than everything.

## Copy

No em dashes. The site follows Wanessa Labs tokens
(`wanessalabs-astro/design/tokens.css`), borders and never shadows, one forest
green, proof over promise.
