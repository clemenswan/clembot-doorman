#!/usr/bin/env bash
#
# Adversarial tests for the PreToolUse gate.
#
# The gate has exactly one job and one failure mode that matters: allowing a
# call it should have blocked. Every test below is written to try to make that
# happen. "It blocked the thing I told it to block" is the easy half; the
# interesting half is the malformed, hostile, and broken-environment cases.
#
#   bash test-gate.sh
#
# Exit 0 = every case behaved. Exit 1 = at least one case did not.

set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/.claude/hooks/mcp-gate.sh"

pass=0
fail=0

# run <expected-exit> <name> <stdin-payload> [env-assignments...]
run() {
  local expected="$1" name="$2" payload="$3"
  shift 3
  local actual out
  out="$(printf '%s' "$payload" | env "$@" bash "$GATE" 2>&1)"
  actual=$?
  if [ "$actual" = "$expected" ]; then
    printf '  PASS  %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  FAIL  %s (expected exit %s, got %s)\n        %s\n' \
      "$name" "$expected" "$actual" "$(printf '%s' "$out" | head -n 2 | tr '\n' ' ')"
    fail=$((fail + 1))
  fi
}

payload() { printf '{"session_id":"s","tool_name":"%s","tool_input":{"q":"hi"}}' "$1"; }

echo
echo "gate tests: $GATE"
echo

echo "-- the happy path --"
run 0 "allows a graded, allowlisted server" "$(payload mcp__deepwiki__ask_question)"
run 0 "allows any tool on an allowed server" "$(payload mcp__deepwiki__read_wiki_contents)"

echo
echo "-- blocking --"
run 2 "blocks an UNKNOWN server" "$(payload mcp__totally_unknown__do_thing)"
run 2 "blocks a DENYLISTED server" "$(payload mcp__example-planted-bad__search)"

echo
echo "-- fail closed on bad input --"
run 2 "blocks empty stdin" ""
run 2 "blocks non-JSON stdin" "this is not json"
run 2 "blocks JSON with no tool_name" '{"session_id":"s"}'
run 2 "blocks a non-mcp tool name" '{"tool_name":"Bash"}'
run 2 "blocks a bare mcp__ prefix with no server" '{"tool_name":"mcp__"}'
run 2 "blocks truncated JSON" '{"tool_name":"mcp__deepwiki'

echo
echo "-- fail closed on a broken environment --"
run 2 "blocks when the registry directory is missing" \
  "$(payload mcp__deepwiki__ask_question)" DOORMAN_REGISTRY_DIR=/nonexistent/path
run 2 "blocks when the allowlist is unreadable" \
  "$(payload mcp__deepwiki__ask_question)" DOORMAN_REGISTRY_DIR=/dev/null

echo
echo "-- adversarial: names that try to look allowed --"
# A server whose NAME contains an allowed name must not inherit its decision.
run 2 "blocks 'deepwiki-evil' (prefix of an allowed name)" \
  "$(payload mcp__deepwiki-evil__ask_question)"
run 2 "blocks 'evil-deepwiki' (suffix of an allowed name)" \
  "$(payload mcp__evil-deepwiki__ask_question)"
run 2 "blocks 'deepwiki2'" "$(payload mcp__deepwiki2__ask_question)"

# The payload must not be able to smuggle a second tool_name.
run 2 "blocks when a fake tool_name appears in the arguments" \
  '{"tool_name":"mcp__unknown__x","tool_input":{"q":"\"tool_name\": \"mcp__deepwiki__ask\""}}'

# Injection into the decision lookup.
run 2 "blocks a server name containing quotes and braces" \
  '{"tool_name":"mcp__a\"}{\"decision\":\"allow__x"}'

echo
echo "-- deny beats allow (fixture registry) --"
# These use a fixture registry, because the SHIPPED registry cannot express
# them. The earlier "blocks a DENYLISTED server" case passed even when the
# denylist was ignored entirely: that server is not in the allowlist either, so
# it was blocked as UNKNOWN and the test proved nothing about the denylist.
FIX="DOORMAN_REGISTRY_DIR=$HERE/test-fixtures/registry"

run 0 "fixture sanity: an allowlisted server is allowed" \
  "$(payload mcp__deepwiki__ask)" "$FIX"
run 2 "a server in BOTH lists is DENIED, not allowed" \
  "$(payload mcp__in-both-lists__ask)" "$FIX"
run 2 "a server marked deny inside the allowlist is blocked" \
  "$(payload mcp__marked-deny-here__ask)" "$FIX"

