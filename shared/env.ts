import { existsSync } from "node:fs";

/**
 * Load ./.env into process.env (without overriding variables already set), so
 * every entry point — API, worker, migrations, scripts — works without a wrapper.
 * Skipped in tests, which configure the environment explicitly.
 */
export function loadDotEnv(path = ".env"): void {
  if (process.env.NODE_ENV === "test" || process.env.DS_SKIP_DOTENV === "1") return;
  if (existsSync(path)) process.loadEnvFile(path);
}
