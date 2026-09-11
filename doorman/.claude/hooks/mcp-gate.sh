#!/usr/bin/env bash
#
# mcp-gate.sh - PreToolUse gate for every MCP tool call.
#
# Wired to matcher "mcp__.*". Claude Code passes the tool call as JSON on
# stdin. This script decides whether the call proceeds.
#
#   exit 0  allow
#   exit 2  BLOCK, and stderr is shown to the model
#
# Exit 2 is the only code that blocks. Exit 1 is treated as a non-blocking
# script error and the tool call PROCEEDS, which for a security gate means
# failing open. Every refusal path in this file must exit 2.
#
# FOUR RULES, none of them negotiable:
#
#   1. NO NETWORK. Not a curl, not a DNS lookup, nothing. A gate that asks a
#      server for permission is offline the moment the network is, and
#      "offline" would mean "allow". Decisions come from local files only.
#
#   2. NO DEPENDENCIES. No jq, no node, no python. Only bash builtins and
#      coreutils, because a gate that fails to start is a gate that fails open
#      on the machine where the dependency is missing.
#
#   3. FAIL CLOSED. Unparseable input, missing registry, unreadable file,
#      unknown server: all block. The default answer is no.
#
#   4. DETERMINISTIC. Same input, same registry, same answer, every time. No
#      clocks, no randomness, no model in the loop.
#
# The registry is synced from the scorecard by a human running `/vet` or the
# poller. This script never writes to it and never fetches it.

set -uo pipefail

# Resolve the registry relative to THIS SCRIPT, never to a git root.
# `git rev-parse --show-toplevel` returns whatever repo the cwd happens to be
# in, which in a worktree or a submodule is the wrong repo entirely.
HOOK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$HOOK_DIR/../.." && pwd)"

# THE USER'S TRUST LIST OUTRANKS THE ONE WE SHIPPED. Three sources, in order:
#
#   1. $DOORMAN_REGISTRY_DIR   explicit, and what every test passes
#   2. the PROJECT's registry/ the user's list, which we never write
#   3. beside this script      the default we shipped
#
# Order 2 before 3 is what makes invariant 24 structurally true rather than
# merely observed. As a plugin, this script lives inside the plugin directory
# and a plugin UPDATE replaces that directory wholesale. If the gate read its
# allowlist from beside itself, an update would silently replace the user's
# trust list with our three entries, which is the single most destructive
# thing this project could do. It cannot now: an update rewrites path 3 and
# path 2 is not in the plugin at all.
#
# A USER-LEVEL list sits between the two, and it exists because the plugin does.
# A plugin installs at user scope and gates every project on the machine, while
# a project registry gates one. Without a user level, trusting a server you use
# everywhere means copying the same file into every repo you own, and the ones
# you forget fail closed on servers you already trusted. That is a rule nobody
# can follow, and an unfollowable rule gets switched off.
REGISTRY_DIR="${DOORMAN_REGISTRY_DIR:-}"
if [ -z "$REGISTRY_DIR" ]; then
  USER_REGISTRY="${DOORMAN_HOME:-${HOME:-$USERPROFILE}}/.doorman/registry"
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/registry/allowlist.json" ]; then
    REGISTRY_DIR="$CLAUDE_PROJECT_DIR/registry"
  elif [ -f "$USER_REGISTRY/allowlist.json" ]; then
    REGISTRY_DIR="$USER_REGISTRY"
  else
    REGISTRY_DIR="$REPO_ROOT/registry"
  fi
fi
ALLOWLIST="$REGISTRY_DIR/allowlist.json"
DENYLIST="$REGISTRY_DIR/denylist.json"

block() {
  # stderr reaches the model on exit 2. Say what to do next, not just "no".
  printf '%s\n' "$1" >&2
  exit 2
}

allow() {
  exit 0
}

# --- read the tool call ------------------------------------------------------
# Read stdin without hanging forever if nothing arrives.
input=""
if ! IFS= read -r -d '' -t 5 input; then
  # read -d '' returns non-zero at EOF even when it read everything, so an
  # empty result is the only real failure.
  :
fi

if [ -z "$input" ]; then
  block "doorman: no tool-call payload on stdin. Blocking (the gate fails closed)."
fi

