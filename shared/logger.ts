import pino from "pino";
import { config } from "./config";

/**
 * Structured logger. Redaction is defensive: code must never log raw
 * identifiers, but if it happens these paths are scrubbed.
 */
export function createLogger(name: string) {
  return pino({
    name,
    level: config().LOG_LEVEL,
    redact: {
      paths: [
        "*.password",
        "*.email",
        "*.phone",
        "*.value",
        "*.identifiers",
        "*.token",
        "*.cookie",
        "req.headers.cookie",
        "req.headers.authorization",
        "*.requestBody",
      ],
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