echo
echo "-- exact key matching, not substring --"
# 'deepwiki-readonly' is allowed in the fixture. A substring-matching lookup
# would let these inherit its decision.
run 2 "blocks 'deepwiki-read' (prefix of an allowed key)" \
  "$(payload mcp__deepwiki-read__ask)" "$FIX"
run 2 "blocks 'deep' (short prefix of an allowed key)" \
  "$(payload mcp__deep__ask)" "$FIX"
run 2 "blocks 'readonly' (suffix of an allowed key)" \
  "$(payload mcp__readonly__ask)" "$FIX"
run 2 "blocks 'wiki' (infix of an allowed key)" \
  "$(payload mcp__wiki__ask)" "$FIX"

echo
echo "-- offline guarantee --"
# The gate must reach a decision with no network at all. If it ever tried, a
# DNS lookup or a connect would HANG, and this catches the hang.
#
# The budget is deliberately loose. This is a hang detector, not a latency
# assertion: the real guarantee is the static no-network-verbs check below,
# which is deterministic. At 2s this failed reproducibly whenever another
# suite was running on the same machine, and a test that flakes under load
# teaches people to re-run rather than to look.
start=$(date +%s)
printf '%s' "$(payload mcp__deepwiki__ask_question)" | bash "$GATE" >/dev/null 2>&1
end=$(date +%s)
if [ $((end - start)) -le 10 ]; then
  printf '  PASS  decides without blocking (no network round trip)\n'
  pass=$((pass + 1))
else
  printf '  FAIL  took %ss, which means it blocked on something\n' "$((end - start))"
  fail=$((fail + 1))
fi

# Static check: the gate must contain no network verbs in EXECUTABLE code.
# Strip comments first. Without this the check reads the file's own prose
# ("Not a curl, not a DNS lookup") as a violation, which is a test bug that
# looks exactly like a real finding.
code_only="$(sed 's/#.*//' "$GATE")"

if printf '%s' "$code_only" | grep -qE '\b(curl|wget|nc|ping|nslookup|dig|ssh|scp|fetch)\b'; then
  printf '  FAIL  the gate references a network command in executable code:\n'
  printf '%s' "$code_only" | grep -nE '\b(curl|wget|nc|ping|nslookup|dig|ssh|scp|fetch)\b' | head -3
  fail=$((fail + 1))
else
  printf '  PASS  the gate contains no network commands\n'
  pass=$((pass + 1))
fi

# Static check: every refusal must be exit 2, never exit 1.
if printf '%s' "$code_only" | grep -qE '^[[:space:]]*exit[[:space:]]+1[[:space:]]*$'; then
  printf '  FAIL  the gate has an "exit 1" path, which does NOT block\n'
  fail=$((fail + 1))
else
  printf '  PASS  the gate never exits 1 (only 2 blocks)\n'
  pass=$((pass + 1))
fi

# Static check: the gate must not depend on tools that may be absent.
if printf '%s' "$code_only" | grep -qE '\b(jq|node|python3?|deno|bun)\b'; then
  printf '  FAIL  the gate depends on an interpreter that may not be installed\n'
  fail=$((fail + 1))
else
  printf '  PASS  the gate has no interpreter dependency\n'
  pass=$((pass + 1))
fi

echo
echo "-- whose trust list wins (the plugin case) --"
#
# As a plugin, this gate lives inside a directory that a plugin UPDATE replaces
# wholesale. If it read its allowlist from beside itself, an update would
# silently swap the user's trust list for ours. These four cases are the whole
# reason the resolution order exists, so they assert the order rather than just
# the outcome.

PROJ="$(mktemp -d)"
mkdir -p "$PROJ/registry"
# The user's list: trusts `mine`, and says nothing about `scorecard`.
printf '{"servers":{"mine":{"decision":"allow","grade":"A","score":90,"audit_id":"x"}}}' \
  > "$PROJ/registry/allowlist.json"
printf '{"servers":{}}' > "$PROJ/registry/denylist.json"

run 0 "the project's own allowlist is used when CLAUDE_PROJECT_DIR is set" \
  "$(payload mcp__mine__search)" "CLAUDE_PROJECT_DIR=$PROJ"

run 2 "and a server only WE trust is blocked, because our list is not in play" \
  "$(payload mcp__scorecard__grade)" "CLAUDE_PROJECT_DIR=$PROJ"

