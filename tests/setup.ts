import { randomBytes } from "node:crypto";

// Deterministic, test-only configuration. Never reuse these keys anywhere.
const key = (seed: string) => Buffer.from(seed.padEnd(32, "x").slice(0, 32)).toString("base64");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/deepscrubber_test";
process.env.QUEUE_DRIVER = "memory";
process.env.RATE_LIMIT_DRIVER = "memory";
process.env.ENCRYPTION_KEYS = `v1:${key("test-encryption-key-v1")}`;
process.env.ENCRYPTION_ACTIVE_KEY_ID = "v1";
process.env.BLIND_INDEX_KEY = key("test-blind-index-key");
process.env.LOG_HASH_KEY = key("test-log-hash-key");
process.env.SEARCH_PROVIDERS = "";
process.env.AI_PROVIDER = "none";
process.env.MAIL_TRANSPORT = "log";
process.env.ADMIN_REQUIRE_MFA = "true";
process.env.BILLING_MODE = "dev";
process.env.INBOUND_EMAIL_SECRET = "test-inbound-secret";
process.env.REMOVAL_REPLY_TO_DOMAIN = "relay.test";
process.env.FETCH_ALLOWLIST_PRIVATE_HOSTS = "127.0.0.1";
process.env.STORAGE_DIR = `/tmp/ds-test-storage-${randomBytes(4).toString("hex")}`;
