<img src="logo.png" alt="Clembot Doorman" width="150" align="right">

# Clembot Doorman

**Graded by being used, not by being read. Do not trust the letter. Replay the tape.**

Adding an MCP server to an agent is one line of JSON. After that line, a server
you have never audited describes its own tools to your agent, and your agent
reads those descriptions as instructions. There is no grade, no gate, and no
record of what you let in.

## What this is for

Doorman measures whether a candidate tool actually helps **your** agent, and
gives you a report about **your** build.

That emphasis is the whole design. A benchmark someone else ran tells you
whether a tool helped *their* agent. Whether it helps yours depends on your
harness, your model, your existing servers, and what your agents actually do.
Those differ enough that a central verdict is close to meaningless.

So this is a thing you install, not a service you ask:

- **It runs on your machine.** Two throwaway Docker sandboxes, identical except
  one install layer.
- **It drives the harness you already run.** Not a toy agent of ours.
- **It spends from your own account**, bounded by a ceiling you set, and the
  two cheapest layers spend nothing at all.
- **Nothing is sent to us.** There is no account here to create, no telemetry,
  and no server of ours in the path. We never see your results.

The verdict is yours, produced on your machine, from numbers we never receive.

## Three layers, cheapest first

| | Command | Needs | Answers |
|---|---|---|---|
| **L0** | `doorman doctor` | nothing | What is in my build? Which servers can my agents reach, and is the gate actually running? |
| **L1** | `doorman report <link>` | nothing | Is this server's implementation sound, and are its tool descriptions documentation or instructions? |
| **L3** | `doorman eval <link> --task <f>` | Docker + your agent's key | Does an agent get more done with this than without it, on my stack? |

**L0 and L1 need no model key and no Docker.** Most of what you want to know
about a server, including whether it is quietly telling your agent what to do,
costs nothing to find out.

## What is in this repo

| Path | What it is |
|---|---|
| `doorman/cli/` | The CLI: `doctor`, `report`, `eval`. Zero runtime dependencies. |
| `doorman/` | The gate you install: a PreToolUse hook that blocks ungraded MCP servers, a subagent that vets them, and a registry you own. |
| `mcp-scorecard/` | The grading service behind L1. Cloudflare Worker + D1 + a local probe runner. |
| `site/` | The explainer at clembot-doorman.wanessalabs.com. |
| `fixtures/planted-bad-mcp/` | A deliberately hostile MCP server, deployed, so the demo denies something real instead of a line in a JSON file. |

## What it will not do

Stated up front, because a measurement tool that oversells its own reach is the
exact failure it exists to catch.

- **It will not fabricate a number.** No key means the run stops and says so.
  An unmeasured layer is reported as unmeasured, never scored zero.
- **It will not reach ADOPT on one run per arm.** Agent runs vary, so a single
  sample cannot be told apart from luck. DECLINE stays reachable at any run
  count, which is what makes a cheap run worth doing.
- **It does not observe network egress yet.** The security clause that would
  auto-DECLINE a tool for undeclared network access has no input, so on today's
  runs it does not pass, it *does not run*, and every report says so in those
  words.
- **It cannot install everything.** A candidate must be expressible as one
  reproducible layer: npm, pip, or a git clone. Platform-class candidates are
  refused by name rather than approximated with an arm that installed nothing.

Built for ETHOnline 2026. Deadline Sunday 13 September 2026, 12:00 EDT.

## Install

**The answer depends on your stack, so run it on yours.** A central benchmark
tells you whether a tool helped somebody else's agent. Whether it helps yours
depends on your harness, your model, and what your agents actually do.

So this is a thing you install, not a service you ask. It runs on your machine,
drives the agent you already use, spends from your own account, and the report
is about your build. **Nothing runs on our infrastructure and nothing is sent to
us.** There is no account to create.

```bash
git clone https://github.com/clemenswan/clembot-doorman
npm i -g ./clembot-doorman
```

Node 20+. Zero runtime dependencies, deliberately: every dependency is one more
thing that can fail to install on your machine.

### The three layers, cheapest first

```bash
# L0. What is in YOUR build. Free, local, read-only.
#     No model, no container, no network.
doorman doctor

# L1. Grade a server by its implementation. Still no model key.
doorman report https://your-mcp-server.example/mcp

# L3. Does a candidate actually help YOUR agent? Two sandboxes, identical
#     except one install layer, driving the harness you already run.
doorman eval npm:some-candidate   --task evals/tasks/url-to-note.yaml --agent claude-code --max-cost 2
```

