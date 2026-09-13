---
project: clembot-doorman
cluster: agency
updated: 2026-09-12
---

# Lineage

## 2026-09-12 - Session 18: the release nobody could have run

Cutting a stable version for the ETHOnline submission. The intent was a version
bump. Four defects surfaced instead, and every one of them was invisible from
inside this worktree.

**The published package could never receive a notification.** `clembot-doorman@0.1.0`
went to npm at 17:44 UTC on 2026-09-11. `notify` and the SessionStart hook landed
in `d7252490` at 21:02 UTC, four hours later. Same version number, so `npm install`
would not even have offered the update. Bumped to 0.2.0.

**The security gate has never been executable for an npm install.** `npm pack` on
Windows drops the executable bit from every file. Downloaded the published 0.1.0
tarball and read its headers: `mcp-gate.sh`, `resolve-cli.sh` and `install.sh` are
all `-rw-r--r--`. On any POSIX machine the PreToolUse hook points at a path that
cannot execute, and a hook that cannot spawn does not exit 2. **The gate fails
open**, which its own header says is the one thing it must never do. Setting the
bit in git does not fix it, because packing is what strips it. Both hooks now run
through `bash`, and `install.mjs` chmods the copy it makes, because `copyFileSync`
inherits the source mode and its shell twin had carried that chmod all along.

**The 0.2.0 tarball reported itself as 0.1.0.** Found by extracting the artifact
and running it rather than trusting the pack. The version lives in four places:
root `package.json`, `doorman/package.json`, `.claude-plugin/plugin.json`, and a
hardcoded constant in `cli/doorman.mjs`. Two were stale. `doorman --version` is
the command the README tells people to run to check whether they have the push
half, and it was answering with the version that does not have it.

**Two advertised gateway operations 404.** Measured all eight paths in the public
spec against the live Bazantic gateway: `/feed` and `/badge/{server}.svg` return
404, the other six route. `/feed` fits the registration-snapshot hazard exactly,
since it entered the spec on 2026-09-10 and the gateway registered on 2026-09-08.
`/badge` predates registration by a week and still 404s, so something else drops
it, and `gateway list --json` exposes no routing table to say what. Left
`[VERIFY]`. The consequence is that an agent reaching the doorman THROUGH Bazantic
cannot read the feed, so the push model does not work over the gateway. Direct
callers are unaffected, and that is what the shipped CLI uses.

**The through-line.** Three of the four were invisible here because the global
`doorman` on this machine symlinks to this worktree. Local testing has always run
the source, never the artifact. The fix was not cleverness, it was building the
tarball, unpacking it, and running that. `lesson-run-the-code-reviews` again, one
layer further out: it is not enough to execute the code, you have to execute the
thing you are about to hand someone.

**Proof.** 465 tests across 18 files, plus 37 CLI, 38 gate, and the poller suite.
Both new assertions mutation-checked: reverting either hook to a bare path fails,
and reverting `plugin.json` alone fails. The 0.2.0 artifact was extracted and run:
version 0.2.0 on all four surfaces, both hooks wired through `bash`, and the gate
exits 2 from the unpacked 644 package, which is the fail-closed behaviour that was
impossible before. Commits `1b005866`, `9be48517`, `10d4bb4a`, `c6e6cd74`.

**Still open, and not hidden.** No payment has ever settled. `baz grant list`
reports `hosted none, wallet none` and `/api/ledger` reports `spent: 0` across 58
audits, because none was attempted rather than because one failed. Grant creation
needs a human at a browser and cannot be automated. Publishing 0.2.0 to npm is
also a human step.

**Postscript, later the same night: the third guidance reading arrived, and it
is a zero.** Chasing a paid call turned into four more audits of deepwiki and
an answer to the question that had been open since Session 17.

The layer now has three readings on the same server and the same model: 100,
then 33.33, then 0. `35784eff` scored cold 66 against guided 66, so the recipe
rule bought nothing at all, and one of its runs came in at 64, below its own
baseline. Two audits thirty minutes apart, `ac10cd87` at A 92.77 with guidance
skipped on the `NO_RULES` gate and `35784eff` at B 71.46 with guidance measured
at zero, differ by a band mostly because one of them happened to derive a rule
and the other did not. That is not a property of the server being graded. Full
working in `roadmap.md`; the weighting was deliberately left alone this close to
the deadline.

Two other things fell out of the same chase. The runner refused to publish a
partial grade when Gemini returned 429 mid-probe, saying so in the audit record
rather than renormalising over the layers that did complete, which is the
behaviour the null-is-not-zero invariant was written for and the first time it
has fired in anger. And the supersede pointer proved itself on an accident
nobody staged: the feed headline is now a HIGHER grade that measured LESS, with
`more_complete_audit` naming the lower three-layer audit in the same row.

The `.dev.vars` trap in the RUNBOOK is real and cost about twenty minutes. Its
`GRADE_TOKEN` was the production value, which made it tempting to assume the
`RUNNER_TOKEN` beside it was too. It was not, and the poller 401ed against
`/api/pending` while an audit sat queued for 400 seconds looking like a hung
grader. Same lesson as the rest of tonight: one component of a file being
current is not evidence about the others.


**04:25:23Z: the first payment settled.** Base block 51242088, tx
`0xf1d7aa9696c92b012c8f1eebd222d353c0e452e264294145fb7825000e2d01a0`, USDC 0.01,
and audit `8ff6bba8` came back **A 91.36** forty seconds later with
`behavioral_pct 94.75`. Every link in the chain has now run at least once:
grant, quote, x402 authorisation, on-chain settlement, gateway proxy, permit,
queue, runner, published grade.

The blocker was mundane and took an hour to see. The gateway's config was
correct the whole time (`Auth type: API key`, `Key delivery: Authorization
bearer`, upstream pointed at the right origin); the credential VALUE and the
Worker's `GRADE_TOKEN` simply disagreed, and each 401 looked like a
configuration problem rather than a mismatch. Rotating both to the same clean
43-character base64url value fixed it. Whether the previous 111-character token
was ALSO being mangled by the dashboard form, which carries `=` and `.`, was
never established and should not be recorded as the cause.

**Two things the payment revealed that nothing else could.**

The transfer is `0x72Bb2c96 -> 0x72Bb2c96`. The grant's payer address and the
gateway's payout address are the same, so this proves the mechanism rather than
a third-party sale. Worth saying out loud rather than letting someone find it on
Basescan.

And the origin cannot see its own revenue. `/api/ledger` reports `spent: 0` with
`amount_usd: null` on the paid audit's own rows, because settlement happens at
the gateway and no receipt is forwarded to the Worker. The RUNBOOK's pass
criterion for Test 4 said "that number moving is the proof". It does not move,
and it never will until the origin reads the x402 payment response and records
it. Corrected in place. A revenue counter that reads zero after a real sale is
worse than no counter, because it looks like an answer.


**And then a second paid call bought nothing, which is the finding.** Fired too
soon after the previous audit, it hit the Gemini free tier's 15-per-minute cap
mid-probe. `0x2748fc43...` settled on Base for USDC 0.01; the runner refused to
publish a partial grade, correctly; and the buyer got an audit stuck at
`failed`.

Every piece of that behaved as designed and the outcome is still that money was
taken for nothing. `POST /grade` answers 202 at ENQUEUE, the gateway settles
against the 202, and the grading happens minutes later somewhere the gateway
cannot see. Charging before the work is a design decision that was never
examined, because until tonight no money had ever moved through it.

The blindness compounds it. A paid request reaches the origin carrying 29
headers and not one mentions payment: proxy plumbing, `cf-*`, `fly-*`, and the
`authorization` credential. x402 v2 standardises the client leg and the resource
leg and is silent on what a gateway forwards upstream, so this is a property of
the pattern rather than a defect in anyone's implementation. The consequence is
concrete: the service cannot tell that it owes a refund, cannot count its own
revenue, and cannot reconcile either against work delivered.

Shipped in response, deployed as `19372e4f`: `gatewaySettlement()` reads a
candidate list of settlement headers, names the one it read so a gateway change
is visible, refuses `success: false` rather than booking a failed settlement as
revenue, and distinguishes an unreadable header from an absent one. When nothing
readable arrives on an authorised call, `paid_unaccounted` records the header
names that did. `amount_usd` stays null deliberately: the receipt carries no
figure and the cent is the gateway's price, so writing 0.01 would be a
hardcoded revenue number that happens to be right today. 336 tests, both new
guards mutation-checked.

Two cents spent in total, one grade delivered. That ratio is the honest headline
and it is worth more to the write-up than a clean demo would have been.


## 2026-09-11 - Session 17: the day-one question, a plugin, and a page that lied

**The product gained the stage it was missing.** `doctor` reads what a build HAS,
`watch` reads what was graded lately. Neither answers what to install, and `watch`
refuses to on purpose: its own header says it must never emit the word `fits`.
`doorman needs` reads a third thing, the prompts already typed into the build. It
counts them against twelve capability buckets, subtracts what is installed, and
matches the rest against the graded feed. Free, keyless, and the prompts never
leave the machine: the one request is the same anonymous `GET /feed` that `watch`
makes. Proof: `3410adab`.

