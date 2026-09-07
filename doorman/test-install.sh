#!/usr/bin/env bash
#
# The installer, and specifically its self-check.
#
# An install script that always prints a tick is worse than one that prints
# nothing, because it converts "I did not verify this" into "I verified this".
# So the assertions that matter here are the two SABOTAGE cases: a gate that
# opens for everything, and a gate that blocks everything. The second is the
# subtle one. It passes every refusal check while being completely useless, and
# only the allow case catches it.
#
# Style matches test-gate.sh so the suites read as one.
#
# Requires: bash, mktemp. Nothing else.

set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$HERE/install.sh"
pass=0
fail=0

ok() {                        # ok <condition-result> <name> [detail]
  if [ "$1" = 0 ]; then
    printf '  PASS  %s\n' "$2"
    pass=$((pass + 1))
  else
    printf '  FAIL  %s\n' "$2"
    [ $# -ge 3 ] && printf '        %s\n' "$3"
    fail=$((fail + 1))
  fi
}

newdir() { mktemp -d 2>/dev/null || mktemp -d -t doorman; }

# A copy of the repo we can sabotage without touching the real one.
stage() {
  local s; s="$(newdir)"
  cp -r "$HERE/.claude" "$s/" && cp -r "$HERE/registry" "$s/" \
    && cp "$INSTALL" "$s/install.sh"
  printf '%s' "$s"
}

echo
echo "-- a clean install --"
{
  target="$(newdir)"
  out="$(bash "$INSTALL" "$target" 2>&1)"; code=$?
  ok "$code" "the installer exits 0"
  printf '%s' "$out" | grep -q '4/4' && r=0 || r=1
  ok "$r" "it reports 4 of 4 checks"
  [ -x "$target/.claude/hooks/mcp-gate.sh" ] && r=0 || r=1
  ok "$r" "the gate landed and is executable"
  [ -f "$target/registry/allowlist.json" ] && r=0 || r=1
  ok "$r" "the registry landed NEXT TO .claude, where the gate looks"

  # The single most likely install error: the gate cannot find its registry.
  printf '%s' '{"tool_name":"mcp__scorecard__grade","tool_input":{}}' \
    | bash "$target/.claude/hooks/mcp-gate.sh" >/dev/null 2>&1
  ok $(( $? == 0 ? 0 : 1 )) "an allowlisted call passes through the INSTALLED gate"

  printf '%s' "$out" | grep -q 'NOT RUNNING' && r=0 || r=1
  ok "$r" "it says out loud that the hook is not wired yet"
}

echo
echo "-- sabotage: the self-check must catch a broken gate --"
{
  # Broken OPEN. Allows everything, including a server nobody graded.
  s="$(stage)"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$s/.claude/hooks/mcp-gate.sh"
  bash "$s/install.sh" "$(newdir)" >/dev/null 2>&1
  ok $(( $? != 0 ? 0 : 1 )) "a gate that opens for everything fails the install"

  # Broken CLOSED. Blocks everything, so all three refusal checks pass and the
  # gate is still useless. This is the vacuous-test case.
  s="$(stage)"
  printf '#!/usr/bin/env bash\nexit 2\n' > "$s/.claude/hooks/mcp-gate.sh"
  bash "$s/install.sh" "$(newdir)" >/dev/null 2>&1
  ok $(( $? != 0 ? 0 : 1 )) "a gate that blocks EVERYTHING also fails the install"

  # And the failure has to be legible, not just a non-zero code.
  s="$(stage)"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$s/.claude/hooks/mcp-gate.sh"
  out="$(bash "$s/install.sh" "$(newdir)" 2>&1)"
  printf '%s' "$out" | grep -q 'Do not rely on this install' && r=0 || r=1
  ok "$r" "and it says not to rely on the install"
}

echo
echo "-- your registry is yours --"
{
  target="$(newdir)"
  mkdir -p "$target/registry"
  printf '%s\n' '{"servers":{"my_own_thing":{"decision":"allow"}}}' \
    > "$target/registry/allowlist.json"
  printf '%s\n' '{"servers":{}}' > "$target/registry/denylist.json"
  before="$(cat "$target/registry/allowlist.json")"

  out="$(bash "$INSTALL" "$target" 2>&1)"; code=$?
  ok "$code" "it still installs over an existing registry"
  [ "$before" = "$(cat "$target/registry/allowlist.json")" ] && r=0 || r=1
  ok "$r" "and does NOT overwrite the trust list you built"
  printf '%s' "$out" | grep -q 'KEPT' && r=0 || r=1
  ok "$r" "it says so rather than leaving you to notice"
}

echo
echo "-- refusals --"
{
  target="$(newdir)"
  bash "$INSTALL" "$target" --dry-run >/dev/null 2>&1
  ok $(( $(find "$target" -type f | wc -l) == 0 ? 0 : 1 )) \
     "--dry-run writes nothing at all"

  bash "$INSTALL" "$HERE" >/dev/null 2>&1
  ok $(( $? != 0 ? 0 : 1 )) "it refuses to install into its own repo"

  bash "$INSTALL" >/dev/null 2>&1
  ok $(( $? != 0 ? 0 : 1 )) "it refuses with no target"

  bash "$INSTALL" "/no/such/directory/anywhere" >/dev/null 2>&1
  ok $(( $? != 0 ? 0 : 1 )) "it refuses a target that does not exist"
}

echo
printf '  %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" = 0 ] || exit 1
