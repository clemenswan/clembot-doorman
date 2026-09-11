# needs-demo: real output for the site's recommender panel

Captured 2026-09-10 against the live feed (26 graded rows). Verbatim, not
edited, not trimmed. The two `history-*.jsonl` files are the exact input, so
anyone can reproduce a capture and diff it:

```bash
node doorman/cli/doorman.mjs needs <any-empty-dir> \
  --history evidence/needs-demo --candidates /dev/null
```

## Why this directory exists

The site has a panel that shows what `doorman needs` prints for three example
prompt histories. A panel like that can be written by hand, and a hand-written
one drifts from the tool the moment either changes. On a project whose entire
claim is "we publish what we measured", the front page printing output no run
ever produced would be the most expensive possible bug.

So the panel's text comes from here, and here comes from a real run.

| File | What it is |
|---|---|
| `fullstack.txt` | `doorman needs`, three prompts about Cloudflare, Supabase and GitHub pull requests |
| `research.txt` | `doorman needs`, three prompts about docs and web search |
| `watch-blocked.txt` | `doorman watch --all`, which is where the WebZum F appears |
| `history-*.jsonl` | The exact prompt history each capture read |

## Three things the first hand-written version got wrong

Worth recording, because each is a way this kind of panel goes wrong rather
than a one-off typo.

1. **A need that does not exist.** It showed a bucket called "Library
   documentation lookup" beside "Current documentation for a library it does
   not know". There are twelve needs and that is not one of them.

2. **Verdict words the tool cannot emit.** `BLOCKED`, `HOSTILE HIT`,
   `SAFE ALT` and `Gate Action` all appeared. `needs` emits exactly four:
   `worth-measuring`, `ungraded`, `blocked`, `already-installed`. Inventing a
   stronger-sounding word is how a measured verdict turns into marketing.

3. **The right finding under the wrong command.** The WebZum F is real, the
   tape is public, and `doorman watch` prints it as `BLOCKED (do not adopt)`
   with a link to the transcript. It is `watch` that finds it, not `needs`,
   because `needs` matches capability text and WebZum's feed row is a name and
   a url. `watch-blocked.txt` is the real thing.

**Every grade the hand-written version quoted was correct.** docs-ai-search
A 88.57, Astro Docs A 88.73, DeepWiki A 85.71, Exa 91.8, mcp-typescript on
Vercel A 85.14, WebZum F 49. Those were checked against `GET /feed` one by
one. The shape was wrong, the numbers were not.