`doctor` and `report` need **no model key and no Docker**. Most of what you want
to know about a server, including whether its tool descriptions are giving your
agent orders rather than documenting it, costs nothing to find out.

### What `doorman doctor` tells you

Which harness the project is set up for, every MCP server your agents can reach
and where each was declared, how many subagents hold MCP tools, and whether the
gate is installed **and wired**. Those last two are different states, and the
dangerous one is the middle: a gate that is present but not wired is not
running, and looks exactly like one that is. Both are quiet.

### Your key, your machine

`--agent claude-code` drives the agent you already run. The credential your
harness already uses is passed straight into a local container. It is never
written to a file, never logged, and never leaves your machine except to the
provider you already pay.

An adapter that cannot measure something reports it as **not measured** rather
than estimating it. `--agent exec "<command>"` will drive any harness at all,
and reports success rate and wall time only, because a command doorman knows
nothing about cannot be asked how many turns it took.

### The bill is bounded before it starts

An agent loop resends the whole conversation every turn, so cost grows with the
**square** of the turn count. A 24-turn cap authorises far more than it looks
like: on Sonnet, three runs per arm is **$54 at worst**.

So `--max-cost` is the input and the turn cap is **derived from it**. A ceiling
of $2 is a ceiling of $2. Add `--estimate` to print the worst case and spend
nothing:

```bash
doorman eval npm:some-candidate --task <file> --max-cost 2 --estimate
```

It refuses rather than shaving: a ceiling too small for even a three-turn run
stops and shows the arithmetic. The permit ledger is the same one the doorman
uses on its own outbound spend.

Fewer than three runs per arm cannot reach ADOPT, because one sample cannot be
told apart from luck. DECLINE stays reachable at any run count, so a cheap run
is still worth doing: it can tell you a candidate is bad, just not that one is
good.

---

## Live

| Surface | URL |
|---|---|
| Explainer site | https://clembot-doorman.wanessalabs.com |
| Scorecard API | https://scorecard.wanessalabs.com |
| OpenAPI spec | https://scorecard.wanessalabs.com/openapi.json (3.1.0) |
| Same spec as 3.0.3 | https://scorecard.wanessalabs.com/openapi-3.0.json |
| Example badge | https://scorecard.wanessalabs.com/badge/https%3A%2F%2Fmcp.deepwiki.com%2Fmcp.svg |

Two real production audits, both queued through the API, claimed by a laptop
runner, graded, posted back:

