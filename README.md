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

Prerequisites: Node 22+, PostgreSQL 16, Redis 7.

```bash
npm install
(cd frontend && npm install) && (cd admin && npm install)

cp .env.example .env
npm run keys:generate        # paste the output into .env
# For a local demo you may also set REQUIRE_EMAIL_VERIFICATION=false and BILLING_MODE=dev

npm run db:migrate
npm run db:seed              # loads providers/registry into the database

npm run dev:mock-broker      # fake data broker on :4545 (for the ExampleBroker agent)
npm run dev:api              # API on :4000
npm run dev:worker           # background jobs
npm run dev:web              # user app on :3000
npm run dev:admin            # admin console on :3001
```

With `SEARCH_PROVIDERS=fixture` and `SEARCH_FIXTURE_FILE=providers/search/fixtures.dev.json`, you can sign up and add the name **John Example**, email `john@example.com`, phone `(555) 555-1234` and location `Boca Raton, FL`. A scan then produces a realistic set of exposures: a broker listing, a mirror site, a directory, a GitHub profile and a news article, which is flagged as public interest.

In the mock environment, emails are logged rather than sent (`MAIL_TRANSPORT=log`). To make yourself an administrator, run `UPDATE users SET role = 'admin' WHERE id = '…'`. The admin console then walks you through TOTP enrolment.

Or run everything with Docker:

```bash
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
