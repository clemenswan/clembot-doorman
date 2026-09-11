# Bazantic Platform Recipes

Native JSON recipe definitions designed for the **Bazantic Platform** (`bazantic.com`), submitted for the **ETHOnline 2026** hackathon.

These files use Bazantic's exact 8-field Recipe definition format:
- `name`
- `description`
- `input_schema` (JSON Schema Draft 2020-12)
- `input_example`
- `output_example`
- `prompt_template` (containing exactly one `{{inputs}}` placeholder)
- `model` (`claude-3-5-sonnet-20241022`)
- `tool_bindings` (gateway tool bindings mapping to `gateway_slug` and `tool_name`)

---

## The Three Prize Recipes

| File | Recipe Name | Prize Track | What It Does |
|---|---|---|---|
| [`01-vet-mcp-candidate.json`](./recipes/01-vet-mcp-candidate.json) | `vet-mcp-candidate` | **Agentify an API** ($500/300/200) | Agentifies the `mcp-scorecard` service (`clembot-doorman.bazgateway.com`) into a reusable tool that any agent can call to audit untrusted candidate MCP servers before adoption. |
| [`02-deepwiki-pinned-researcher.json`](./recipes/02-deepwiki-pinned-researcher.json) | `deepwiki-pinned-researcher` | **Help an Agent Use Your Project (Continuity)** (2×$500) | Eliminates 3,400 tokens of raw MCP schema bloat by querying `clembot-doorman/getLatestGrade` for pinned verified parameters into a 420-token interface (-87.6%), eliminating trial-and-error hallucinations. |
| [`03-governance-pipeline.json`](./recipes/03-governance-pipeline.json) | `doorman-governance-pipeline` | **Best Multi-API Recipe** ($500/300/200) | Autonomous multi-gateway pipeline: Audits candidate tool safety → Settles $0.01 audit micropayment on Base mainnet via x402 → Registers verified SHA-256 hash to local allowlist. |

---

## Distinguishing Usage Recipes vs. Bazantic Platform Recipes

Worth clarifying, because the project uses the word "recipe" for two distinct layers:

1. **Usage Recipes** ([`doorman/recipes/*.md`](../doorman/recipes/)):
   - Markdown documents drafted automatically from an audit transcript (e.g., `deepwiki.md`, `planted-bad.md`).
   - They tell a client agent how to invoke a specific tool safely, avoiding observed failure modes.
2. **Bazantic Platform Recipes** (this directory, `bazantic/recipes/*.json`):
   - Native Bazantic platform artifacts.
   - Published as standalone tools on `bazantic.com` that combine typed inputs, prompts, models, and gateway tool bindings.

---

## Live Infrastructure

- **Hosted Gateway Endpoint**: `https://clembot-doorman.bazgateway.com/mcp`
- **OpenAPI 3.1 Specification**: `https://scorecard.wanessalabs.com/openapi.json`
- **Public Feed**: `https://scorecard.wanessalabs.com/feed`
- **Documentation & Verification**: [clembot-doorman.wanessalabs.com/bazantic.html](https://clembot-doorman.wanessalabs.com/bazantic.html)