# --- extract the tool name ---------------------------------------------------
# Only ever matches mcp__<server>__<tool>, which is a constrained identifier:
# ASCII word characters and dashes, no JSON escapes possible. A regex is safe
# here and costs no dependency.
tool_name=""
if [[ "$input" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"(mcp__[A-Za-z0-9_.-]+)\" ]]; then
  tool_name="${BASH_REMATCH[1]}"
fi

if [ -z "$tool_name" ]; then
  # The matcher should only route mcp__* here. Anything else means the wiring
  # changed or the payload shape did, and we do not guess.
  block "doorman: could not read an mcp__ tool name from the hook payload. Blocking."
fi

# mcp__<server>__<tool>  ->  <server>
rest="${tool_name#mcp__}"
server="${rest%%__*}"

if [ -z "$server" ] || [ "$server" = "$rest" ] && [[ "$rest" != *__* ]]; then
  # No "__" separator: cannot identify a server, so cannot vouch for one.
  server="$rest"
fi

if [ -z "$server" ]; then
  block "doorman: could not identify an MCP server in '$tool_name'. Blocking."
fi

# --- registry must exist -----------------------------------------------------
if [ ! -r "$ALLOWLIST" ]; then
  block "doorman: no readable allowlist at $ALLOWLIST.
Blocking '$server' because an absent registry is not the same as an empty one.
Run: /vet <server-url>   (or restore registry/allowlist.json)"
fi

# --- lookup ------------------------------------------------------------------
# Matches a top-level key in the "servers" object: "<server>": { ... "decision": "allow" ...
# Deliberately literal string matching. No JSON parser, no eval, no expansion
# of anything read from the file.
lookup_decision() {
  local file="$1" key="$2"
  [ -r "$file" ] || return 1
  # Flatten to one line, then find the object that follows "<key>":
  tr -d '\n\r\t' < "$file" \
    | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*{[^}]*}" \
    | grep -o '"decision"[[:space:]]*:[[:space:]]*"[a-z]*"' \
    | grep -o '"[a-z]*"$' \
    | tr -d '"' \
    | head -n 1
}

# Deny wins over allow, always. A server present in both lists is a mistake,
# and the safe reading of a mistake is "deny".
#
# DENIALS ACCUMULATE ACROSS REGISTRIES; ALLOWS DO NOT. Choosing a narrower
# registry is a deliberate scoping decision about what you trust, so a user or
# project allowlist replacing the shipped one is correct. Doing the same to a
# denylist is not: it silently discards a refusal that was earned by an audit.
# Writing a user allowlist did exactly that here, and a server that had been
# explicitly denied came back as merely UNKNOWN. It still blocked, because the
# gate fails closed, but "unknown" is one allow away from running and "denied"
# is not, so the distinction is the whole safety margin.
for dl in "$DENYLIST" "$REPO_ROOT/registry/denylist.json"; do
  [ -r "$dl" ] || continue
  deny_decision="$(lookup_decision "$dl" "$server" 2>/dev/null || true)"
  if [ "$deny_decision" = "deny" ] || [ "$deny_decision" = "allow" ]; then
    block "doorman: '$server' is on a DENYLIST. Blocking.
Reason and evidence: $dl
This server was graded and failed. Do not work around this by calling it another way."
  fi
done

allow_decision="$(lookup_decision "$ALLOWLIST" "$server" 2>/dev/null || true)"

case "$allow_decision" in
  allow)
    allow
    ;;
  deny)
    block "doorman: '$server' is marked deny in the allowlist. Blocking."
    ;;
  "")
    block "doorman: '$server' is UNKNOWN. Blocking until it has been graded.

An ungraded MCP server is not a trusted one. Nothing about '$tool_name' has
been verified: not its tool descriptions, not its error handling, not whether
its descriptions contain instructions aimed at you.

Measure it (free, no key):   doorman report <server-url>
Trust it without measuring:  doorman allow $server
Or ask:                      /doorman

The second one records a DECISION, not a measurement: the entry is written
with a null grade because nothing graded it. That is a legitimate choice for
a server you already run, and it is not the same as this server being safe.

A url is not always available: a connector only ever tells this gate the name
'$server', which is why \`doorman allow\` takes the name."
    ;;
  *)
    block "doorman: '$server' has an unrecognised decision '$allow_decision'. Blocking."
    ;;
esac

# Unreachable. Present so that a future edit that falls through this far still
# fails closed rather than returning bash's last exit status.
block "doorman: fell through the decision table. Blocking."
