#!/usr/bin/env bash
# Start the whole stack for local development in one terminal:
# mock broker (:4545), API (:4000), worker, web app (:3000), admin console (:3001).
# Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "No .env found. Run ./scripts/setup.sh first." >&2; exit 1; }
set -a; . ./.env; set +a

pids=()
run() { # run NAME COLOR CMD...
  local name=$1 color=$2; shift 2
  ( "$@" 2>&1 | sed -u "s/^/$(printf "\033[%sm%-7s\033[0m| " "$color" "$name")/" ) &
  pids+=($!)
}
cleanup() { trap - INT TERM EXIT; echo; echo "Stopping…"; kill 0 2>/dev/null || true; }
trap cleanup INT TERM EXIT

run broker 35 npx tsx removal-agents/example-broker/mock-server.ts
run api    34 npx tsx watch backend/src/main.ts
if [[ "${QUEUE_DRIVER:-bullmq}" != "memory" ]]; then
  run worker 33 npx tsx watch workers/src/main.ts
fi
run web    32 npm --prefix frontend run dev
run admin  36 npm --prefix admin run dev

echo "User app:      http://localhost:3000"
echo "Admin console: http://localhost:3001"
echo "API:           http://localhost:4000/healthz"
wait