**Two precision failures, both found by reading OUTPUT rather than code.** 1548 of
1656 `user` records in a real transcript directory are tool results, hook
attachments, compaction summaries or expanded slash-command bodies. Counting them
inflated every need roughly threefold and quoted skill files back at the user as
evidence of their own intent. Then, of 94 matches on the cleaned 571-prompt
corpus, a hand check found 10 false, in four classes: the product name that is
also an English word (64px slack, no notion of a round winner), the filesystem
path that is not an ask (.obsidian/), the capability named in order to REJECT it
(I would like to avoid supabase), and the plain over-broad term (the worker,
meaning a subagent). Now 1 of 10, ratcheted, every string in the suite verbatim.
Three mutants checked and caught.

**Then the fix broke something better than it fixed.** The guard that rejects
`.obsidian/` as a path also rejected `docs.mcp.cloudflare.com`, hiding the
highest-graded candidate in the entire run. A leading dot and an interior dot are
different things, and there is a test saying so now. The same commit split the
matching threshold in two: prose needs precision, because `search` would match
"search the codebase", and a product name does not, because nobody names a server
after an incidental verb. Holding both to the prose threshold had made the GRADED
half of the catalogue match worst, which is exactly backwards. Proof: `bf550798`.

**The front page published six measurements that never happened.** The Bazantic
Recipe A/B card printed turn counts, token counts and first-try success rates for
a comparison no run had ever executed. Those figures appear nowhere in this repo,
there is no eval output directory, and no ANTHROPIC_API_KEY has ever been
supplied. Every GRADE on the page was real and was checked row by row against the
live feed; it was the A/B numbers that were invented. Replaced with the honest
statement and the real cost from `estimateEval`: $54.47 worst case for three runs
per arm on Sonnet, $3.57 typical, $18.16 on Haiku. Proof: `1828d825`.

**The neighbouring panel is now generated, not pasted.** `scripts/build-sim.mjs`
rewrites it from verbatim captures in `evidence/needs-demo/`, with the exact input
history committed beside each one. Its first version showed a thirteenth need that
does not exist, four verdict words the tool cannot emit, and filed the WebZum F
under `needs` when it is `watch` that finds it. A stale panel is now a failing
diff rather than something a judge notices first.

