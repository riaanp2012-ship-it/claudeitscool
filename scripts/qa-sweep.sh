#!/usr/bin/env bash
# Recurring QA sweep: runs every gate on the integrated branch and prints a compact summary.
# Exit code is non-zero if any gate fails. Used by the scheduled "check and fix errors" task.
cd "$(dirname "$0")/.." || exit 2
fail=0
run() {
  local name="$1"; shift
  local log="artifacts/qa/${name}.log"
  mkdir -p artifacts/qa
  if "$@" >"$log" 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name  (see $log)"
    tail -n 25 "$log" | sed 's/^/      /'
    fail=1
  fi
}
run typecheck npx tsc --noEmit -p tsconfig.json
run lint      npx eslint src --max-warnings 0
run format    npx prettier --check --no-error-on-unmatched-pattern "src/**/*.{ts,css}" "tests/**/*.ts"
run guard     node scripts/guard.mjs
run unit      npx vitest run --passWithNoTests
run build     npx vite build
if ls tests/e2e/*.spec.ts >/dev/null 2>&1; then
  run e2e npx playwright test --project=e2e
fi
echo "--- worktrees"
git worktree list | sed 's/^/      /'
exit $fail