| Server | Grade | Static layer | Audit | Tape |
|---|---|---|---|---|
| `mcp.deepwiki.com/mcp` | **A 85.71** | 85.71% | `9fbb3558` | [replay](https://scorecard.wanessalabs.com/grade/9fbb3558-8b6e-475b-9b6f-161b32bbb7a1/transcripts) |
| this service, graded by itself | **A 98.63** | 98.63% | `d4bc490c` | [replay](https://scorecard.wanessalabs.com/grade/d4bc490c-5e51-4fb7-be67-6ef6f5a0a0ea/transcripts) |
| our planted fixture | **F 49** | **91.78%** | `f468e5b8` | [replay](https://scorecard.wanessalabs.com/grade/f468e5b8-232a-43bb-9cb4-2ad680bab1ae/transcripts) |

**Read the static column twice.** The hostile server scores 91.78% on
configuration, higher than the A-graded one. It negotiates the protocol
correctly and would survive a config review. The F is entirely in what it tells
the agent reading it.

That is the whole argument, and it is why the planted server is a real deployed
server rather than a row in a denylist. It is also why the middle row is there:
the scorecard is itself an MCP server, it was graded by itself, and it had to
pass its own gate to be callable. Nothing here is exempt.

---

## The grade

Three layers, weighted 30 / 50 / 20, banded A at 85, B at 70, C at 50, F below.

**Static (30).** Wraps the `mcpscore` CLI. Protocol version, TLS, schema validity,
annotations, pagination. Its raw output has a *moving denominator*, because rules
get skipped per server, so it is normalised to a percentage before anything is
compared. A server scoring 78/91 is worse than one scoring 64/73, and only the
normalised number shows it.

**Behavioural (50).** A real agent, a pinned model, temperature 0, three runs per
probe. This is the half that reading cannot produce.

**Guidance delta (20).** The same cold task re-run with the drafted recipe in the
agent's system prompt. Scored as *recovered headroom*, not raw delta, so a server
that was already strong is not punished for having little room to improve.

The recipe is derived from the very runs it is then measured against, so this is
deliberately **not** a generalisation claim. It answers a narrower question, and
the narrow question is the useful one:

> We told the agent, in plain language, exactly what went wrong last time.
> Did that fix it?

A server that recovers can be put safely behind a recipe. A server that still
fails with the correction sitting in front of it is one where no amount of
documentation saves you, and that is the finding worth having. A **low** guidance
score is the interesting result; a high one is expected.

Four gates stop it reporting a number nobody can defend, and each has a mutation
check. It is `not measured` when the recipe derived no rules, when `cold_open`
never produced a baseline, when the cold run already scored 100 (zero headroom
would otherwise pay a perfect server twenty free points), and whenever the model
probes did not run. The guided run is scored **separately and kept out of the
behavioural mean**, or a server would be paid twice for one recovery. The guided
agent never sees the grade, the band, or the hard-fail banner: feed it
"Do not use this server" and the delta measures our own warning.

Two hard fails cap a grade at F regardless of everything else: injection-shaped
content in the advertised strings, and a transport that is not TLS.

### Three properties worth stating plainly

1. **An unmeasured layer is not a zero.** If the guidance delta did not run, its
   weight is removed and the other two renormalise to 37.5 / 62.5. Scoring it zero
   against a 20-point weight would drag every honest partial audit into a failing
   band. That is lying with arithmetic, and there is a test for it.

2. **A grade is relative to the model that produced it.** The model id is on the
   audit, in the report, and on the badge. Grades from different models are not
   comparable.

3. **A skipped probe is excluded, not failed.** Ambiguity only fires when tool
   descriptions overlap; Chain is skipped under three tools. A two-tool server is
   not worse for having nothing to chain.

---

## The six probes

| # | Probe | The question it answers |
|---|---|---|
| 1 | Handshake and inventory | Is there anything here at all? Dead servers exit free. |
| 2 | Cold open | Can an agent that has never seen this succeed on the first try? |
| 3 | Ambiguity gauntlet | Do two overlapping descriptions actually distinguish themselves? |
| 4 | Bad input recovery | Can an agent self-correct from this error message in two turns? |
| 5 | Chain test | Do these outputs compose, or only look like they should? |
| 6 | Injection sniff | Is this documentation, or is it giving my agent orders? |

Probe 4 grades the **error message**, not the agent. "Invalid input" and
"missing required `repoName` (string, e.g. `facebook/react`)" are the same failure
and completely different products.

Probe 6 is scan-only and never calls a tool. We do not execute a server to find
out whether it is hostile. Because a hit caps the grade at F, which is a public
accusation about somebody else's software, it is deliberately conservative and
every hit records the pattern plus the offending text verbatim.

It also needs no model, so it is the one probe that **runs without an API key**.
Dropping it alongside the model-driven probes under `--static-only` would have
made the cheapest audits the ones that stayed quiet about hostile tool
descriptions. The planted fixture grades C without it and F with it.

---

## Why the Worker does not grade anything

`mcpscore` is Python and pulls in `cryptography`, `pydantic-core` and `cffi`,
which are native compiled extensions. A Cloudflare Worker cannot spawn a process
and Python Workers only load a curated package set. **The Worker physically
cannot run the static layer.**

So `POST /grade` returns **202 and an audit id**, a probe runner on a real machine
claims the work, and posts the result back. The API says this in its own
description rather than pretending to be synchronous and timing out.

The grade math lives in one isomorphic module that both halves import. `src/` is
typechecked against Cloudflare Workers types only, so a probe that reaches for a
Node API fails the build. The runner imports the *built* version of that module
rather than reimplementing it, because two implementations would drift and a
laptop-produced grade would stop meaning the same thing as a Worker-produced one.

---

## The gate

`doorman/.claude/hooks/mcp-gate.sh` runs before every MCP tool call.

- **No network.** Not a curl, not a DNS lookup. A gate that asks a server for
  permission is offline the moment the network is, and offline would mean allow.
- **No dependencies.** Bash builtins and coreutils. No jq, no node, no python.
  A gate that fails to start is a gate that fails open.
- **Fails closed.** Unparseable input, missing registry, unknown server,
  unreadable file: all block.
- **Exit 2, never exit 1.** Only exit 2 blocks a call. Exit 1 is treated as a
  script error and the call proceeds. A test asserts the file contains no exit 1.
- **Humans own the list.** Nothing writes the allowlist automatically. The poller
  reports changes and refuses to allowlist a hard fail even when the service says
  to.

The `doorman` subagent holds `Read` and exactly one MCP tool. The agent that
decides what to trust does not also carry capabilities an untrusted server could
talk it into using.

---

## Running it

```bash
# The service
cd mcp-scorecard
npm install
npm run migrate:local
npx wrangler dev --port 8799 --local

# Grade a real server, static layer only, no API key needed
pip install mcpscore
node runner/run.mjs --once --server https://mcp.deepwiki.com/mcp \
  --needed-for "look up how a public repository works" \
  --static-only --out ../evidence/deepwiki

# Full behavioural run (needs a key)
export ANTHROPIC_API_KEY=...
node runner/run.mjs --once --server https://mcp.deepwiki.com/mcp \
  --needed-for "look up how a public repository works"

# Poll the queue
export RUNNER_TOKEN=... SCORECARD_API=http://127.0.0.1:8799
node runner/run.mjs --poll
```

```bash
# Tests
cd mcp-scorecard && npm test          # 121 unit tests
node test/smoke-grade.mjs             # grades a live public server
node test/smoke-api.mjs               # 75 assertions over the HTTP surface
cd ../doorman && bash test-gate.sh    # 29 adversarial gate tests
node test-poller.mjs                  # registry key derivation
```

---

## Status

Working and verified end to end **except the behavioural probes and the guidance
pass**, which have never been executed against a live model because no
`ANTHROPIC_API_KEY` has been supplied. Every guidance number in this repo comes
from a scripted stub in the test suite; none is a measurement of a real server. They are written, typechecked and unit-tested behind a mock-free
interface, and the runner refuses to fabricate results without a key: it marks
the audit failed and says why.

The chain those probes sit in is verified end to end against the deployed stack:
a hostile server published, graded F through the live queue, written into a
registry that cites the audit id and evidence hash, and blocked by the gate at
exit 2 while the A-graded server passes at exit 0.

## Replay the tape

Every turn behind every grade is public and needs no token:

```
GET /grade/{audit_id}/transcripts              # JSONL, one object per turn
GET /grade/{audit_id}/transcripts?format=json  # grouped by probe run
```

Never paginated, never sampled. A grade is an accusation, and the evidence for
one cannot sit behind the token held by the party making it. It does not sit
behind the paywall either: `POST /grade` is the only chargeable route, and a
test asserts the transcripts stay free with payment fully switched on.

## Money

Two halves, and only one of them is finished.

**The spend cap is complete.** The doorman refuses to spend twice: once on fit
(does this system need it at all) and once on budget (can it afford to find
out). The second refusal is a **permit**, not a check. `scorecardClient` will
not be constructed without a budget and `enqueue()` will not run without an open
permit from it, because a required argument cannot be forgotten by a code path
that does not know the rule exists.

```
  budget     0 spent today, 5 of 5 left. Per-run cap 1.
  FIT        FITS -> scheduler
  REFUSED    the spend cap said no. $0.00 spent.
```

An **unknown price is not a free one**. `GET /price` is free and
unauthenticated, `/vet` reads it rather than assuming, and a price that cannot
be read stops the run. A client that defaults an unknown price to zero passes
every cap it has, forever. A `price_usdc: 0` from the service is a *discovered*
zero and spends cleanly; a missing field is not.

**Settlement is refused rather than faked.** The x402 **v2** challenge is real
and was implemented from the published spec rather than from memory, which
caught three errors that would otherwise have shipped: the header is
`PAYMENT-SIGNATURE` not `X-PAYMENT`, the field is `amount` not
`maxAmountRequired`, and `network` is CAIP-2 rather than a name. But there is no
wallet and no facilitator wired to this Worker, so a request arriving with a
`PAYMENT-SIGNATURE` is **refused**, using the protocol's own failure channel. A
paywall that opens for any string is worse than no paywall, because it looks
like protection.

Switching payment on without a configured recipient fails **closed** with 503
and publishes no placeholder address. An agent that paid a made-up recipient
would lose real money.

---

## Bazantic

The layer that makes the scorecard callable by an agent and payable per call.
**None of this has been run.** There is no account yet, so everything below is
written from Bazantic's published spec and marked accordingly. Nothing in this
section is a claim that it works.

### What a Recipe actually is

Not a flow, not a pipeline, not a DAG. **One task: typed inputs, a prompt, a
model, and a bound set of MCP tools**, published as a single MCP tool that any
agent can call. Sequencing happens inside one prompt, so a Recipe is a model
given tools rather than a declared sequence of steps.

Ingredients have to already exist on Bazantic as gateways. A Recipe cannot
invent a tool. So the gateway comes first and the Recipe second, always.

### Install and use it

```bash
# 1. the CLI, once
npm i -g @bazantic/cli
baz login

# 2. register the scorecard. Its OpenAPI 3.1 spec is already served,
#    so there is nothing to write for this step.
API=https://scorecard.wanessalabs.com
baz gateway add --endpoint $API --spec-url $API/openapi.json \
  --name "MCP Scorecard" --status draft --json

# 3. a capped, revocable grant for the doorman to spend from.
baz grant create --name doorman --cap 5 --service <slug>
baz curl https://bazgateway.com/<slug>/grade \
  --account doorman --max-amount 0.05 --source hosted --json

# 4. publish the Recipe. Any agent then gets vetting as one MCP tool.
baz recipe create vet-mcp-server.json --json
baz recipe publish vet-mcp-server --json
baz recipe install --client claude-code
```

Read the gateway URL out of `baz gateway list --json` as `endpointUrl` rather
than assembling it by hand. More than one URL form is served and which one
applies depends on the deployment environment.

### `--source hosted` is not optional

Bazantic documents this and it is worth repeating, because it is the exact
failure mode this project exists to refuse:

> If the CLI cannot find a grant's key on this device it warns on stderr and
> falls back to your self-custody wallet for that call, which changes the call
> from capped and revocable to uncapped and irrevocable.

That is a fail-open on the spend path. It is disclosed, and there is a flag for
it, so the doorman always passes `--source hosted` and takes the hard failure.
The same reasoning as `budget.mjs` refusing an unreadable price: a cap that
silently stops applying is worse than no cap, because you stop watching.

`--max-amount` defaults to `0.01` and is checked before anything is signed.

### The Recipe file

`baz recipe create <file>` takes a JSON file with **exactly** these fields.
Unknown fields error before any network request.

| Field | Notes |
|---|---|
| `name` | The handle is derived from it and is immutable. |
| `description` | |
| `input_schema` | JSON. Dialect not stated in the docs. `[VERIFY]` |
| `input_example` | |
| `output_example` | `Use as output example` on a real test run fills this. |
| `prompt_template` | Exactly one `{{inputs}}` placeholder. 4000 chars max. |
| `model` | Allowed values come from `baz recipe --help`. `[VERIFY]` |
| `tool_bindings` | Each entry carries only `gateway_slug` and `tool_name`. 1 to 64. |

Whole definition caps at 24 KiB of compact UTF-8 JSON. An update file takes a
nonempty subset of the same fields. `create` produces a draft; `update` only
works on a draft; `delete` only works on a never-published draft.

### The async problem, stated rather than hidden

A Recipe run is one pass. A cold audit takes minutes, and `POST /grade` returns
202 with an audit id rather than a grade. So the Recipe must return one of:

- a cached grade, when a recent audit exists, which is instant, or
- an audit id and a transcripts url, saying plainly that grading is running.

It must not stall waiting, and it must not synthesise a provisional score. The
`grade` tool description already commits to this and the Recipe prompt inherits
it. Whether a Recipe run can poll across several tool calls inside its own
timeout is not documented. `[VERIFY]`

### A Recipe is itself an ungraded MCP surface

Worth stating because it is the most interesting thing here. A published Recipe
is one tool whose behaviour is a prompt the caller never reads and a tool set
the caller never sees. That is the same shape as the finding this project leads
with, one layer up.

Bazantic is also the first surface where it is fixable. `bazantic_recipe_get`
returns the definition, and `bazantic_gateway_list_tools` returns tool names,
descriptions, input schemas and annotations for a gateway. Our static layer is a
pure function over exactly those strings and never calls anything, so it can run
across a whole inventory before a single paid call.

### Not usable: `bazantic.yaml`

The gateway manifest page is marked preview and says the released CLI cannot
create a gateway from the file, calculate a plan, or apply one. Do not write one.
`baz gateway add` is the released path.

### Data note

Bazantic keeps the prompts, drafts and test inputs entered in the editor and
uses them to improve the product. That is a reason to keep the grading rubric
inside this service and let the Recipe prompt stay thin, which is better design
regardless.

---

See `roadmap.md` for what is done, what is stubbed, and what is untested.
