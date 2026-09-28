#!/usr/bin/env bash
# One-command local setup: installs dependencies, creates .env with fresh secrets,
# creates the database if needed, runs migrations and loads the provider registry.
#
#   ./scripts/setup.sh            # demo-friendly defaults (fixture search, no email verification)
#   ./scripts/setup.sh --strict   # production-like defaults (email verification on, billing off)
set -euo pipefail
cd "$(dirname "$0")/.."

STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

step() { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31mError:\033[0m %s\n" "$*" >&2; exit 1; }

step "Checking prerequisites"
command -v node >/dev/null || fail "Node.js 20+ is required (https://nodejs.org)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
(( NODE_MAJOR >= 20 )) || fail "Node.js 20+ is required (found $(node -v))."
echo "node $(node -v)"

step "Installing dependencies (backend, web app, admin console)"
npm install --no-audit --no-fund
(cd frontend && npm install --no-audit --no-fund)
(cd admin && npm install --no-audit --no-fund)

if [[ ! -f .env ]]; then
  step "Creating .env with freshly generated secrets"
  cp .env.example .env
  key() { node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'; }
  set_var() { # set_var NAME VALUE  (replaces the line or appends it)
    node -e '
      const fs = require("fs"); const [k, v] = process.argv.slice(1);
      let s = fs.readFileSync(".env", "utf8");
      const re = new RegExp(`^${k}=.*$`, "m");
      s = re.test(s) ? s.replace(re, `${k}=${v}`) : s + `\n${k}=${v}\n`;
      fs.writeFileSync(".env", s);' "$1" "$2"
  }
  set_var ENCRYPTION_KEYS "v1:$(key)"
  set_var BLIND_INDEX_KEY "$(key)"
  set_var LOG_HASH_KEY "$(key)"
  set_var INBOUND_EMAIL_SECRET "$(key)"
  set_var DATABASE_URL "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/deepscrubber}"
  set_var REDIS_URL "${REDIS_URL:-redis://localhost:6379}"
  if (( STRICT == 0 )); then
    set_var REQUIRE_EMAIL_VERIFICATION false
    set_var BILLING_MODE dev
    set_var LOG_LEVEL warn
  fi
  echo "Wrote .env (keep it secret; it is git-ignored)."
else
  step "Using existing .env"
fi

set -a; . ./.env; set +a

step "Checking PostgreSQL and Redis"
node --input-type=module -e '
  import pg from "pg";
  import { Redis } from "ioredis";
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new URL(url); admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString() });
  try { await c.connect(); } catch (e) {
    console.error(`Cannot connect to PostgreSQL at ${url.host}: ${e.message}\nStart PostgreSQL or set DATABASE_URL in .env.`); process.exit(1);
  }
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) { await c.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`); console.log(`created database ${dbName}`); }
  else console.log(`database ${dbName} exists`);
  await c.end();
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try { await r.connect(); console.log("redis", await r.ping()); r.disconnect(); }
  catch (e) { console.error(`Cannot connect to Redis at ${process.env.REDIS_URL}: ${e.message}`); process.exit(1); }
'

step "Running migrations and loading the provider registry"
npm run --silent db:migrate
npm run --silent db:seed

step "Done"
cat <<MSG
Start everything with:   npm run dev
Then open:               http://localhost:3000   (user app)
                         http://localhost:3001   (admin console)
Make yourself admin:     npm run make-admin -- you@example.com
MSG
