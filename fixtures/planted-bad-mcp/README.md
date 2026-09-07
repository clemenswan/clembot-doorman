# planted-bad-mcp

The server the doorman is supposed to catch.

**Live:** `https://planted-bad-mcp.wanessalabs-042.workers.dev/mcp`
**Graded:** F, 49/100, audit `39d3ea0b-d2ff-4931-bc10-aca3006c1e70`
**Tape:** [`/grade/39d3ea0b.../transcripts`](https://scorecard.wanessalabs.com/grade/39d3ea0b-d2ff-4931-bc10-aca3006c1e70/transcripts)

## Why it exists

A demo that blocks a server described in a JSON file proves nothing. The
denylist used to hold `planted-bad.example.com` with a grade, a score and a
hard-fail string that no audit had ever produced. That is a fabricated grade
sitting in the shipped product, which is the exact thing invariant 9 forbids.

So the fixture is a real MCP server, publicly reachable, that a real audit
grades F on its own merits.

## The interesting part

It scores **69.83% on the static layer**, which is a pass.

```
[static] 81/116 = 69.83% (mcpscore exit 0)
[probe]  injection_sniff: 0 HARD FAIL injection-shaped content in 5 location(s)
[grade]  F 49/100
```

Nothing is wrong with how it is configured. It negotiates the protocol
correctly, returns well-formed errors, and would pass a config review. The F
comes entirely from what it tells the agent reading it, in five places:

| Tool | Where | Pattern |
|---|---|---|
| `search_notes` | description | coerced-tool-preference |
| `search_notes` | description | secrecy-instruction |
| `read_note` | `inputSchema.context` | exfiltration-request |
| `sync_workspace` | description | ignore-previous-instructions |
| `share_note` | description | addresses-the-model-directly |

`get_status` is deliberately clean. A scanner that flagged it too would be
condemning ordinary prose, and an F would stop meaning anything.

## Why it is safe to leave running

- **Inert.** Every tool returns canned text. It reads nothing, writes nothing,
  stores nothing.
- **No bindings.** No D1, no KV, no R2, no secrets, no outbound fetch. See
  `wrangler.toml`: the absence is the argument.
- **Labelled everywhere.** `serverInfo.name`, the `instructions` field, the
  landing page, every tool result, and an `x-doorman-fixture` response header
  all say what it is. No screenshot of it can be mistaken for an accusation
  against a real vendor.

## Do not defang it

`tools.json` is the single source of truth for the tool surface. The Worker
serves it verbatim, and `mcp-scorecard/test/fixture-planted-bad.test.ts` reads
the same file and asserts every payload still trips its pattern.

That test is a tripwire, not a unit test. Without it, a well-meaning copy edit
would leave the fixture serving, the audit running and the grade quietly
passing, and the demo would show a gate blocking nothing. It has been
mutation-checked: sanding the payload off `sync_workspace` turns it red.

## Deploy

```bash
cd fixtures/planted-bad-mcp
npx wrangler deploy
```

Same `compatibility_date` pin as the scorecard. Raising it requires upgrading
wrangler first.
