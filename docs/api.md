# API reference

The base path is `/api`. Browsers reach the API through the web app's same-origin `/api` rewrite.

## Conventions

- **Authentication:** an `HttpOnly`, `SameSite=Lax` session cookie (`ds_session`) is issued by `/auth/signup` and `/auth/login`.
- **CSRF:** every non-GET request must send `x-csrf-token`. The token is returned by `/auth/login`, `/auth/signup` and `/auth/me`.
- **Profile scoping:** profile-scoped endpoints accept `?profileId=`. Without it, the user's first profile is used. Every request enforces ownership, and anything outside it returns 404.
- **Email verification:** state-changing endpoints require a verified email when `REQUIRE_EMAIL_VERIFICATION=true`, and return `403 EMAIL_NOT_VERIFIED` otherwise.
- **Errors:** `{ "error": { "code": "…", "message": "…", "details": {…} } }`. Validation errors return `400 VALIDATION_ERROR` with `details.issues`.
- **Rate limits:** per IP and per user, plus action quotas (sign-up, login, scans per day by plan, submissions, reveals, exports). `429` responses include `Retry-After`.
- **Admin endpoints:** `role=admin` plus an MFA-verified session (`403 MFA_REQUIRED` otherwise).

The machine-readable spec is [openapi.yaml](openapi.yaml).

## Auth

| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | `{email, password, acceptTerms}` creates an account, sends the verification email and starts a session |
| POST | `/auth/login` | `{email, password}` |
| POST | `/auth/logout` | Ends the session |
| GET | `/auth/me` | The current user plus `csrfToken`. `mustVerifyEmail` tells the UI whether to gate actions |
| POST | `/auth/verify-email` | `{token}` |
| POST | `/auth/resend-verification` | |
| POST | `/auth/mfa/setup` | Returns a TOTP secret and `otpauth://` URI |
| POST | `/auth/mfa/verify` | `{code, enable?}` marks the session MFA-verified |

## Profile & identifiers

| Method | Path | Description |
|---|---|---|
| POST | `/profile` | `{label, relationship, authorizationStatement, attest: true, jurisdictionCode?, defaultApprovalMode?}` |
| GET | `/profile` | The user's profiles with masked identifiers |
| PATCH | `/profile/:id` | `label`, `jurisdictionCode`, `defaultApprovalMode`, `blanketAuthorization`, `monitoringIntervalDays`, `monitoringEnabled`, `useRelayEmail` |
| GET | `/profile/:id/identifiers` | Masked view |
| POST | `/profile/:id/identifiers` | `{type, value, isPrevious?}`. Types: `FULL_NAME`, `ALIAS`, `EMAIL`, `PHONE`, `USERNAME`, `DOMAIN`, `BUSINESS_NAME`, `LOCATION`, `ADDRESS`, `DATE_OF_BIRTH` |
| POST | `/profile/:id/identifiers/:identifierId/reveal` | Explicit, audited, rate-limited reveal of one value |
| DELETE | `/profile/:id/identifiers/:identifierId` | Permanently deletes the identifier |

## Scans & exposures

| Method | Path | Description |
|---|---|---|
| POST | `/scans` | Queues a DiscoveryJob (`202`). Subject to the plan's daily quota |
| GET | `/scans`, `/scans/:id` | Status and stats: queries, retained results, results discarded as probably someone else, new, reappeared |
| GET | `/exposures` | Filters: `status`, `category`, `priority`, `includeSearch`, `limit`, `offset` |
| GET | `/exposures/:id` | Match explanation, priority factors, pathways, requests, verification history |
| POST | `/exposures/:id/confirm` | "Yes, this is me". Makes weak or possible matches actionable and plans a removal |
| POST | `/exposures/:id/dismiss` | "Not me". Cancels open requests |
| GET | `/exposures/clusters` | Exposure clusters with the origin, search appearances, mirrors and recommended action |
| GET | `/exposures/map` | Counts for the exposure map |

## Removals

| Method | Path | Description |
|---|---|---|
| POST | `/removals` | `{recordId}` plans a removal and returns the request preview |
| GET | `/removals` | `?status=` (comma-separated) |
| GET | `/removals/:id` | Preview: recipient, body, pathway with its confidence and reason, user action, step timeline, verification checks |
| GET | `/removals/:id/status` | Lightweight status |
| POST | `/removals/:id/approve` | `{subject?, body?}` approves, optionally with edits, and queues a RemovalJob |
| POST | `/removals/:id/action` | `{choice: "done" \| "skip" \| "continue_manually"}` answers an ACTION REQUIRED card |
| POST | `/removals/:id/retry` | Starts a new request for a failed, cancelled, completed or reappeared exposure |
| POST | `/removals/:id/cancel` | |

## Monitoring, sources, score, reports

| Method | Path | Description |
|---|---|---|
| GET | `/monitoring` | Settings and monitoring jobs |
| POST | `/monitoring` | `{intervalDays?, enabled?, recordId?}` |
| DELETE | `/monitoring/:id` | Stops monitoring one record |
| GET | `/sources` | Registry plus reliability. Statistics are shown only with enough real data |
| PUT | `/sources/:sourceId/preference` | `{approvalMode: "AUTOMATIC" \| "APPROVAL_REQUIRED" \| "MANUAL" \| null}` |
| GET | `/dashboard` | Score, cards, actions required, recent activity |
| GET | `/score/history` | Snapshots with change reasons |
| GET | `/reports/summary`, `/reports/export.csv`, `/reports/export.pdf` | |

## Account, notifications, billing, misc

| Method | Path | Description |
|---|---|---|
| GET/PUT | `/settings` | Notification channels, record retention days |
| GET | `/account/export` | Everything held about the account, as JSON |
| DELETE | `/account` | `{password, confirm: "DELETE"}`. Permanent cascade delete |
| GET | `/notifications` | |
| POST | `/notifications/:id/read`, `/notifications/read-all` | |
| POST | `/push/subscribe` | Web Push subscription (stored encrypted) |
| GET | `/billing/plans` | Public |
| POST | `/billing/change-plan` | Only when `BILLING_MODE=dev`, otherwise `501` |
| POST | `/abuse-reports` | Public, rate limited |
| POST | `/inbound-email` | Relay mail webhook. Requires an `x-signature` HMAC-SHA256 of the raw body with `INBOUND_EMAIL_SECRET` |
| GET | `/jurisdictions`, `/explanations` | Public reference data |

## Admin (MFA required)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/metrics` | Aggregate counts only |
| GET/POST | `/admin/providers` | List with health and reliability; upsert a registry entry (schema-validated) |
| POST | `/admin/providers/:sourceId/enabled` | `{enabled}` |
| POST | `/admin/providers/:sourceId/pause` | `{paused, reason?}`: manual circuit breaker |
| GET/POST | `/admin/providers/:sourceId/workflows` | Versions; create a DRAFT `{definition, changelog}` |
| POST | `/admin/providers/:sourceId/workflows/:version/activate` \| `/disable` | |
| POST | `/admin/providers/:sourceId/workflows/propose` | AI-assisted DRAFT. Never auto-activated |
| POST | `/admin/health/evaluate` | Runs the provider health check now |
| GET | `/admin/failed-jobs` | `POST …/:id/retry`, `POST …/:id/resolve` |
| GET/PATCH | `/admin/abuse-reports[/:id]` | `{status, note?, suspendUser?, clearProfileFlag?}` |
| GET | `/admin/audit` | `?action=prefix&limit=`. Ids and enums only |
