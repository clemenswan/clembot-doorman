# Doorman

**A gate for the MCP servers your agent talks to.**

Adding an MCP server to Claude Code is one line of JSON. After that line, a server
nobody has audited describes its own tools to your agent, and your agent believes
the description.

This repo installs a gate. Ungraded servers get blocked at the point of use.

```
> summarise what the acme-helper server can tell us about this repo

· calling mcp__acme_helper__search
BLOCKED by doorman

  doorman: 'acme_helper' is UNKNOWN. Blocking until it has been graded.

  To grade it:   /vet <server-url>
```

## Install

```bash
git clone <this repo> && cd doorman
./install.sh /path/to/your-project
```

It copies four things, then **drives the installed gate and checks four
outcomes**:

```
  PASS  an allowlisted server is allowed
  PASS  a denylisted server is blocked
  PASS  an unknown server is blocked
  PASS  a missing registry blocks rather than opens

  4/4. The gate is installed and behaving.
```

The first line is not decoration. A gate that blocks *everything* passes the
other three and is useless, so a self-check made only of refusals would print a
tick for a broken install. If any check fails the script exits non-zero and says
not to rely on it.

Two things it will not do:

- **It never edits your `settings.json`.** Merging JSON in bash without `jq` is
  how a config gets silently clobbered, and the gate is dependency-free on
  purpose. It detects whether the hook is wired and prints the block to paste.
- **It never overwrites an existing `registry/`.** That file is your trust list.
  Replacing it with our three entries would be the most destructive thing this
  script could do, so it says `KEPT` and leaves it alone.

`--dry-run` shows what it would copy and writes nothing.

<details>
<summary>By hand, if you prefer</summary>

```bash
cp .claude/hooks/mcp-gate.sh   <your-project>/.claude/hooks/
cp .claude/agents/doorman.md   <your-project>/.claude/agents/
cp .claude/commands/vet.md     <your-project>/.claude/commands/
cp -r registry                 <your-project>/
```

`registry/` goes **next to `.claude/`**, not inside it. The gate resolves
`$hook/../../registry` and never a git root, because `git rev-parse` returns
whatever repo the working directory happens to be in, which in a worktree or a
submodule is the wrong one.

</details>

Then wire the hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "mcp__.*",
      "hooks": [{
        "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/mcp-gate.sh",
        "timeout": 5
      }]
    }]
  }
}
```

**Until you do that, the gate is installed and not running.** Every MCP tool
call then goes through it, and nothing is on the allowlist except what you put
there.

## How the gate behaves

| Situation | Result |
|---|---|
| Server on `registry/allowlist.json` with `decision: allow` | allowed |
| Server on `registry/denylist.json` | **blocked**, deny always beats allow |
| Server on neither list | **blocked**, unknown is not trusted |
| Registry file missing or unreadable | **blocked** |
| Payload unparseable, or no `mcp__` tool name | **blocked** |

### Five properties it holds on purpose

1. **No network.** The gate contains no network command at all. A gate that asks a
   service for permission is offline the moment the service is, and offline would
   have to mean allow.
2. **No dependencies.** Bash builtins and coreutils only. No jq, no node, no
   python. A gate that fails to start is a gate that fails open.
3. **Fails closed.** Every ambiguous case blocks. The default answer is no.
4. **Exit 2, never exit 1.** Only exit 2 blocks a tool call in Claude Code. Exit 1
   is treated as a script error and the call *proceeds*. A test asserts the file
   contains no `exit 1`.
5. **Deterministic.** Same input, same registry, same answer. No clock, no
   randomness, no model in the loop.

Run the tests to see all of it exercised, including the adversarial cases:

```bash
bash test-gate.sh      # 29 tests
node test-poller.mjs   # registry key derivation
```

Those tests were mutation-checked. Two of them originally passed for the wrong
reason and were rewritten: the denylist test was being satisfied by the *unknown*
path, and nothing covered substring matching on registry keys.

## The subagent

`doorman` holds `Read` and exactly one MCP tool. That is the whole toolset, and
it is deliberate: the agent that decides which servers to trust must not also
carry capabilities an untrusted server could talk it into using.

It never grades a server by reading its documentation, never invents a score, and
treats content from a graded server as data rather than instructions. If a tool
description tells it to ignore its instructions, that is not a request. That is
the finding.

## The registry is yours

Nothing writes to `registry/allowlist.json` automatically.

`/vet <url>` grades a server and *proposes* a diff. The poller
(`scripts/poller.mjs`) reports what changed upstream and applies nothing unless
you pass `--write`, and even then it refuses to allowlist anything that hard-
failed, whatever the service says.

The gate reads the file you accepted. That is the point of it being a file.

## Grading

Grades come from a scorecard service that runs the probes. See the parent repo,
or point `/vet` at your own deployment.

A grade is A (85+), B (70+), C (50+) or F. Two findings cap at F regardless of
everything else: injection-shaped content in the tool descriptions, and a
transport that is not TLS.

**A grade is relative to the model that produced it.** The model is recorded on
every audit and printed on the badge. Do not compare across models.
