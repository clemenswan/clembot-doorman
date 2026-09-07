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