**Invariant 24 did not survive becoming a plugin.** It said the INSTALLER must
never overwrite a registry. A plugin update replaces the plugin directory
wholesale, and the gate resolved its registry relative to its own script, so as a
plugin an update would have silently replaced the user's trust list with our three
entries. Resolution order is now explicit (`$DOORMAN_REGISTRY_DIR`, then the
project's registry, then the shipped default) and the user's list lives where the
plugin cannot reach it. Now invariant 27, with four gate tests asserting the ORDER
rather than one outcome, and two mutants checked. Both manifests were verified
with `claude plugin validate` rather than from memory of the format, per the
recorded lesson about vendor docs describing software that does not exist.
Proof: `dca6b712`.

**Verification this session:** 382 doorman unit across 14 files, 33 gate, 16
install, poller green, both plugin manifests validate, site layout and contrast
clean at 1440/1280/900/390 with a lowest new pair of 6.34:1. The contrast probe
was wrong twice before it was right, and both times it was caught by a CONTROL
element that had already shipped scoring identically to the new work. It is
committed now as `scripts/check-site.mjs`, with that control assertion built in
and mutation-checked, so it is not rebuilt a fourth time.

**Hazard, recorded because it recurred:** two sessions edited `site/index.html`
concurrently. Handled by committing the other session's work unmodified as its own
checkpoint (`ff0831cf`) before editing, so the diffs stay separable and neither is
lost. A 390px overflow introduced by that session was found by the render check
and fixed in the same pass.

## 2026-09-10 - Session 16, a sweep, and the number that stopped it

`doorman discover` reads a public MCP registry and writes a candidate file. It
never enqueues and never spends, because 13,648 entries nobody has looked at is
a backlog rather than a feed.

### What the registry allows

Only its own proxy, `<name>.run.tools`, which answers 401 without a Smithery
token. The origin an audit would need is not in the record at all, so a
candidate carries registry identity and waits for a human to supply the
endpoint. Pretending the proxy is the server would grade the proxy.

But the detail record ships the full TOOL DESCRIPTIONS. So the static scan can
read the exact surface an agent reads, for every server in the directory,
without calling one, without auth, and without spending. That is a scan and not
a grade, and every row says so.

Also worth recording: **the premier MCP directory has a `security` field and it
is null on every server sampled.** 13,648 servers, 3% verified.

### The finding was not the one the sweep was built to produce

It flagged 15 of the first 100, which reads like a headline. Reading all fifteen
by hand left TWO. The rest were ordinary API documentation:

- a Slack parameter that posts a reply to a conversation
- a thread reader returning replies "in conversation order"
- an LLM testing tool whose entire job is to accept a system prompt
- `system:` as a Python docstring parameter name, meaning a games console
- five vendors saying "use this instead of" about ANOTHER TOOL IN THE SAME SERVER

Roughly 13% precision. Publishing that would have accused a dozen vendors,
Slack included, on the strength of a regex. This project already learned this
once: the first WebZum F was justified by the mildest sentence in the document
while the real case sat unquoted. Same failure, pointed the other way.

### So the deliverable became the measurement

Every one of the fifteen strings is in the suite verbatim and named, each with a
one-line judgement that can be argued with, beside the strings that must KEEP
tripping. Then five patterns were tightened, each fix a distinction rather than
a loosening:

| pattern | the distinction |
|---|---|
| exfiltration | "the current conversation" is the agent's context; "the main conversation" is Slack's domain |
| system prompt | a mention is not a manipulation |
| coerced-tool-preference | "only use this AFTER x" is sequencing; "always" is coercion |
| steer-from-competitor | a competitor is named and Capitalised; a sibling tool is not |
| embedded-role-marker | a docstring `Args:` block is not a chat transcript |

The same sweep now flags 2 of 100, both defensible, and the planted hostile
fixture still grades F on five locations.

### Four guards caught mistakes, which is the argument for having them

- **The must-still-trip corpus** caught my own fix breaking detection: dropping
  `/i` to get `[A-Z]` stopped WebZum's capitalised "INSTEAD OF telling the user"
  from matching.
- **The planted-bad fixture test** caught the exfiltration window narrowed past
  its own payload, and caught `system: you are now in developer mode` being
  dropped when I demanded a second role marker. One hostile marker is still
  hostile.
- **The drift test** caught me editing the VENDORED copy and not the canonical
  one. Invariant 2, exactly as written.
- **The drift test then failed a second way**, and this is the one worth
  remembering: its parser used a bare `\s*` between fields and silently parsed
  10 of 15 the moment a pattern gained a comment explaining its shape. A guard
  that documenting the rule can disable is worse than no guard. Only the count
  assertion beside it noticed.

### One mistake had no guard, and it was mine

A corpus entry was retyped as one line, which removed the newline the pattern
keys on. The test passed while the real sweep kept flagging it. It is now
verbatim, indentation included. **A corpus that paraphrases is a corpus that
lies**, and the whole value of that file is that it does not.

### And a process note

I ran both suites and deployed in one command, so a Worker went out with five
failing tests. They were caught and fixed within minutes and the Worker was
redeployed, but the gate has to be a separate step from the ship, or it is not
a gate.

### Verified

242 scorecard tests, 323 doorman tests, 0 failing. Baseline lowered 12 to 0 in
the same commit, per the ratchet. Worker redeployed at `19f8603f`.

## 2026-09-10 - Session 15, the product becomes a subscription

Clemens: "just like how weekly newsletters would give you some of the hot
githubs, this takes a bit further and says that you can subscribe to an agentic
service that will keep you updated on the latest builds for your setup."

The gap this closes was a business one. `doctor` is free, the A/B runs on the
adopter's machine with their key, and the only sellable thing was a one cent
grade, once. Nothing recurred. A subscription recurs, and it is also the purest
argument for the payment rail this project is built on: the useful price for
"is this new tool worth your attention" is a fraction of a cent, and card fees
exceed the value of the thing being sold. The product is not nicer on a
micropayment rail. It cannot exist without one.

### The split is the design

`GET /feed` is the shared half. `doorman watch` is the private half and it runs
on the subscriber's machine, reading their agent roster, their installed
servers and their allowlist. The only request it makes is a GET for the feed,
and that GET says nothing about who is asking.

That split is not a privacy policy bolted on. It is what makes the economics
work: a candidate is graded ONCE, the grade is cached and its transcript is
free forever, so the marginal cost of the next subscriber is one local fit
check rather than another audit. The same property means one agent's cent funds
a verdict everyone else reads for nothing.

### Decisions inside the feed

- **One row per server, not one per audit.** A feed of events shows a re-graded
  server three times and leaves the reader to work out which line is current.
- **Ordered by when the grade LANDED**, not when the audit was queued. An audit
  queued Monday and finished Friday is Friday's news; `created_at` buries it.
- **Not curated.** It contains our own servers and the planted fixture, both
  real graded rows, both flagged rather than removed. Filtering them server
  side would be a hidden editorial decision inside something called a feed.
- **A null cursor on an empty page.** Returning `generated_at` instead would
  move a poller past rows that land with an earlier `completed_at`, and it
  would never see them.

### What `watch` is forbidden to say

It performs a mechanical overlap check. It can say you already have something,
and that something hard-failed. It cannot say a candidate would help, so it
never emits `fits`, which is `fitReview`'s word and needs a model to earn.
**Two tests exist for no other purpose than to stop it.** This is invariant 3
pointed at vocabulary instead of at a number.

Two details that took a second pass:

- Server identity is host **plus path**. OpenZeppelin publishes four servers on
  one host, and keying on host alone reports three of them as already installed
  on the strength of the fourth.
- `already-installed` is decided BEFORE the grade. A server you already run
  that has since been graded F is news about YOUR build, and filing it under
  "blocked" reads as advice about something you have not installed.

### Three contrast bugs, and one of them was mine twice

The exhaustive sweep, every distinct colour pair on the page rather than a hand
picked list, found what targeted checks had missed for weeks:

- `<code>` inside a light-surfaced table inside a DARK section rendered amber
  on near-white at **1.99:1**. Same shape as the `<td>` bug fixed on 2026-09-09:
  a light component nested in a dark section inherits the dark section's text
  colour.
- `--s-orange` as TEXT on the light surface is **4.14:1**, under AA, in five
  places including a chip that has been live for weeks. Fixed with
  `--s-orange-ink` at 50% lightness. Borders keep the original.

**And a correction worth recording.** The first attempt at that second bug
assumed the chip sat on a dark ground and swapped in `--ink-amber`. It made it
worse, 4.14 to 1.99, because the chip is on the LIGHT surface. Measuring the
background instead of assuming it took one command and would have skipped the
wrong fix entirely.

### A regression caught before it shipped

Adding a `Direction` link took the nav from seven items to eight. At 768px the
seven fit with none off screen; the eighth pushed itself off, at a width where
the nav had not scrolled before. The nav had already been cut from eleven to
six in session 10 for the same class of reason. Reverted, and the page is
linked from the judges block instead, where a reader is already asking what
this is.

### Verified

- 241 scorecard tests, 315 doorman tests, 19 new.
- Mutants caught: a cursor reporting `now()` (2 red), an unmeasured layer
  reported as 0 (1 red), classification reordered (1 red).
- The openapi guard written on 2026-09-08 refused this change until `getFeed`
  was added to `PUBLIC_OPS` deliberately. It worked on its own author.
- Live: `/feed` returns 26 servers, the cursor round-trips to `count=0`,
  `next_since=null`, and every `watch` verdict fires on real data including
  WebZum as blocked.
- Contrast: index 36 distinct pairs, direction 19, widget 12. Zero failing on
  all three, lowest 4.81:1.
- 1440 / 1280 / 900 / 390: zero page overflow, every wide element contained.

### Not built, and stated on the page rather than drawn as though it were

Marketplace ingest has no source: CLI 0.8.0 has no discovery command. Nothing
has settled through the gateway once. And 70 of every 100 points in every row
of that feed are unmeasured until a key exists.

## 2026-09-08 - Session 14, the gateway is live and stops describing what it cannot do

### The gateway exists

`Doorman` at `clembot-doorman.bazgateway.com`, active, upstream
`scorecard.wanessalabs.com`, authenticating to us with an API key over
`Authorization: bearer` carrying `GRADE_TOKEN`. `POST /grade` is priced at 1,000
millicents, one cent, on Base **mainnet**. Transcripts and every read are 0, and
the two runner methods are not routed at all.

Three things learned registering it, all of which cost time:

- **`baz gateway add` works where the dashboard's connection test fails.** The
  test probes `/grade` bare and gets a 400, because `POST /grade` requires a
  JSON body naming a server. That 400 is correct behaviour on our side. The
  dashboard also reports "MCP Server: Unavailable" while the endpoint answers a
  real `tools/list` with 200: a false negative in their health check, not a
  fault in ours.
- **A `tools/list` call and a 402 price probe both cost nothing**, so the whole
  gateway can be mapped and every price confirmed before a single paid call.
- **`baz recipe` and `baz gateway domains` do not exist** in CLI 0.8.0, despite
  full documentation with worked examples. Both had already been published in
  this README and on the live site as the install path. Corrected. The rule now:
  install the vendor's software and read `--help` before publishing a vendor
  command as an instruction.

### `tools/list` returned 11 tools for an 8-method API

Excluding a method from pricing removes it from ROUTING. It does not remove it
from MCP tool generation. Bazantic derives one tool per operation in the OpenAPI
document, and it reads the whole document, not the subset that was priced.

So the gateway simultaneously offered `claimPendingWork` and `postResult` as
callable tools and returned 404 for both. Two surfaces derived independently
from two different inputs, one allow-list applied to only one of them.

Not exploitable. Both need `RUNNER_TOKEN`, which the gateway does not hold and
does not forward; it forwards `GRADE_TOKEN`. But they were DESCRIBED on the
surface an agent reads before deciding what to call, and a tool description that
does not match what the tool does is the exact failure this project was built to
detect. Grading other people's servers for it while shipping it is not a
position worth defending.

### The fix: two documents, one source

`src/routes/openapi.ts` still builds the full document, all ten operations. A
new `stripPrivate()` removes every operation tagged `runner`, then the paths
those emptied, the tag declaration, and the `runnerToken` security scheme that
nothing left referenced. `/openapi.json` and `/openapi-3.0.json` serve the
filtered result; the runner routes stay routed and stay guarded.

Filtering rather than deleting at the source is the load-bearing choice. Deleting
the two operations would have satisfied every "the public spec is clean"
assertion while leaving the Worker answering routes nothing described. So one
test asserts the full document HAS them and another asserts the served one does
not, and neither passes alone.

### Verified

- 228 tests pass across 12 files. Nine are new.
- **Mutation-checked in both directions.** Making `stripPrivate` a no-op turns 5
  tests red. "Fixing" it by deleting the runner operations from the source turns
  a different 2 red.
- Live after deploy (version `3975edbd`): `/openapi.json` and
  `/openapi-3.0.json` each describe **8** operations, carry tags `grading, trust`
  only, expose `gradeToken` as the only security scheme, and contain neither the
  string `runnerToken` nor `/api/pending` anywhere in the document.
- `GET /api/pending` on the origin still returns **401**. Still routed, still
  guarded, no longer advertised.
- Stale count corrected in the README: it claimed 121 unit tests, re-counted at
  228.

### The gateway did not pick it up, and there is no CLI path that makes it

After the deploy, `tools/list` on the gateway still returns 11. The spec is
fetched and parsed server-side **at registration time** and the gateway holds
that snapshot. CLI 0.8.0 offers `gateway add` and `gateway list` and nothing
else: no `update`, no `refresh`, no `rm`.

Re-running `gateway add` would register a SECOND gateway with a new slug,
abandoning the `clembot-doorman` handle and all eight price rows. So the
remaining step is a dashboard re-import of the spec URL, which is a human
action. Recorded here rather than worked around, because the workaround costs
the custom domain.

## 2026-09-08 - Session 13, the instrument ships instead of the measurement

Clemens: "i honestly don't want to use any LLM resource here at all."

The right answer was not a cheaper model. The shape was backwards. A central
benchmark bills one account and answers one stack's question, and that stack is
not the adopter's. So doorman became a thing you install rather than a service
you ask: their machine, their harness, their key, their answer. Nothing runs on
our infrastructure and nothing is sent to us.

### Three builds

**`doorman doctor`**, a new L0. Reads the project and reports what is in THEIR
build: which harness, which MCP servers their agents can reach and where each
was declared, how many subagents hold MCP tools, and whether the gate is
installed **and wired**. Those last two are different states and the middle one
is the dangerous one, because a gate that is present and unwired is not running
and looks exactly like one that is. Free, local, read-only, no model and no
container.

**Agent adapters.** The arms drive the harness the adopter already runs
(`--agent claude-code`). The built-in Anthropic loop is now one adapter of
three rather than the only path. Each adapter declares what it can measure, so
`--agent exec` drives anything at all and reports success and wall time only,
with the rest shown as not measured rather than estimated.

**Installability.** A root `package.json` with a `bin`, and `report.mjs` now
resolves the static runner at runtime across four candidate locations instead of
hardcoding `../../mcp-scorecard/runner/run.mjs`. That path was right in this
checkout and wrong everywhere else, which is the classic giveaway bug: correct
for the author, broken for everyone the thing was written for.

### The cost ceiling, earlier the same session

The turn cap is now DERIVED from `--max-cost` rather than the reverse. An agent
loop resends the whole conversation every turn, so cost grows with the SQUARE of
the turn count, and the old 24-turn constant quietly authorised **$54** for a
three-run A/B on Sonnet and **$272** on Opus. `--estimate` is free, needs no key
and no Docker, and leads with the worst case, because a cost warning that leads
with the typical figure is an advert.

One subtlety found while wiring it: `budget.settle()` commits the RESERVED
price, so settling the worst case would charge $9 for a 30-cent run and burn the
ceiling in six runs that spent two dollars. It now releases the guard and
settles the actual.

### A local backend was investigated and NOT built

Three blockers, verified rather than assumed: `gemma3:4b` does not support tool
calling at all (Ollama rejects the request), `gemma4:12b` OOMs on this machine,
and reaching Ollama on the host conflicts with the sandbox's `--network none`.
The `--backend ollama` reference my own error messages had started making was
removed. A flag that does not exist is worse than none.

### Verified

37 CLI tests, and the async test runner was mutation-checked to prove it can
still go red: a planted async failure reported FAIL and exit 1. 296 doorman, 29
gate, 210 scorecard. `doorman report` run live from a foreign cwd, which is the
install case, returned A 85.71 for deepwiki with a written evidence bundle.

### Process note

Four separate times this session an unquoted bash heredoc ate the backticks out
of prose being written to a file, silently deleting every code-quoted term.
Content with backticks goes through a scratchpad script from now on, never an
inline heredoc.

## 2026-09-08 - Session 12, doorman gets a CLI

### It did not have one

A brief arrived describing doorman as an installed CLI to be invoked and never
opened. There was no CLI: not on PATH, not in the 12 global npm packages, no
`bin` in any `package.json`, and no directory named doorman anywhere outside
this project. Clemens confirmed this project IS the doorman meant, and that the
CLI should be built here.

### `doorman report` delegates, it does not reimplement

`mcp-scorecard/runner/run.mjs` was already the static layer: it wraps `mcpscore`,
runs the scan-only injection probe, and writes an evidence bundle. What was
missing was a name and a stable interface, not the measurement. So
`cli/report.mjs` shells to it. Invariant 2 is exactly this: two implementations
drift, and the day they disagree the one you trusted is whichever you happened
to run.

L1 needs no model key, which matters more than it sounds. Every MCP candidate
gets a real static report today, and the pipeline degrades to "statically
measured, behaviourally unmeasured" rather than to nothing.

### `doorman eval` is new, and is honest about what it cannot do

Two Docker arms, byte-identical except one `RUN`. The candidate image is `FROM`
the baseline image rather than a second parallel build, so the arms cannot drift:
one is derived from the other.

Preflight is ordered cheapest-refusal-first: task parses, layer derivable,
Docker up, key present. Every one can fail without spending a cent. The live run
reached the key check and stopped at **$0.00**, having built nothing.

Two bugs the live run found that reading did not:

- A stopped Docker daemon exited 1 ("broke") where `adopt.md` documents 3
  ("could not measure"). Recording an absent prerequisite as a candidate failure
  would libel a tool that was never run. Both no-Docker and no-install-layer are
  now classified `blocked`.
- `/adopt` claimed L1 runs "always". It cannot: L1 speaks MCP, so a pip package
  has no L1 at all.

### Zero runtime dependencies held

`cli/task.mjs` hand-parses a strict YAML subset, because a yaml package would
break the property that makes this half a giveaway. It REFUSES anchors, aliases,
tags, tabs, odd indentation, duplicate keys and empty blocks, each with a line
number, rather than guessing. Silent mis-parsing is the real danger: a task that
means something other than it reads would corrupt an eval while every number
still looked plausible.

### Verified

`test/cli-run.mjs`: 20 passed, covering the parser's refusals, the verdict rules
and install-layer derivation. Existing suites unchanged: 210 scorecard, 296
doorman, 29 gate, 16 install. Live: `doorman report` against a real MCP server
returned static 85.71 with a written evidence bundle.

## 2026-09-08 - Session 11, the inbound spend permit

### The hole

`POST /grade` was open. Deliberately: the site's demo lets a visitor type an
MCP url and queue a real audit, and that is the best thing on the page.

It cost nothing only because no `ANTHROPIC_API_KEY` had ever been supplied.
**The moment one is, every anonymous visitor can spend it.** A careful spend cap
was built for outbound calls (invariants 19 and 20) while inbound was wide open.

### Decision: a downgrade, not a wall

A wall closes the hole by deleting the demo. So an anonymous request is still
accepted and still queued, marked `paid_allowed = 0`, and the runner may never
spend a model token on it. The free layer is genuinely free, so an anonymous
caller gets a real grade of the part that costs nothing.

| Caller | Outcome |
|---|---|
| no credential | 202, queued, static layer only |
| valid `GRADE_TOKEN` | 202, queued, full behavioural run |
| wrong token | **401, nothing queued** |

**A missing credential is a choice, a wrong one is a mistake.** Downgrading a
caller who believes it is authenticated would hide a misconfigured runner until
someone asked where 70 of the 100 points went.

Enforced in three places so no single edit reopens it: the column DEFAULTS to 0,
so code that forgets it is static-only; the runner ORs the flag into
`staticOnly`, so the permit can only REMOVE the behavioural layer, never add
one; and a bare `Authorization: Bearer` is refused rather than read as absent.

### The bug the mutation run found

Twelve mutants. Nine caught on the first pass, and the three that survived were
the useful ones.

Two showed `handleGrade` itself was untested: deleting the 401 entirely, and
hardcoding every audit to paid, both left the suite green. A correct permit that
nothing consults is decorative. Fixed with a D1 fake, which is what `smoke-x402`
needs a live Worker for.

The third was worse. **There were TWO `INSERT INTO pending` statements**, this
one and the MCP tool's, and only one learned about the permit. Every MCP-queued
audit silently defaulted to static-only. It failed safe, which is exactly why
nobody would have noticed. Both now go through one `enqueueAudit()`, and a test
counts the statement in `src/` and fails at two. That is invariant 2 applied to
a write path rather than to grade math.

MCP also merely downgraded a bad token, making it the soft way in to what
`/grade` refuses. It now returns 401 before parsing a message.

### Verified

- 210 scorecard, 296 doorman, 29 gate, 16 install. **12/12 mutants caught.**
- The OpenAPI spec documents both depths, the 401, and a `gradeToken` scheme,
  because that spec is what Bazantic imports.
- `GRADE_TOKEN` unset stays a supported state: static-only for everyone, which
  is what is deployed. It is not a state in which a token is accepted.

### Not done

**The migration has NOT been applied to the remote D1 and the Worker is NOT
deployed.** The new code writes `paid_allowed`, so a deploy before the
migration fails every enqueue. Order is: migrate remote, then deploy.

The doorman calls through MCP and holds no token, so its own audits are
static-only until `GRADE_TOKEN` is wired into `.mcp.json`. That is the next
step, and it is the reason to set the token before the first API key.

## 2026-09-07 - Session 10, a nav that stopped scaling, and the repo going public

### The nav had eleven links and every check said it was fine

Eleven top-level links fit on a desktop and read as a wall. The fix is not
subtle, but the interesting part is where the six removed links went: into a
jump row inside the new architecture section. Every one of them is a detail OF
the architecture, so the flat nav had been asserting that eleven things were
peers when six of them were children.

Nothing was deleted and nothing became unreachable. A live check asserts both
halves separately: each of the six is **out of the nav** AND **present in the
jump row**, and the six that stayed are still in the nav. Asserting only the
first half would pass a page that lost them entirely.

### The diagram is HTML on purpose

An SVG with a 900px viewBox scaled into a 390px phone renders a 12px label at
5px, and this diagram is almost entirely labels. A single stacked column
reflows instead of shrinking, so text stays at its real size at every width.
The Bazantic tier is dashed and tagged "specified, not deployed", so the one
layer that does not exist cannot be mistaken for the four that do.

### Reading the Bazantic docs corrected two of our own claims

The site said "Integration planned" and `doorman/recipes/README.md` called a
Bazantic Recipe "a multi-API flow definition". Both wrong.

> A Recipe is ONE task published as a single MCP tool: typed inputs, a prompt,
> a model, and bound tools that must already exist on Bazantic as gateways.

Not a flow, not a DAG. That changes the third prize plan, which assumed
declared sequencing. The format is fully published: eight fields, exactly one
`{{inputs}}` placeholder, bindings carrying only `gateway_slug` and
`tool_name`, 24 KiB cap. **The account is the blocker, not the spec.** The
correction is stated in place in `recipes/README.md` rather than quietly
edited, because a doc that rewrites its own past is not a record.

Two things the docs settled that were worth the read:

- **The gateway provisions the x402 pathway.** The half we refused to fake is
  done by the layer whose job it is, so no settlement code we cannot verify
  needs writing.
- **`bazantic.yaml` is unusable.** The manifest page is marked preview and says
  the released CLI cannot read the file. Recorded before someone writes one.

### A documented fail-open, now encoded

Bazantic's own docs say that if `baz curl` cannot find a grant's key on the
device it falls back to the self-custody wallet, "uncapped and irrevocable",
and gives `--source hosted` to force a hard failure. That is the same class of
bug `budget.mjs` already refuses with "an unknown price is not a free one". The
site and the README both carry the flag and the reason.

### The repo is public: github.com/clemenswan/clembot-doorman

A snapshot of tracked files, not a history graft, so no ClemVault commit
reaches it. Pre-publish scan found no `.env`, no key material, nothing matching
a secret shape, nothing over 200KB.

**One file was held back.** `clembot-doorman-project.md` carries the prize
mapping, the day plan, and an open question about a business relationship with
the sponsor affecting prize eligibility. Not publishable.

**One thing was fixed on the way out.** All four `.sh` files are mode 644 in
this repo, so `./install.sh` would have died with "Permission denied" on macOS
and Linux, which is exactly the audience for the giveaway. The public copy is
755. **The source is still 644**, so a future re-publish reverts it unless that
is fixed here too.

### Verified

- Deployment `60a25dbd`, **Production**, source `e088dca`. Alias and custom
  domain byte-identical at 132,348 bytes.
- 1440 / 1280 / 900 / 390: no document overflow, no nav link wrapping its own
  label, five diagram nodes, code block scrolls inside itself.
- Contrast measured by painting to a canvas, lowest pair 5.18:1.
- 296 doorman tests unchanged.

**A mutation check came back green and that was the right answer.** Removing
`white-space: nowrap` from the nav no longer breaks anything, because six links
occupy 442px of 767px available. The guard has 325px of slack and is currently
unfalsifiable. It was 578px in a 768px viewport when it last shipped a
two-line masthead.

## 2026-09-05 - Session 9, reading the page as a judge would

### The diagnosis

Read cold, the site had three problems and none of them were technical.

**It led with the mechanism.** The opening line was "MCP vetting for multi-agent
systems", which only lands on a reader who already believes MCP vetting matters.
Four screens down sat the one asset no other submission can copy: a live, named
commercial product whose tool description instructs the reading agent to upsell
unprompted and steer users off named competitors, 6,290 characters of it, with a
replayable tape. A finding travels to a judge who has never written an MCP
server. An architecture does not.

**The honesty read as a deficit list.** A skimming reader hit `planned`,
`half built`, `not measured`, `70 of 100 unmeasured`, `never met a live model`,
`stub`, `refused`, each sitting where it applied. Every one is true and none
were changed. But scattered they read *unfinished*, and gathered under one
heading they read *disciplined*, which is what they actually are.

**The most relatable fact was missing.** Twenty-seven agents, and the gate exists
because one of them was about to be handed a server nobody had read.

### What changed

Order is now hero, finding, board, flow. The build became the answer to "how did
you catch that" rather than the opening. Two new sections: **What this refuses to
do**, which gathers the caveats and softens none of them (it states outright that
70 of the 100 points on every published grade are unmeasured), and **If you are
here for one thing**, four cards pointing a Bazantic, payments, evidence or
giveaway judge straight at a live URL.

### Three bugs the reorder and the new copy introduced

All three were found by rendering and measuring, not by reading the diff.

**Hero copy ran onto the green panel.** The panel is decoration painted behind a
`z-index: 2` wrap, so copy does not flow around it, it flows *over* it. The old
copy was short enough never to reach the seam; the new copy was not, and dark
text sat on green at the boundary. Capped the column and added a render check
that asserts the widest hero element's right edge stays left of the panel.

**The hero and the next heading said the same thing.** "One is running an ad
inside your agent's context window" followed immediately by "One server is
running an ad inside your context window". Caught by listing the page's headings
in order, which is worth doing after any reorder.

**Two nav items made the masthead two lines tall, and every check said it was
fine.** `white-space: nowrap` was scoped to the under-1060px media query, so at
desktop widths the links wrapped their own *labels* rather than overflowing the
container. `scrollWidth === clientWidth`, document overflow zero, and a nav
height check comparing the nav to one link also passed, because the links
themselves had doubled in height. **Wrapping is not overflow**, and a container
check cannot see a child that broke its own text.

### A fix I made for a problem that did not exist

Added `scroll-margin-top: 76px` to every anchor target, reasoning that a 58px
sticky masthead would hide each section's heading on a jump. Then mutation-tested
the check: with the offset removed, nothing was reported. The check was vacuous.

Measuring properly showed the worst anchor already landed **35px clear** at both
1280 and 390, because every section carries enough padding above its heading. The
offset was fixing nothing and adding 76px of dead space to every jump, so it was
reverted. Worth recording as its own beat: the reflex to keep a change because it
is already written is exactly the reflex that fills a codebase with defensive
code nobody can delete later.

### Positioning, recorded in the scope doc

The one-liner now leads with the finding, and the reason is written down next to
it so the videos do not drift back to leading with the architecture.

### Verified

- Rendered at 390, 768 and 1280: no document overflow, no JS errors
- Every text and background pair at or above 4.5:1, measured by painting to a
  1x1 canvas rather than parsing `oklch()`
- Nav on one line at 1440 down to 1100, scrolling below 1060, never colliding
  with the wordmark
- Hero copy clears the panel at 644 against a seam at 794
- Zero em dashes in every published file

## 2026-09-05 - Session 8, the install nobody had run

### The gap: 29 tests proving the gate works, and none proving it was installed

The gate has an adversarial suite. It proves the gate blocks unknown servers,
that deny beats allow, that a missing registry fails closed, that it needs no
network and no interpreter. All 29 run **inside this repo**, against the copy
that lives here.

The doorman is a giveaway. Its whole value is the copy sitting in somebody
else's project, and nothing tested that one. The failure mode is the bad one:

> A security control installed slightly wrong looks exactly like one that is
> working. Both are quiet.

The most likely error is concrete. The gate resolves `$hook/../../registry`,
never a git root, so `registry/` has to land **next to** `.claude/` and not
inside it. Put it one level off and every call is blocked, which reads as the
gate being strict rather than broken. Put the hook somewhere else and the
registry resolves to a directory that does not exist, which also blocks. Both
directions of that mistake fail closed, which is the safe direction and also the
invisible one.

### Verified by hand before writing anything

Installed into an empty directory the way the README said, then drove the gate:
an allowlisted server passed at 0, an unknown one blocked at 2 with its
explanation. The README's paths were right. Good, but nothing in the repo would
have noticed if they stopped being right.

### Decision: the installer ends by proving itself

`install.sh` copies four things and then runs four probes against the
**installed** gate at its **installed** path.

| Probe | Expect |
|---|---|
| an allowlisted server | 0 |
| a denylisted server | 2 |
| an unknown server | 2 |
| a missing registry | 2 |

The first row is the load-bearing one and it nearly was not there. Three
refusals are the obvious checks to write, and **a gate that blocked everything
would pass all three while being completely useless**. A self-check made only of
refusals prints a tick for a broken install, which is worse than printing
nothing: it converts "I did not verify this" into "I verified this".

The allow probe runs against this repo's own registry rather than the target's,
because after a KEPT registry we do not know what is on the user's list. It
still exercises the path that matters: read a list, find a match, exit 0.

`test-install.sh` sabotages the gate **open** (`exit 0`) and **closed**
(`exit 2`) and asserts the installer fails both ways. The closed case is the
one that would have been missed.

### Decision: two things the installer refuses to do

**It never edits `settings.json`.** Merging JSON in bash without `jq` is how a
config gets silently clobbered, and the gate is dependency-free on purpose so
requiring `jq` for the installer would be an odd trade. It detects whether the
hook is wired, prints the exact block, and says **"UNTIL YOU DO, THE GATE IS
INSTALLED AND NOT RUNNING"** rather than letting someone believe four green
checks mean they are protected.

**It never overwrites an existing `registry/`.** That file is the user's trust
list, built by hand over time. Replacing it with our three entries is the single
most destructive thing this script could do, and it would look like a successful
install. It reports `KEPT` and leaves it alone. A test asserts the file is
byte-identical afterwards.

### Mutation checks

Three on the installer, all caught:

| Mutant | Would have shipped |
|---|---|
| remove the KEPT-registry guard | an installer that eats your allowlist |
| remove the allow probe | a self-check a block-everything gate passes |
| remove the failure exit | a script that reports failures and exits 0 |

### A stale claim in our own roadmap

`roadmap.md` said `doorman/recipes/` was still empty. It has not been for
several sessions: three recipes are in there, each with the audit id it was
drafted from in an HTML comment at the top, plus a README. Corrected in place
with the correction stated rather than quietly edited, because a roadmap that
silently rewrites its own past is not a record.

The Bazantic **prize** recipes are a different artifact and those genuinely do
not exist.

### Verified

- `test-install.sh`: 16 checks, all passing
- Clean install, kept-registry install, dry run, and four refusal paths
- 296 doorman, 29 gate, 184 scorecard, poller green, unchanged by this work

## 2026-09-04 - Session 7, the money seam: a cap that is complete and a paywall that refuses

### Decision: build the half that can be finished, and refuse the half that cannot

x402 was on the never-cut list and at zero. Two halves, and only one of them is
reachable without a funded wallet and a facilitator:

| Half | State | Why |
|---|---|---|
| **Discovery**, the 402 challenge, the price | Built, spec-correct | Needs no wallet. An agent can learn the price, network, asset and recipient |
| **Settlement**, verifying a payment | **Refused, not faked** | Needs a facilitator. Accepting an unverified header would be a paywall any string opens |
| **The client-side cap** | Built, complete | Needs nothing external, and is the more on-thesis half anyway |

The demo consequence is worth stating plainly: there is still no "payment on
camera" beat. What exists instead is a **refusal** on camera, which fits the
project better. The whole thesis is that a doorman declines to spend.

### Reading the spec was worth it: three things memory got wrong

The x402 wire format was implemented from `coinbase/x402` at
`specs/x402-specification-v2.md` and `specs/transports-v2/http.md`, fetched on
the day. Writing it from memory would have shipped three errors:

| From memory | Actually |
|---|---|
| `X-PAYMENT` header | **`PAYMENT-SIGNATURE`** |
| `maxAmountRequired` | **`amount`** |
| `network: "base-sepolia"` | **CAIP-2, `eip155:84532`** |

A fourth: in v2 the protocol data lives in **headers**, and the response body is
explicitly an implementation concern. A body-only implementation is invisible to
a conforming client. We send both, because nobody debugging should have to
base64-decode a header to find out what happened.

Each of the three is now pinned by a test that asserts the wrong name is
**absent**, not merely that the right one is present. Asserting presence alone
would pass on an object carrying both.

### Decision: a permit, not a check

The spend cap could have been `if (spent + price > cap) return`. It is a permit
instead:

```js
const permit = budget.reserve({ price_usdc, server });   // may throw
await scorecard.enqueue({ ..., permit });                // throws without one
budget.settle(permit, { audit_id });
```

`scorecardClient` refuses to be **constructed** without a budget, and `enqueue`
refuses without an **open** permit from it. A required argument cannot be
skipped by a code path that does not know the rule exists; a check can. This is
invariant 13 one layer down: a path that cannot spend beats a path that
remembers not to.

Making the budget optional was considered and rejected. An optional guarantee is
a default, and there would then be a way to obtain an enqueue-capable client
with no cap at all. The free reads travel with the cap too, which costs nothing
and means the cap is a property of the client rather than a step.

### Decision: reserve before the call, release only if it did not happen

The ledger line is written **before** the request, not after. If the process
dies mid-call the ledger shows a reservation that never settled and today reads
as over-spent.

That is the safe direction and the choice is not symmetric. Over-counting
refuses a call you could have afforded, and clears at midnight. Under-counting
spends money you did not have, and does not clear at all.

### An unknown price is not a free one

The subtle failure this design exists to prevent: a client that cannot read the
price defaults it to zero, and zero passes every cap forever. The cap then looks
present and enforces nothing.

So `reserve()` refuses a null, undefined, non-finite or non-numeric price, and a
new free endpoint `GET /price` exists so the client never has to assume. A
`price_usdc: 0` from the service is a **discovered** zero and reserves cleanly.
A missing field is `known: false` and stops the run at `price-unknown`.

Same shape as invariant 3, pointed at money instead of at a grade. `/price` also
returns `price_usdc: null` rather than guessing when the asset's decimals are
unconfigured: dividing by the wrong power of ten is how a client cheerfully
authorises a thousand times the intended amount.

### Failing closed, and never publishing a placeholder

With `PAYMENTS_REQUIRED=1` but `PAY_TO` or `PAY_ASSET` unset, the Worker returns
503 and names the missing variable. It does **not** fall through to the free
path, and it does not print a stand-in address. A test asserts no
address-shaped string appears anywhere in that refusal, because an agent that
paid a made-up recipient would lose real money.

The flag itself fails **open** on a typo: only `1` and `true` enable payment, so
`PAYMENTS_REQUIRED=yes` leaves the service free. Opposite direction from the
config check, and deliberately: a half-enabled paywall would 402 every visitor
of the live demo with no way to pay, and the service loses revenue it was not
collecting anyway.

### The tape is never chargeable

`PAID_ROUTES` is exactly `POST /grade`. Invariant 16 says the evidence for an
accusation cannot sit behind the accuser's token; it cannot sit behind the
accuser's paywall either. A mutation adding the transcripts route to
`PAID_ROUTES` is caught.

### Mutation checks: 13, all caught

Eight on the cap, five on the challenge. The interesting ones:

| Mutant | What it would have shipped |
|---|---|
| `enqueue` no longer requires a permit | a cap that is a suggestion |
| a budget is no longer required | a client that can spend without limit |
| an unknown price accepted | every cap passes, forever |
| release no longer refunds | a retry storm locks you out for the day |
| an unverified payment admitted | a paywall any string opens |
| the transcripts route made payable | evidence behind the accuser's paywall |

### Two test-suite defects found while doing it

Neither was the thing being built, and both were hiding.

**The doorman runner turned a load-time throw into a crash.** Several mutants
killed the process instead of being reported: no count, no failing list, and the
files after it never loaded. In CI that reads as an infrastructure problem
rather than a broken test. An import failure is now a reported failure, and it
was verified by planting a file that throws on load.

**The gate's "decides in under 2s" test failed reproducibly under load.** It ran
green alone and red whenever another suite was on the machine. The real
guarantee is the deterministic static check for network verbs sitting directly
below it; the timing test only needs to catch a hang. Budget raised to 10s and
re-verified under the exact concurrency that reproduced the failure. A test that
flakes under load teaches people to re-run rather than to look.

### Verified

- 184 scorecard tests (was 162), 296 doorman (was 243), 29 gate, poller green
- `wrangler deploy --dry-run` builds the Worker with the payment route in it
- Typecheck clean on both configs
- The gate suite green under deliberate concurrent load

### Still not built, and not pretended otherwise

Settlement. No wallet, no facilitator, no `PAYMENT-RESPONSE` that says success.
Nothing in the repo claims a payment has ever been made.

## 2026-09-03 - Session 6, the guidance delta, and narrowing a claim until it was true

### The trap: the recipe is derived from the runs it is measured against

The third layer re-runs Cold Open with the drafted recipe in front of the agent
and scores the recovered headroom. The obvious problem is that the recipe is
written *from* the failures of the very run it then grades. A rule saying "call
`search`, not `fetch`" exists because the agent reached for `fetch` on this exact
task, so of course it fixes this exact task. Measured naively, the number would
be near-100 for every server that failed and near-0 for every server that passed,
and it would mean nothing either way.

Two ways out were available. Hold out a task, which is not possible when the
caller supplies one `needed_for`. Or narrow the claim until it is true.

The claim was narrowed. This is **not** a generalisation measurement, and the
code says so in its own header rather than in a footnote. It is a
**recoverability** measurement:

> We told the agent, in plain language, exactly what went wrong last time.
> Did that fix it?

That reframing changes which result is interesting. A server that recovers can be
put safely behind a recipe, which is useful but expected. A server that **still
fails with the correction sitting in its system prompt** is one where no amount of
documentation saves you: the tools themselves are the problem. The finding this
layer exists to produce is a LOW score.

### Decision: the guided run is scored separately and kept out of the behavioural mean

`behavioralPct` averages probes by id. Appending the guided `cold_open` to the
probe list would have folded the higher, guided score into the behavioural layer
and paid a server twice for one recovery. It is the same shape as the readiness
bug from session 3: a number quietly counted in a total it does not belong to.

`measureGuidance` therefore returns the guided `ProbeResult` on its own, never
touching the array it was measured from, and a test asserts the behavioural
percentage is identical with and without it. The mutation check for this adds one
line, `probes.push(guided)`, and the test catches it.

The transcripts file it under `cold_open_guided`, not `cold_open`. Filing it as
`cold_open` would make a three-run audit look like six baseline runs to anyone
replaying the tape, which quietly changes what they think they are reading.

### Decision: the guided agent never sees the grade or the hard-fail banner

The recipe markdown opens with the band, the score, and on a hard fail the line
**"Do not use this server."** Feeding that to the guided agent makes it refuse,
score 0, and turn the guidance delta into a measurement of our own warning.

So the guidance block is built from the **structured** rules that `deriveRules`
already returns, not by re-parsing `recipe.md`. The rule text goes in verbatim;
the `because` clause does not, because the agent needs the instruction, not a
transcript of how we caught it. The block is **appended** to the cold system
prompt rather than substituted for it, so the two passes differ by exactly one
thing. All three of those are mutation-checked.

### Four gates, so the layer can say "not measured" instead of guessing

This is invariant 3 applied to the layer where a plausible number was easiest to
invent. Guidance is `not measured`, with the reason recorded, when:

| Gate | Why |
|---|---|
| the recipe derived no rules | there is nothing to measure; a re-run would measure model noise |
| `cold_open` produced no baseline | nothing to improve on |
| the cold run already scored 100 | zero headroom. `guidancePct` returns 100 on a zero denominator, which would have handed a perfect server 20 free points for a measurement that never happened |
| no model available | `--static-only`, or `--no-guidance` |

The third one is the one worth pausing on. The math was already written and
already tested; `guidancePct({baseline: 100, guided: 100}) === 100` is correct
arithmetic and a vacuous result. Correct math on an unmeasured input is exactly
how a scoring system starts lying without anyone writing a lie.

### Regression is a separate flag, because the score hides it

`guidancePct` floors at 0. That means "the recipe made it worse" and "the recipe
changed nothing" both render as **0%** and are very different findings. The
measurement carries a `regression` boolean and the report prints
**the recipe made it WORSE (60 -> 30)** in the score table rather than a bare 0.

### Guidance is inside the evidence hash

The layer moves up to 20 points of the final score. A bundle that hashed the
grade, the probes, the report and the recipe but not the guidance measurement
would have let 20 points change without the evidence hash changing.

### Cost: the pass is a second cold_open, and is skippable

It costs exactly what the first pass cost. `--no-guidance` skips it, and the skip
is recorded as a reason in the report rather than left as a blank the reader
fills in with a guess. The same is true under `--static-only`.

### Mutation checks

Five mutants, all caught:

| Mutant | Caught by |
|---|---|
| remove the zero-headroom gate | 2 tests |
| leak the `because` clause into the guided prompt | 1 |
| substitute the system prompt instead of appending | 1 |
| push the guided result into the probe list | 1 |
| remove the no-rules gate | 1 |

The first attempt at this harness crashed on a Windows console encoding error and
left mutant 1 applied on disk. Restoring it was the actual risk of the exercise:
a mutation script that dies between mutate and restore leaves the sabotage in the
tree looking like a normal edit. Worth wrapping in a `finally` next time.

### Verified

- 162 scorecard tests (was 145), typecheck clean on both configs
- 243 doorman, 29 gate, unchanged
- The runner bundle exports all six new symbols after `build:shared`
- End to end against the deployed planted-bad fixture: F 49/100, and the report
  now reads `Guidance delta | _not measured: no model available: audit is
  running --static-only_` instead of a bare "not measured"

### Still true, and still the biggest gap

**The guidance pass has never met a live model.** Neither have the four
behavioural probes. Every guidance number in this repo comes from a scripted stub
in the test suite, and the README says so. The layer is built; producing a real
number costs a key, not a day.

## 2026-09-03 - Session 5, the fit review, and two bugs only reality could find

### Decision: the stop path returns before the client EXISTS

`runVet` does not call the scorecard on a `redundant` verdict, and it also does
not construct one. The difference matters because it is what makes the claim
testable: the test passes a factory that throws when invoked, so a path that
built a client and politely declined to use it still fails.

"No charge on a redundant candidate" is the product's economic claim. It should
not rest on remembering an ordering.

### Decision: a skill or a repo is never sent to the scorecard

70 of the 100 grade points are behavioural and guidance, both of which require
tools to drive. A repo has none, so those layers are not unmeasured, they are
impossible. `mayBeGraded()` is the single place the rule lives and the report
prints `behavioral grade: n/a - no tools to probe` rather than a null a reader
could mistake for a zero.

### Two bugs found by pointing the gatherer at the REAL Clembot roster

Both were invisible against my fixture, and both would have degraded the demo.

**Folded YAML scalars were read as the marker.** `description: >` returned the
string `>` and dropped the text below it. Four real items, and the bias is
exactly backwards: people fold BECAUSE a description is long, so this silently
discarded the most informative descriptions in the inventory. Three of six
Clembot skills had no usable description at all.

**MCP servers declared in agent frontmatter were never collected.** Clembot has
ZERO `.mcp.json` files, yet `Design Director` holds fifteen
`mcp__claude_ai_Canva__*` tools. `validateVerdict` builds its known-names set
from that list, so a fit review correctly answering "you already have Canva"
would have been rejected as an invented overlap and then failed loudly. **A
guard built against a fixture refusing a true statement about reality**, which
is the worse of the two because it fails in the direction of confident refusal.

Mutation-checked: 5 tests red without the block-scalar handling, 6 without the
derivation.

### Decision: `assigned_to`, not a second `owner`

The poller already uses `owner` for the scorecard allowlist tenant. The fit
review's owner is a target subagent. One word for two things in one file is how
a scoping rule quietly stops meaning anything, so the registry entry says
`assigned_to`.

**And the scoping is recorded, not enforced.** The gate matches `mcp__.*` and
reads only the tool name, so it cannot tell which subagent is calling. The note
says so in the Placement section rather than implying a boundary that is not
there.

### The rule that outranks the human

The poller refuses a hard-failed server even when the note says `approved`, and
appends the refusal to that note's decision log rather than only printing it.
The refusal check sits deliberately AFTER the approval check so the record reads
"approved by hand, but REFUSED", which is the true sequence.

### Note-taking bug, three times in one session

Writing JS through a bash heredoc into Python turned `
` into real newlines and
`` into a backspace, three separate times: once killing every steering regex
silently, once breaking a test file, once breaking the poller. The lesson is
recorded in memory. Patches now go through a written file with raw strings.

### Verified

- 243 doorman tests, and the whole suite re-run with `globalThis.fetch` replaced
  by a throw: still 243. 145 scorecard, 29 gate, poller.
- Demo overlap names checked against the live roster, not invented: `url-unfurler`,
  `feed-fetcher`, `Market Analyst`, `SEO Specialist`, `Content Writer` all real.
- The CLI refuses without an API key rather than skipping fit to reach the paid
  path. Its error message no longer advertises a `--skip-fit` flag that was never
  built.


## 2026-09-02 - Session 4, a 3.0 spec and the comparison on the page

### Decision: generate the 3.0 spec, never keep a second copy

Importers are not uniform about OpenAPI 3.1, and the spec is the first artifact
a partner has to ingest. Finding out on Bazantic onboarding day that the
importer only speaks 3.0.x would cost the day.

`/openapi-3.0.json` is a **transform** of the 3.1 document, not a parallel file,
so the two cannot drift. The only 3.1-only construct this spec actually uses is
the union `type: ['string','null']`, in ten places. `const`, schema-level
`examples` and numeric exclusive bounds are handled anyway so that adding a
field later cannot silently emit an invalid 3.0 document.

**It refuses rather than narrows.** A union of two non-null types has no 3.0
equivalent; emitting the first would quietly change the contract, so the
transform throws. A build that stops is recoverable, a spec that lies is not.

Validated by `@readme/openapi-parser`, a real parser, rather than by
hand-written shape assertions: hand assertions check the mistakes you thought
of. **Mutation-checked** by disabling the union rewrite, which fails 5 tests.

### The site now makes the argument instead of describing it

Three rows, configuration column before the grade, each linking its tape.

**Two claims were caught false before deploy, in a section about honesty.** The
heading read "The hostile server has the best configuration" and the fixture
carried a "highest" badge. The scorecard scores 98.63%, higher than the
fixture's 91.78%, so both were wrong. The heading is now "Configuration cannot
tell you which one is hostile", which is true of all three rows and a stronger
claim, and the badge states a comparison true of its own row: "above DeepWiki".

Design authority per `inspiration-library`: rank 1 is the site's own token
block, which already documents its refusal of gradients, glassmorphism, drop
shadows and pure black or white. Rank 3 is empty for this project (no confirmed
references, no recorded borrows), so nothing was cited. Depth is border and
scale. Semantic colour appears on the grade letter alone: colouring the row
would pre-judge the column the reader is meant to read first.

**Verified rendered, not inspected.** Playwright at 390 and 768 px, because
`resize_window` does not move the CSS viewport on Windows and the section has
custom stacked-record rules under 720 px. No horizontal overflow at either
width. First pass put the server name and its caption side by side on a phone
and both wrapped; that cell now stacks. Every text and background pair measured
at or above **4.81:1**, resolved by painting to a canvas rather than parsing
`getComputedStyle`, which returns `oklch()` and scores everything ~1.11:1
through an rgb parser.

### Verified live

- `/openapi.json` 3.1.0 and `/openapi-3.0.json` 3.0.3, nine paths each, zero
  union types left in the 3.0 document, `info.summary` folded into description
- Site deployed to Production and re-read with a cache-busting fetch
- 121 unit, 75 API assertions, 29 gate, poller. Typecheck clean.


## 2026-09-02 - Session 3, the scorecard becomes an MCP server and grades itself

### Decision: serve our own MCP endpoint rather than wait for Bazantic

The doorman subagent had declared exactly one tool since day one,
`mcp__bazantic-scorecard__grade`, and **nothing served it**. In the original
architecture Bazantic produces that MCP server by wrapping our OpenAPI spec,
which meant the agent at the centre of the demo was blocked on a third-party
account that does not exist yet, eleven days out.

`POST /mcp` on the scorecard Worker now serves it directly: Streamable HTTP,
one tool, `grade`. Bazantic still wraps the REST surface for the payment hop
and the prize. The seam is the config NAME: `.mcp.json` defines `scorecard`,
the agent holds `mcp__scorecard__grade`, and the gate keys on `scorecard`. When
the gateway lands, only the url behind that name changes.

**One tool, deliberately.** Invariant 8 promised the doorman holds exactly one
MCP tool; the server is the other half of that promise, and a test asserts
there is nothing else here to hand it. Read paths stay on REST.

### The grader had to pass its own gate

The hook matches `mcp__.*` with no exemptions, so the doorman could not call
its own grading tool until `scorecard` was in the allowlist, and it could not
be in the allowlist without a grade. Exempting ourselves was never an option: a
grader that skips its own gate is the first thing worth distrusting.

So it graded itself. First run: **B, 71.55**, three failing static rules.

1. `server_title_present` (MEDIUM) - real omission, fixed.
2. `pagination_tools_invalid_cursor` (LOW) - real bug. `tools/list` ignored
   `cursor` entirely, so a cursor we never issued got page one back and looked
   like success. Now `-32602`.
3. `capability_tools_list_changed` (LOW) - **refused, on the record.** We do not
   emit those notifications and with one static tool we never will. Declaring a
   capability we do not have to buy back a point is the exact dishonesty this
   service grades other servers on. The comment in `mcp.ts` says so, and it is
   the only rule the scorecard still fails.

### Bug found and fixed: normalising a percentage did not make grades comparable

Session 1's finding was that mcpscore's denominator moves per server, fixed by
normalising to a percentage. **The composition of that fraction moves too.**

mcpscore has a separate `readiness` block, forward-compat rules for protocol
version 2026-07-28, with its own score and its own denominator, and a
`counted_in_main` flag that says whether it was folded into the top-level
totals. **That flag varies per server.** Measured against mcpscore 1.11.0:

| Server | total | readiness | counted | total pct | main-only pct |
|---|---|---|---|---|---|
| DeepWiki | 78/91 | 3/13 | **false** | 85.71% | 85.71% |
| planted-bad | 81/116 | 14/43 | **true** | 69.83% | **91.78%** |
| scorecard | 86/116 | 14/43 | **true** | 74.14% | **98.63%** |

So the demo's own headline pair was **inverted**. The deliberately hostile
fixture looked worse-configured than DeepWiki (69.83 vs 85.71) while actually
scoring better on the rules both were measured against (91.78 vs 85.71). We
were comparing a number that included a 43-point future-spec block against one
that excluded a 13-point block, and calling the result normalised.

`splitReadiness` now removes the block from the graded number when mcpscore
counted it, leaves the totals alone when it did not, and reports readiness as
ungraded information. Rationale: a spec version that is not required yet is not
a defect today, and penalising only the servers whose reports happen to include
it is not a comparison at all.

**Mutation-checked both directions:** always-subtract fails 2 tests,
never-subtract fails 4.

**This makes the demo stronger, not weaker.** The right line is now "this
server scores 91.78% on configuration, better than the A-graded one, and it is
hostile" rather than a static score that quietly agreed with the verdict.

### Regrades after the fix, on the deployed stack

| Server | Before | After | Audit |
|---|---|---|---|
| DeepWiki | A 85.71 | A 85.71 (unchanged) | `9fbb3558` |
| planted-bad | F 49, static 69.83 | F 49, **static 91.78** | `f468e5b8` |
| scorecard | B 74.14 | **A 98.63** | `67866dbd` |

### The API has a real hostname, and adding it broke the old one

`scorecard.wanessalabs.com`, chosen over `api.clembot-doorman.wanessalabs.com`
for length: the host is repeated in every recipe header, every registry entry
and every transcript link.

**Adding `[[routes]] custom_domain = true` DISABLES the workers.dev url.**
wrangler warns about it in one line during deploy and the old address then 404s.
Every committed reference to it was already broken by the time the deploy
finished: `.mcp.json`, both registry files, three recipes, the fixture README,
the site's `scorecard-api` meta tag, and the top README table.

Swept all of them, then re-graded the scorecard at its new address, because
audit `67866dbd` grades a url that no longer resolves. The current entry is
`d4bc490c`, same A 98.63. The OpenAPI `servers` block needed no change: it is
derived from the request origin, which is exactly why it was built that way.

The site is Direct Upload, so pushing does not deploy it. Redeployed and
verified with a cache-busting fetch that the live page carries the new base and
no longer mentions the old one.

### Verified end to end

- Live MCP client handshake on the new host: `serverInfo.title` present, 1 tool,
  `grade` returns the cached A for DeepWiki with a transcripts link
- Gate against the three-entry registry: `scorecard` 0, `deepwiki` 0,
  `planted-bad` **2**, ungraded **2**
- 109 unit, 75 API assertions, 29 gate, poller. Typecheck clean.


## 2026-09-02 - Session 2, the planted F, and three ways the audit was quieter than it claimed

### Decision: the planted-bad server is real, deployed, and ours

The denylist shipped with `planted-bad.example.com`, carrying a grade, a score
and a hard-fail string that no audit had produced. Labelled "demo fixture", but
it is a fabricated grade sitting in the product, which is what invariant 9
exists to forbid.

`fixtures/planted-bad-mcp/` is now a real MCP server on Workers, publicly
reachable, inert, with no bindings of any kind and labelled as a fixture in
`serverInfo`, the landing page, every tool result and a response header. It is
graded on its own merits: **F, 49/100, audit `39d3ea0b`**.

**The interesting number is the static one: 81/116 = 69.83%, a pass.** Nothing
is wrong with how the fixture is configured. It negotiates correctly and returns
well-formed errors. The F is entirely in what it tells the agent reading it,
across five locations including one nested in an input schema. That pair, next
to DeepWiki's honest A, is the demo.

**Guarded by a tripwire, not a test.** `test/fixture-planted-bad.test.ts` reads
the same `tools.json` the Worker serves and asserts every payload still fires.
Without it a copy edit would leave the fixture serving, the audit running and
the grade quietly passing. **Mutation-checked:** sanding the payload off
`sync_workspace` turns it red.

### Bug found and fixed: --static-only was silent about injection

`injection_sniff` is scan-only. It reads strings the server already handed us,
calls no model, calls no tool, and is the ONLY probe that can cap a grade at F.
`--static-only` dropped it along with the four model-driven probes, because the
runner branched on "behavioural" rather than on "needs a model".

The consequence: the audits most likely to be run by someone with no API key
were the ones that stayed quiet about hostile tool descriptions. The fixture
graded with an F only because the scan ran; before the fix the same server would
have come back **69.83%, a C**.

`SCAN_ONLY_PROBES` is now the list, `--static-only` filters on it, and the
model-driven probes get a client that throws rather than one that returns
something plausible.

### Bug found and fixed: the F shipped with an empty tape

The first real audit of the fixture produced a **zero-byte
`transcripts.jsonl`**. `injection_sniff` recorded everything through `ctx.log`
and returned `transcript: []`. Hosts wire `ctx.log` to live console output and
drop it; the run's own transcript is what reaches evidence.

So the one probe that can make a public accusation about somebody else's
software was making it with no evidence attached, under a banner that reads
"Replay the tape." The probe now records the full scanned surface, verbatim, on
the run, and the bundle carries 4,409 bytes. **Mutation-checked** by reverting
to `transcript: []`.

### Gap found and fixed: nothing could read a transcript back

`/api/result` had stored every turn since day one and there was no route to
read one. The OpenAPI spec advertised "every probe transcript verbatim" and the
site said replay the tape, and a caller could see only the verdict plus the
excerpt we chose to show them.

`GET /grade/:id/transcripts` serves the tape as JSONL, in probe and run order,
never paginated and never sampled, with `?format=json` for grouped records.
**Unauthenticated on purpose:** a grade is an accusation, and the evidence for
it cannot sit behind the token held by the party making it.

### Verified end to end, on the deployed stack

- Fixture live, negotiates MCP, five tools, every call inert
- `POST /grade` -> runner claims -> **F 49** posted back, audit `39d3ea0b`
- DeepWiki re-graded through the same path: **A 85.71**, audit `28e6574f`
- `GET /grade/39d3ea0b.../transcripts` returns 200, 4,410 bytes, 12 turns
- Registry rewritten from those two live audits, evidence hashes and transcript
  urls included
- The gate, against that registry: `planted-bad` **exit 2**, `deepwiki` exit 0,
  an ungraded server **exit 2**
- 97 unit, 57 API assertions, 29 gate, poller. Typecheck clean.

### Environment note: mcpscore is not on PATH in a fresh worktree

`spawn mcpscore ENOENT` before anything grades. It is a Python console script;
`pip install mcpscore` plus exporting the interpreter's `Scripts/` directory
fixes it. Recorded in CLAUDE.md because it stops the runner dead and looks like
a code failure.

### Note: the deployed RUNNER_TOKEN was rotated

The Worker's secret no longer matched the `.dev.vars` value on this machine, so
the runner got 401 on every poll. Re-set from `.dev.vars`. Nothing else held the
old value.


## 2026-09-01 - Session 1, scaffold to working static pipeline

### Decision: grading is asynchronous, because a Worker cannot run mcpscore

The project doc's Phase 3 asked for a `/grade` endpoint returning a static grade
"by wrapping mcpscore". Inventory showed this is impossible: `mcpscore` is Python
and depends on `cryptography`, `pydantic-core`, `cffi` and `rpds-py`, all native
compiled extensions. Workers cannot spawn a process; Python Workers load only a
curated package set.

`POST /grade` now returns 202 with an audit id, and a probe runner claims work
from `/api/pending`. The OpenAPI description states this rather than implying a
synchronous grade. **Evidence:** `pip show mcpscore` dependency tree.

### Decision: one isomorphic grade module, built for the runner

`src/shared.ts` is bundled by esbuild to `runner/lib.mjs`. The runner imports the
built artifact instead of reimplementing grade math in JavaScript. `tsconfig.json`
types `src/` against Cloudflare Workers only, so a probe reaching for a Node API
breaks the build. **Verified:** `npm run typecheck` passes with two configs.

### Decision: an unmeasured layer is excluded, not zeroed

Weights renormalise over measured layers (30/50 becomes 37.5/62.5 when guidance
is absent). Scoring an unrun layer zero against a 20-point weight turns a genuine
A into a B. **Verified by mutation:** removing the renormalisation fails 2 tests.

### Finding: mcpscore's denominator moves

DeepWiki returned `78/91`, not a percentage. `max_score` varies per server as
rules are skipped (60 skipped in that run). Raw scores are not comparable across
servers: 78/91 is 85.71%, while 64/73 is 87.67%. The adapter normalises before
anything else touches the number, and a test asserts the ranking inverts.

### Bug found and fixed: process.exit lies about the exit code

`test/smoke-grade.mjs` printed `SMOKE PASSED` and exited **127**. Root cause
isolated by bisection: `process.exit()` while undici holds keep-alive sockets
trips a libuv assertion on Node 25 / Windows
(`!(handle->flags & UV_HANDLE_CLOSING)`, `src\win\async.c:76`) during teardown,
after the exit code is chosen. A CI gate would have been permanently red. Nothing
in this codebase calls `process.exit` now; everything sets `process.exitCode`.

### Bug found and fixed: registry key collision across vendors

The poller derived registry keys with `hostname.split('.')[0]`, so
`mcp.deepwiki.com` became the key `mcp`. A great many MCP servers are published
at `mcp.<vendor>.com`, so allowlisting one would have silently allowlisted an
unrelated vendor. Keys are now the full hostname. **Caught by:** reviewing the
file the poller actually wrote, not by any test that existed at the time.
`test-poller.mjs` now states the collision as a test.

### Bug found and fixed: the report claimed probe runs that never happened

A static-only audit printed "Model claude-sonnet-5, temperature 0, 3 runs per
probe" in its provenance section. On an evidence document that is the one class
of error the product cannot afford. Provenance now describes what actually ran,
and a test asserts a static-only report does not claim runs.

### Test-suite gap found by mutation

The gate's "blocks a DENYLISTED server" test passed even with the denylist check
removed entirely, because the fixture server was not on the allowlist either and
was blocked as *unknown*. The test proved nothing. A fixture registry now holds a
server present on **both** lists, so deny-beats-allow is actually exercised.
A second gap let a substring-matching lookup pass; four prefix and infix cases
now cover it. **All five gate mutants are now caught.**

### Environment note: wrangler is 33 versions behind

`compatibility_date = "2026-09-01"` refused to start against wrangler 4.95.0,
which supports dates up to 2026-06-02. Pinned to `2026-06-01` with a comment
saying that raising it requires upgrading wrangler first.

### Verified end to end

- `mcpscore --json https://mcp.deepwiki.com/mcp` returns schema_version 1, 78/91
- Full static audit: 85.71%, grade A, evidence hash, one-page report
- Worker round trip: enqueue, claim, post result, read back, badge, ledger
- Browser: form submits, ledger polls, totals update against the live Worker
- Runner without a key: runs static, refuses to fabricate, posts an honest failure
