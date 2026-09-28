import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./db";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(here, "migrations");

/**
 * Minimal forward-only migrator. Each *.sql file runs once, inside a
 * transaction, guarded by an advisory lock so concurrent deploys are safe.
 */
export async function migrate(db: Database, dir = MIGRATIONS_DIR, log: (m: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  await db.tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(727274)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      log(`applying ${file}`);
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      applied.push(file);
    }
  });
  return applied;
}
