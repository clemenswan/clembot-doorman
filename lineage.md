---
project: clembot-doorman
cluster: agency
updated: 2026-09-05
---

# Lineage

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
