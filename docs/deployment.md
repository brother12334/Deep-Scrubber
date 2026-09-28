# Deployment

## Components

| Component | Image / command | Scaling |
|---|---|---|
| API | `Dockerfile` → `node dist/api.js` | Stateless; scale horizontally behind a load balancer |
| Worker | same image → `node dist/worker.js` | Scale by queue depth. `WORKER_CONCURRENCY` sets jobs per process |
| Migrations | same image → `node dist/migrate.js && node dist/seed.js` | Run once per deploy. An advisory lock prevents concurrent runs |
| Web | `frontend/Dockerfile` (Next.js standalone) | Vercel, Cloudflare or any Node host. Set `API_URL` for the `/api` rewrite |
| Admin | `admin/Dockerfile` | Expose it only through a VPN or zero-trust proxy, on a separate host name |
| PostgreSQL 16 | Managed service | Encryption at rest, point-in-time recovery |
| Redis 7 | Managed service | Queue plus rate-limit counters. Persistence (AOF) recommended |

`docker compose --profile dev up --build` runs everything on one host, including the mock broker.

## Configuration

All settings are in `.env.example` and validated at start-up by `shared/config.ts`. Production requires:
- `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true` behind a proxy
- secrets generated with `npm run keys:generate`, kept in a secret manager and never committed
- an empty `FETCH_ALLOWLIST_PRIVATE_HOSTS` (enforced)
- `BILLING_MODE` other than `dev` (enforced)
- `MAIL_TRANSPORT=smtp` with `SMTP_URL`
- `INBOUND_EMAIL_SECRET`, if relay aliases are enabled: point your inbound-mail provider's webhook at `POST /api/inbound-email`
- search-API credentials (`BRAVE_SEARCH_API_KEY`, `GOOGLE_CSE_*`), and `SEARCH_PROVIDERS=brave,google`

## Scheduled work

The worker registers repeatable BullMQ jobs at start-up. No external cron is needed.

| Job | Interval |
|---|---|
| `MonitoringTick`: due re-checks and re-scans, resuming waiting workflows, safety net for lost verifications | 1 minute |
| `RetentionSweep` | 1 hour |
| `ProviderHealthJob`: circuit breaker | 15 minutes |

## Observability

- **Logs:** structured JSON (pino) with PII redaction. Ship them to your log platform.
- **Health endpoints:** `/healthz` (liveness) and `/readyz` (database).
- **Failures:** jobs that permanently fail are written to `failed_jobs` with opaque ids only, and appear in the admin console.
- **Error tracking:** add an adapter (for example Sentry) around `app.setErrorHandler` in `backend/src/http/app.ts` and the worker's `failed` handler. Do not attach request bodies.

## Portability

The only infrastructure dependencies are PostgreSQL, Redis, SMTP and, optionally, an S3-compatible store (implement `ObjectStorage` in `backend/src/infra/storage.ts`). Hosting providers can be swapped freely.

## Billing

`POST /api/billing/change-plan` only works with `BILLING_MODE=dev`. For production, integrate a payment provider's hosted checkout and webhook, and update `users.plan` from the webhook. Plan entitlements live in `core/abuse.ts#PLANS`.
