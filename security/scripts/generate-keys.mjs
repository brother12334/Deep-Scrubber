#!/usr/bin/env node
// Generates fresh secrets. Plain Node, no dependencies.
//   node security/scripts/generate-keys.mjs           -> print them
//   node security/scripts/generate-keys.mjs --write   -> write them into ./.env (created from .env.example if missing)
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const k = () => randomBytes(32).toString("base64");
const values = {
  ENCRYPTION_KEYS: `v1:${k()}`,
  ENCRYPTION_ACTIVE_KEY_ID: "v1",
  BLIND_INDEX_KEY: k(),
  LOG_HASH_KEY: k(),
  INBOUND_EMAIL_SECRET: k(),
};

if (!process.argv.includes("--write")) {
  for (const [name, v] of Object.entries(values)) console.log(`${name}=${v}`);
} else {
  if (!existsSync(".env")) copyFileSync(".env.example", ".env");
  let s = readFileSync(".env", "utf8");
  for (const [name, v] of Object.entries(values)) {
    const re = new RegExp(`^${name}=.*$`, "m");
    const current = s.match(re)?.[0].split("=").slice(1).join("=");
    if (current && !current.includes("REPLACE_ME")) continue; // never overwrite existing keys
    s = re.test(s) ? s.replace(re, `${name}=${v}`) : `${s}\n${name}=${v}\n`;
  }
  writeFileSync(".env", s);
  console.log("Secrets written to .env (existing keys were left untouched).");
}
