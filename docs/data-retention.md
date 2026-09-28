# Data retention & minimisation

The service must not become another data broker. `RetentionSweep` runs hourly (`backend/src/services/retention.ts`).

| Data | Retention |
|---|---|
| Temporary identity documents | `TEMP_DOCUMENT_TTL_HOURS` (default 24h). Deleted from storage and the database |
| Sessions | Until expiry (`SESSION_TTL_HOURS`) |
| Email verification tokens | 7 days after expiry |
| Relay inbox messages | 1 day after use, 7 days maximum |
| Snippets and extracted attributes of removed or dismissed records | Per-user `record_retention_days` (default 365, adjustable from 30 to 3650) |
| Dismissed ("not me") records | Deleted after `record_retention_days` |
| Notifications | 180 days |
| Provider-health events | 90 days |
| Audit logs | `AUDIT_LOG_RETENTION_DAYS` (default 400). They contain ids and enums, never PII |

## Minimization by design

- Search results that are probably about someone else (confidence < 0.40) are never stored.
- Date of birth and street addresses are never sent to search providers.
- Brokers receive only what their process requires. The optional relay address means they never see the user's real email.
- Logs redact PII-shaped fields defensively and pseudonymize IP addresses with a keyed hash.
- Users can delete individual identifiers, export everything (`GET /api/account/export`), and permanently delete the account. Deletion cascades through every table.
- There is no advertising and no data sales. The only third parties are the search, mail, AI (optional) and hosting providers listed in the privacy policy.
