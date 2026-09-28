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
set_var() { # set_var NAME VALUE  (replaces the line in .env or appends it)
  node -e '
    const fs = require("fs"); const [k, v] = process.argv.slice(1);
    let s = fs.readFileSync(".env", "utf8");
    const re = new RegExp(`^${k}=.*$`, "m");
    s = re.test(s) ? s.replace(re, `${k}=${v}`) : s + `\n${k}=${v}\n`;
    fs.writeFileSync(".env", s);' "$1" "$2"
}

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
# Prints "SET NAME=VALUE" lines for settings that need adjusting (applied below).
CHECK_OUT=$(node --input-type=module -e '
  import pg from "pg";
  import { Redis } from "ioredis";
  const tryConnect = async (u) => {
    const admin = new URL(u); admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 4000 });
    try { await c.connect(); return c; } catch (e) { return e; }
  };
  let url = process.env.DATABASE_URL;
  let conn = await tryConnect(url);
  if (conn instanceof Error) {
    // Postgres.app / Homebrew default: your login name, no password.
    const alt = new URL(url); alt.username = process.env.USER || ""; alt.password = "";
    const c2 = alt.username ? await tryConnect(alt.toString()) : conn;
    if (c2 instanceof Error) {
      console.error(`Cannot connect to PostgreSQL at ${new URL(url).host}: ${conn.message}`);
      console.error("Make sure PostgreSQL is running (e.g. open Postgres.app), or set DATABASE_URL and re-run.");
      process.exit(1);
    }
    conn = c2; url = alt.toString();
    console.log(`SET DATABASE_URL=${url}`);
  }
  const dbName = new URL(url).pathname.slice(1);
  const exists = await conn.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) { await conn.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`); console.error(`created database ${dbName}`); }
  else console.error(`database ${dbName} exists`);
  await conn.end();
  if (process.env.QUEUE_DRIVER === "memory") { console.error("redis not needed (single-process mode)"); process.exit(0); }
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  r.on("error", () => {});
  try { await r.connect(); console.error("redis", await r.ping()); r.disconnect(); }
  catch {
    console.error("Redis not found - using single-process mode (background jobs run inside the API). Fine for a personal install.");
    console.log("SET QUEUE_DRIVER=memory");
    console.log("SET RATE_LIMIT_DRIVER=memory");
  }
') || exit 1
while IFS= read -r line; do
  [[ "$line" == SET\ * ]] || continue
  kv=${line#SET }
  set_var "${kv%%=*}" "${kv#*=}"
done <<< "$CHECK_OUT"
set -a; . ./.env; set +a

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
