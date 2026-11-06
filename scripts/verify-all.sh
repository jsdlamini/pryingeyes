#!/usr/bin/env bash
# Runs every automated check in the order the acceptance criteria list them.
# Needs: docker compose services up, .env created, migrations applied. Takes ~5 minutes.
set -uo pipefail
cd "$(dirname "$0")/.."
PASS=(); FAIL=()
step() { local name="$1"; shift; echo; echo "━━ $name"; if "$@"; then PASS+=("$name"); else FAIL+=("$name"); fi; }

step "Type-check"                 npm run -s typecheck
step "Lint"                       npm run -s lint
step "Unit + integration tests"   npm test --silent
step "Production build"           npm run -s build

echo; echo "━━ Starting the app on :3000"
npm start > var/verify-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000/privacy && break; sleep 1; done

step "End-to-end (browser)"       npx playwright test
step "Enumeration attack"         npx tsx scripts/enumeration-attack.ts --attempts=10000 --concurrency=50
step "Audit chain"                npx tsx scripts/verify-audit-chain.ts
step "Plaintext number scan"      npx tsx scripts/scan-plaintext.ts

kill $SERVER 2>/dev/null; sleep 1
echo; echo "━━ Load test (server restarted with raised budgets so throttles don't hide latency)"
RL_IP_PER_HOUR=10000000 RL_CALLER_PER_DAY=10000000 RL_CALLER_TOKEN_PER_DAY=10000000 RL_TOKEN_PER_DAY=10000000 LOG_LEVEL=warn npm start > var/verify-load.log 2>&1 &
SERVER=$!
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000/privacy && break; sleep 1; done
step "Load test p95 < 300 ms"     npx tsx scripts/load-test.ts --rps=50 --seconds=30

echo; echo "════════ Summary"
for s in "${PASS[@]}"; do echo "  ✓ $s"; done
for s in "${FAIL[@]:-}"; do [ -n "$s" ] && echo "  ✗ $s"; done
[ ${#FAIL[@]} -eq 0 ]
