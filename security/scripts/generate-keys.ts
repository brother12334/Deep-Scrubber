import { randomBytes } from "node:crypto";

/** Prints fresh secrets for .env. Never commit the output. */
const k = () => randomBytes(32).toString("base64");
console.log(`ENCRYPTION_KEYS=v1:${k()}`);
console.log(`ENCRYPTION_ACTIVE_KEY_ID=v1`);
console.log(`BLIND_INDEX_KEY=${k()}`);
console.log(`LOG_HASH_KEY=${k()}`);
