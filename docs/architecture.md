# Architecture

```
            Browser (user)                  Browser (admin, MFA)
                 │                                  │
        frontend/ (Next.js)               admin/ (Next.js)
                 │  same-origin /api rewrite        │
                 └───────────────┬──────────────────┘
                                 ▼
                     backend/ API (Fastify)
          auth · CSRF · rate limits · field-level access
                                 │
             ┌───────────────────┼────────────────────┐
             ▼                   ▼                    ▼
        PostgreSQL        Redis (BullMQ)       Encrypted object
    (encrypted fields,    job queue, rate        storage (temp
     blind indexes)        limit counters)         documents)
                                 │
                                 ▼
                         workers/ (BullMQ)
   DiscoveryJob · RemovalJob · VerificationJob · MonitoringJob ·
   SearchJob · NotificationJob · MonitoringTick · RetentionSweep ·
                         ProviderHealthJob
             │                   │                     │
             ▼                   ▼                     ▼
   providers/discovery   removal-agents/          ai/ (Claude or
   + search adapters     + workflow engine        none — advisory)
             │                   │
             └──── security/ssrf safeFetch (every outbound request) ───▶ public web
```

HTTP requests never do slow or external work. They validate input, record the user's intent, and enqueue a job. Workers do the rest and can safely retry because every handler re-reads state and claims work with conditional updates, for example `UPDATE … WHERE status = 'APPROVED'`.

## Lifecycle

| Stage | Module | Notes |
|---|---|---|
| Create profile | `backend/src/services/profiles.ts` | Requires an authorization attestation. Plan limits and abuse heuristics are applied. |
| Discover | `providers/discovery/engine.ts` | Site-specific agent searches plus controlled query expansion (`core/queries.ts`) across authorized search APIs. Result pages are fetched through the SSRF-safe client with per-host budgets. |
| Match | `core/extract.ts`, `core/matching.ts` | Likelihood-ratio model. A name alone is at most "weak". Results below 0.40 confidence are discarded, never stored. |
| Classify | `core/classification.ts` (+ `ai/classifier.ts`) | Registry lookup first. AI may add context for unknown pages but cannot override the registry. |
| Cluster & link | `core/clustering.ts`, `backend/src/services/records.ts` | One page record per URL and one child record per search-engine appearance. Mirrors are linked to their origin. |
| Prioritize | `core/prioritization.ts` | Transparent factor breakdown. Public-interest content is capped at LOW. |
| Plan removal | `backend/src/services/removals.ts#planRemoval` | Picks the pathway (`core/pathways.ts`), agent and approval mode, drafts the request (`ai/request-generator.ts`), and decides whether it may auto-submit. |
| Submit | `removal-agents/*`, `removal-agents/engine` | Runs the agent or workflow. Pauses for humans and never repeats a submission that may already have happened. |
| Verify | `backend/src/services/verification.ts` | Records precise outcomes. Escalates after repeated "still present". Cascades verification to downstream records. |
| Monitor | `backend/src/services/monitoring.ts`, `core/monitoring.ts` | Re-checks on day 1, 3, 7, 14 and 30, then every N days. Periodic re-scans. Reappearance handling. |
| Score & report | `core/scoring.ts`, `backend/src/services/reports.ts` | Score snapshots include a change explanation. Reports export as CSV and PDF. |

## Status models

- **Exposure (record):** `DISCOVERED`, `NEEDS_REVIEW`, `READY`, `AWAITING_APPROVAL`, `SUBMITTED`, `AWAITING_VERIFICATION`, `REMOVED`, `PARTIALLY_REMOVED`, `FAILED`, `REQUIRES_USER_ACTION`, `REAPPEARED`, `NO_ACTION_AVAILABLE`, `DISMISSED`
- **Removal request:** `AWAITING_APPROVAL`, `APPROVED`, `IN_PROGRESS`, `REQUIRES_USER_ACTION`, `AWAITING_VERIFICATION`, `COMPLETED`, `FAILED`, `CANCELLED`
- **Verification outcome:** `REMOVED_FROM_SOURCE`, `REMOVED_FROM_SEARCH_RESULTS`, `NO_LONGER_DETECTED`, `PARTIALLY_REMOVED`, `STILL_PRESENT`, `INCONCLUSIVE`

## Authorization rules (deterministic, in `planRemoval` and `executeRequest`)

A request is submitted without an explicit per-request approval only when all of these hold:
- The effective approval mode (per-source preference, otherwise the profile default) is `AUTOMATIC`.
- The plan includes automated removal.
- The profile has recorded blanket authorization.
- The agent reports the source as `AUTOMATED` or `SEMI_AUTOMATED`.
- The provider is not paused by the health circuit breaker.
- The profile is not flagged for abuse review.
- The match is ≥ 0.80, or the user confirmed "this is me".

Anything else becomes either `AWAITING_APPROVAL` or guided manual removal. AI output never changes these decisions.

## Data model

See `database/migrations/0001_init.sql`. The main relationships:

```
users ─┬─ sessions, user_settings, notifications, push_subscriptions
       └─ privacy_profiles ─┬─ identifiers (encrypted + blind index)
                            ├─ source_preferences
                            ├─ scans
                            ├─ exposure_clusters
                            ├─ discovered_records ─┬─ removal_requests ─┬─ removal_workflows ── workflow_steps
                            │   (parent_record_id  │                    └─ temp_documents
                            │    = dependency)     └─ verification_checks
                            ├─ monitoring_jobs
                            ├─ privacy_score_snapshots
                            └─ inbound_emails (relay alias)
data_sources ── provider_configs (versioned workflows), provider_health_events
jurisdictions, audit_logs (append-only), abuse_reports, failed_jobs
```
