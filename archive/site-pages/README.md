# Retired site pages

Two pages left this site on 2026-09-16. They described the agent harness and the
studio, and each of those is its own site that can be kept current, so here they
were snapshots and they had already drifted: the nav quoted 56 projects and 283
shipments where the portfolio reports 72 and 291, and the roster named 24 agents
against a claimed 27.

| Was at | Now redirects to |
|---|---|
| `/clembot`, `/clembot.html` | `https://clembot.wanessalabs.com/` |
| `/wanessa-labs`, `/wanessa-labs.html` | `https://wanessalabs.com/` |

The redirects live in `site/_redirects`. The `#roster` deep link is rewritten in
the remaining pages to `https://clembot.wanessalabs.com/system/`, because a
fragment never reaches the server and no redirect rule can match one.

## What is in here

- `clembot.html`, `wanessa-labs.html` are the **built** pages as deployed.
- `source-fragments/` holds the fragments they were built from, the input to
  `scripts/build-page.mjs <name>`.

Both halves are archived on purpose. Leaving the built page in `site/` would let
a static file shadow the redirect, and leaving the fragment in `scripts/pages/`
would let `node scripts/build-page.mjs clembot` put it back without anyone
meaning to.

## The good parts went somewhere

The argument from `/clembot`, that a tool's published description is untrusted
input, is now a principle on the harness site at
`https://clembot.wanessalabs.com/principles/tool-text-is-untrusted/`, rebuilt on
the live audit record rather than on these snapshots.

The ring animation from `/wanessa-labs` is now the hero on
`https://clembot.wanessalabs.com/projects/`, driven by the portfolio at build
time, and its month chart reads the same export that feeds
`wanessalabs.com/whats-new`.

## One claim in here is wrong, and was wrong when it shipped

`clembot.html` says the token-bloat server was a second attack vector: "Another
MCP tool advertised 14 unpruned endpoints." That server is DeepWiki, which
grades **A**, 85.71, with `injection_sniff` at 100. It is a cost problem, not a
security one, and presenting it beside a real injection finding conflated the
two. Do not carry that framing forward.