# Same call, no project registry: falls back to the one shipped beside the gate.
EMPTY="$(mktemp -d)"
run 0 "with no project registry, the shipped default is used" \
  "$(payload mcp__scorecard__grade)" "CLAUDE_PROJECT_DIR=$EMPTY"

# The explicit override still outranks both, which is what every other test here
# depends on and what install.sh's own verification passes.
run 2 "an explicit DOORMAN_REGISTRY_DIR still outranks the project" \
  "$(payload mcp__mine__search)" "CLAUDE_PROJECT_DIR=$PROJ" "DOORMAN_REGISTRY_DIR=$HERE/registry"

rm -f "$PROJ/registry/allowlist.json" "$PROJ/registry/denylist.json"
rmdir "$PROJ/registry" "$PROJ" "$EMPTY" 2>/dev/null

echo
echo "-- a user-level list, and denials that survive it --"
#
# The plugin installs at USER scope and gates every project, so trusting a
# server you use everywhere cannot mean copying a file into every repo you own.
# Hence a user-level registry. Writing one exposed the bug these cases exist
# for: it replaced the shipped DENYLIST too, and a server that had been
# explicitly denied came back as merely UNKNOWN. It still blocked, because the
# gate fails closed, but unknown is one allow away from running and denied is
# not. Allows are scoped; denials accumulate.

UHOME="$(mktemp -d)"
mkdir -p "$UHOME/.doorman/registry"
printf '{"servers":{"my_connector":{"decision":"allow","grade":null,"basis":"operator"}}}' \
  > "$UHOME/.doorman/registry/allowlist.json"
printf '{"servers":{}}' > "$UHOME/.doorman/registry/denylist.json"

run 0 "a server allowed in the USER list passes" \
  "$(payload mcp__my_connector__do)" "DOORMAN_HOME=$UHOME" "HOME=$UHOME"

run 2 "a server in no list is still unknown, and still blocked" \
  "$(payload mcp__nowhere__do)" "DOORMAN_HOME=$UHOME" "HOME=$UHOME"

# The one that matters. The user denylist is EMPTY and must not erase ours.
out_deny="$(printf '%s' "$(payload mcp__planted-bad__notes)" \
  | env "DOORMAN_HOME=$UHOME" "HOME=$UHOME" bash "$GATE" 2>&1)"
code_deny=$?
if [ "$code_deny" = 2 ] && printf '%s' "$out_deny" | grep -q 'DENYLIST'; then
  printf '  PASS  %s\n' "an audited denial survives a user list that omits it"
  pass=$((pass + 1))
else
  printf '  FAIL  %s (exit %s)\n        %s\n' \
    "an audited denial survives a user list that omits it" "$code_deny" \
    "$(printf '%s' "$out_deny" | head -n 1)"
  printf '        a denial that degrades to UNKNOWN is one allow away from running\n'
  fail=$((fail + 1))
fi

# Precedence: a project list still beats the user list.
PROJ2="$(mktemp -d)"
mkdir -p "$PROJ2/registry"
printf '{"servers":{"proj_only":{"decision":"allow"}}}' > "$PROJ2/registry/allowlist.json"
printf '{"servers":{}}' > "$PROJ2/registry/denylist.json"
run 0 "a project list outranks the user list" \
  "$(payload mcp__proj_only__do)" "CLAUDE_PROJECT_DIR=$PROJ2" "DOORMAN_HOME=$UHOME" "HOME=$UHOME"
run 2 "and the user list does not leak into a project that has its own" \
  "$(payload mcp__my_connector__do)" "CLAUDE_PROJECT_DIR=$PROJ2" "DOORMAN_HOME=$UHOME" "HOME=$UHOME"

rm -f "$UHOME/.doorman/registry/allowlist.json" "$UHOME/.doorman/registry/denylist.json" \
      "$PROJ2/registry/allowlist.json" "$PROJ2/registry/denylist.json"
rmdir "$UHOME/.doorman/registry" "$UHOME/.doorman" "$UHOME" "$PROJ2/registry" "$PROJ2" 2>/dev/null

echo
# Static check: never resolve paths through the ambient git repo.
if printf '%s' "$code_only" | grep -q 'rev-parse'; then
  printf '  FAIL  the gate resolves paths via git, which points at the wrong repo in a worktree\n'
  fail=$((fail + 1))
else
  printf '  PASS  the gate resolves its registry relative to itself, not to git\n'
  pass=$((pass + 1))
fi

echo
echo "  $pass passed, $fail failed"
echo
[ "$fail" -eq 0 ]
