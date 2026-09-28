# Deep Scrubber

Deep Scrubber is a personal privacy-remediation service. It finds where a person's information is publicly exposed and automates legitimate removal and opt-out processes wherever possible. It then verifies each result and keeps monitoring for reappearance.

```
DISCOVER → MATCH → CLASSIFY → PRIORITIZE → REQUEST REMOVAL → VERIFY → MONITOR → REPEAT
```

The service only acts on information about the account holder, or about someone who has explicitly authorized them. It never bypasses CAPTCHAs, logins, rate limits or other access controls. It never claims it can erase anything from the internet. Every result ends in one of three precisely named outcomes:

| Outcome | Meaning |
|---|---|
| **Removed from source** | The page itself is gone (HTTP 404/410). |
| **Removed from search results** | A search engine stopped listing it. The page may still exist. |
| **No longer detected** | The page loads, but the person's information no longer appears on it. |

## Repository layout

| Path | What lives there |
|---|---|
| `frontend/` | Next.js user app: landing, onboarding, dashboard, exposures, removals, monitoring, sources, reports, settings, billing, help, legal placeholders |
| `admin/` | Separate Next.js admin console, MFA-gated: providers, workflow versions, failed jobs, abuse reports, audit log |
| `backend/` | Fastify API (`src/http`), service layer (`src/services`), infrastructure adapters (`src/infra`) |
| `workers/` | BullMQ worker process and job dispatch table |
| `database/` | Forward-only SQL migrations, migrator, registry seeder |
| `core/` | Pure domain engines: identity matching, extraction, classification, prioritization, privacy score, clustering, dependency graph, legal-pathway rules, abuse rules, monitoring schedule, query expansion |
| `providers/` | Data-source registry (one JSON file per source plus versioned workflows), search-API adapters, discovery engine |
| `removal-agents/` | `RemovalAgent` interface, site agents, the generic workflow engine, and the ExampleBroker mock server |
| `ai/` | LLM provider abstraction (Claude, or none), request generator with guardrails, classification assist, workflow-maintenance assist |
| `security/` | Field encryption and key ring, password hashing, TOTP, SSRF-safe fetcher, rate limiting, masking, key scripts |
| `shared/` | Domain enums, configuration schema, logger, errors |
| `tests/` | Unit and integration tests (Vitest, real PostgreSQL, mock broker) |
| `docs/` | Architecture, API, provider guide, security, retention, deployment, AI |

## Quick start (local)

Prerequisites: **Node.js 20+** and **PostgreSQL 14+**. **Redis** is optional: without it, setup switches to single-process mode, where background jobs run inside the API. That's fine for a personal install; use Redis for production. Docker users can skip ahead to the Docker section.

**On a Mac (Intel or Apple Silicon), without Homebrew:**
1. Install Node.js from the macOS installer (`.pkg`) at https://nodejs.org (the LTS version).
2. Install PostgreSQL with [Postgres.app](https://postgresapp.com). Open it and click **Initialize**.
3. Run the two commands below. Setup detects Postgres.app's default login (your Mac username, no password) automatically.

```bash
git clone <repo> && cd Deep-Scrubber
git checkout claude/automated-data-removal-service-3iij62

./scripts/setup.sh     # or: npm run setup
npm run dev            # starts everything; Ctrl+C stops it
```

`setup.sh` does the following:
- installs all three packages
- writes `.env` with freshly generated encryption keys and demo-friendly defaults
- creates the database if it's missing
- runs migrations and loads the provider registry

If your PostgreSQL user or password isn't `postgres`/`postgres`, set the connection string first:
`DATABASE_URL=postgres://USER:PASS@localhost:5432/deepscrubber ./scripts/setup.sh`.
Use `./scripts/setup.sh --strict` for production-like defaults, with email verification on and plan switching off.

`npm run dev` starts these services:

| Service | URL |
|---|---|
| User app | http://localhost:3000 |
| Admin console | http://localhost:3001 |
| API | http://localhost:4000 |
| Mock data broker | http://localhost:4545 |
| Background worker | (no URL) |

**Try it:** sign up at http://localhost:3000 and add these identifiers:
- Name: **John Example**
- Email: `john@example.com`
- Phone: `(555) 555-1234`
- City: `Boca Raton, FL`

The scan then finds a broker listing, a mirror site, a directory, a GitHub profile and a news article, which is flagged as public interest. On the Free plan every removal is guided and manual. Switch to Pro on the Billing page (allowed in demo mode) and choose *Automatic* in Settings to watch the ExampleBroker opt-out run end to end.

**Admin console:** sign up first, then run `npm run make-admin -- you@example.com` and sign in at http://localhost:3001. It asks you to enrol an authenticator app for two-factor codes.

In demo mode, emails are logged rather than sent. Set `MAIL_TRANSPORT=smtp` and `SMTP_URL` in `.env` to send real email.

### Docker

```bash
node security/scripts/generate-keys.mjs --write   # creates .env with fresh secrets
docker compose --profile dev up --build
```

## Tests

```bash
npm test                 # unit + integration (needs PostgreSQL; uses TEST_DATABASE_URL or deepscrubber_test)
npm run test:unit
npm run test:integration
npm run typecheck
```

The integration tests run the whole lifecycle through the HTTP API against a real database and the mock broker:
- sign-up
- profile creation
- discovery, matching and clustering
- automatic submission, including confirming the broker's email through the relay inbox
- verification after the provider's processing time
- downstream search-result handling
- reappearance detection and automatic re-submission
- reports, export and account deletion

They also cover:
- approval-required and manual flows
- CAPTCHA pausing
- CSRF protection and tenant isolation
- admin MFA
- abuse flags
- the provider-health circuit breaker
- the requirement that no PII appears in plaintext at rest or in admin views

## Adding a data broker

For most brokers, adding one requires no code changes. See [docs/adding-a-provider.md](docs/adding-a-provider.md).

1. Add `providers/registry/sources/<id>.json`.
2. If the opt-out is a normal web form, add `providers/registry/workflows/<id>.v1.json` and set `"agent": "workflow"`.
3. Run `npm run db:seed`. The agent is live, subject to the provider-health circuit breaker.

## Documentation

- [Architecture](docs/architecture.md)
- [API reference](docs/api.md) ([OpenAPI](docs/openapi.yaml))
- [Adding a provider](docs/adding-a-provider.md)
- [Workflow engine](docs/workflow-engine.md)
- [Security model](docs/security.md)
- [Data retention & minimisation](docs/data-retention.md)
- [AI usage](docs/ai.md)
- [Deployment](docs/deployment.md)

The privacy policy and terms of service are placeholders, rendered at `/privacy` and `/terms`. Counsel must review them before launch.
