# recipes

Per-server usage recipes, drafted by the scorecard from audit evidence. Every
rule in one of these traces to an observed failure, which is why they are
generated and not hand-written: a hand-written recipe is an opinion, and this
project's whole claim is that opinions about MCP servers are the problem.

| File | Server | Grade | What the recipe says |
|---|---|---|---|
| `deepwiki.md` | `mcp.deepwiki.com/mcp` | A 85.71 | Usable as advertised |
| `scorecard.md` | this service | A 98.63 | Usable, async, poll for the grade |
| `planted-bad.md` | our fixture | F 49 | Do not use. The rules describe working around it, not making it safe. |

Regenerate any of them from the audit it cites. The header comment in each file
carries the audit id and the transcript url.

## These are not the three Bazantic prize recipes

Worth separating, because the project doc uses one word for both.

- **A usage recipe** (this directory) tells an agent how to use ONE graded
  server safely. It is an output of an audit.
- **A Bazantic Recipe** is one task published as a single MCP tool: typed
  inputs, a prompt, a model, and a bound set of tools that must already exist on
  Bazantic as gateways. It is the artifact two of the three prizes are judged on.

  **Correction, 2026-09-07.** This file previously called a Bazantic Recipe "a
  multi-API flow definition" and said the format was unconfirmed. Both were
  wrong. It is not a flow, and the format is published: eight fields, one
  `{{inputs}}` placeholder, bindings carrying only `gateway_slug` and
  `tool_name`. Stated rather than quietly edited, because a doc that rewrites
  its own past is not a record. The account is still the blocker, not the spec.
  Full detail in the root `README.md` under **Bazantic**.

The three canonical Bazantic platform prize recipes are published in
[`bazantic/recipes/`](../../bazantic/recipes/):
1. `01-vet-mcp-candidate.json` — Agentify an API ($500/300/200)
2. `02-deepwiki-pinned-researcher.json` — Help an Agent Use Your Project / Continuity (2×$500)
3. `03-governance-pipeline.json` — Best Multi-API Recipe ($500/300/200)

