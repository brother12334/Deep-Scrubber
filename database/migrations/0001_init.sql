-- Deep Scrubber core schema.
-- Conventions:
--   * *_ciphertext columns hold AES-256-GCM field-encrypted values (see security/crypto.ts).
--   * *_hash columns hold keyed blind indexes (HMAC-SHA256) for equality lookups.
--   * Plaintext PII never appears in this schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_ciphertext    text NOT NULL,
  email_hash          text NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan                text NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'FAMILY', 'BUSINESS')),
  email_verified_at   timestamptz,
  mfa_secret_ciphertext text,
  mfa_enabled_at      timestamptz,
  terms_accepted_at   timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  csrf_token    text NOT NULL,
  mfa_verified  boolean NOT NULL DEFAULT false,
  ip_hash       text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE email_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE user_settings (
  user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notify_email            boolean NOT NULL DEFAULT true,
  notify_push             boolean NOT NULL DEFAULT false,
  notify_in_app           boolean NOT NULL DEFAULT true,
  record_retention_days   integer NOT NULL DEFAULT 365 CHECK (record_retention_days BETWEEN 30 AND 3650),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_hash         text NOT NULL UNIQUE,
  subscription_ciphertext text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Jurisdictions: privacy rights vary by region and must never be hard-coded (§23).
CREATE TABLE jurisdictions (
  code             text PRIMARY KEY,          -- e.g. 'US-CA', 'EU', 'GB'
  country          text NOT NULL,
  region           text,
  name             text NOT NULL,
  frameworks       text[] NOT NULL DEFAULT '{}',
  available_rights text[] NOT NULL DEFAULT '{}',
  mechanisms       text[] NOT NULL DEFAULT '{}',
  notes            text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE privacy_profiles (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label                      text NOT NULL,
  relationship               text NOT NULL DEFAULT 'SELF'
                               CHECK (relationship IN ('SELF', 'FAMILY_MEMBER', 'EMPLOYEE', 'COMPANY')),
  authorization_statement    text NOT NULL,
  authorization_attested_at  timestamptz NOT NULL,
  jurisdiction_code          text REFERENCES jurisdictions(code),
  default_approval_mode      text NOT NULL DEFAULT 'APPROVAL_REQUIRED'
                               CHECK (default_approval_mode IN ('AUTOMATIC', 'APPROVAL_REQUIRED', 'MANUAL')),
  blanket_authorization_at   timestamptz,
  monitoring_interval_days   integer NOT NULL DEFAULT 30 CHECK (monitoring_interval_days BETWEEN 1 AND 180),
  monitoring_enabled         boolean NOT NULL DEFAULT true,
  -- Optional service-managed relay address brokers can send confirmations to.
  relay_alias_ciphertext     text,
  relay_alias_hash           text UNIQUE,
  flagged_for_review         boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX privacy_profiles_user_idx ON privacy_profiles(user_id);

CREATE TABLE identifiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  type              text NOT NULL,
  value_ciphertext  text NOT NULL,
  value_hash        text NOT NULL,
  display_hint      text NOT NULL,
  is_previous       boolean NOT NULL DEFAULT false,
  verified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, type, value_hash)
);
CREATE INDEX identifiers_hash_idx ON identifiers(type, value_hash);

-- Central registry of supported data sources (§5).
CREATE TABLE data_sources (
  id                              text PRIMARY KEY,
  name                            text NOT NULL,
  domain                          text NOT NULL UNIQUE,
  categories                      text[] NOT NULL,
  discovery_methods               text[] NOT NULL,
  removal_methods                 text[] NOT NULL,
  requires_user_verification      boolean NOT NULL DEFAULT false,
  requires_email_verification     boolean NOT NULL DEFAULT false,
  requires_identity_verification  boolean NOT NULL DEFAULT false,
  estimated_removal_days          integer NOT NULL DEFAULT 14,
  reappears_frequently            boolean NOT NULL DEFAULT false,
  supported_regions               text[] NOT NULL DEFAULT '{*}',
  automation_status               text NOT NULL,
  agent_key                       text NOT NULL DEFAULT 'manual',
  opt_out_url                     text,
  privacy_contact_email           text,
  parent_source_id                text REFERENCES data_sources(id),
  notes                           text,
  enabled                         boolean NOT NULL DEFAULT true,
  automation_paused               boolean NOT NULL DEFAULT false,
  automation_paused_reason        text,
  last_verified_at                timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Versioned, structured removal workflows per source (§7).
CREATE TABLE provider_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    text NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  status       text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'DISABLED')),
  definition   jsonb NOT NULL,
  changelog    text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE (source_id, version)
);
CREATE UNIQUE INDEX provider_configs_one_active ON provider_configs(source_id) WHERE status = 'ACTIVE';

-- Per-profile, per-source approval preference (§25).
CREATE TABLE source_preferences (
  profile_id     uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  source_id      text NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  approval_mode  text NOT NULL CHECK (approval_mode IN ('AUTOMATIC', 'APPROVAL_REQUIRED', 'MANUAL')),
  PRIMARY KEY (profile_id, source_id)
);

CREATE TABLE scans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  trigger      text NOT NULL CHECK (trigger IN ('USER', 'MONITORING', 'ONBOARDING')),
  status       text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  stats        jsonb NOT NULL DEFAULT '{}',
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE INDEX scans_profile_idx ON scans(profile_id, created_at DESC);

CREATE TABLE exposure_clusters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  fingerprint        text NOT NULL,
  origin_record_id   uuid,
  label              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, fingerprint)
);

CREATE TABLE discovered_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  scan_id             uuid REFERENCES scans(id) ON DELETE SET NULL,
  source_id           text REFERENCES data_sources(id) ON DELETE SET NULL,
  -- URLs and titles of people-search pages often embed names, so they are encrypted too.
  url_ciphertext      text NOT NULL,
  url_hash            text NOT NULL,
  domain              text NOT NULL,
  title_ciphertext    text,
  -- Snippets/extracted attributes contain personal data and are encrypted.
  snippet_ciphertext  text,
  attributes_ciphertext text,
  data_types          text[] NOT NULL DEFAULT '{}',
  category            text NOT NULL,
  discovery_method    text NOT NULL,
  is_search_result    boolean NOT NULL DEFAULT false,
  search_engine       text,
  search_rank         integer,
  match_confidence    numeric(4,3) NOT NULL,
  match_band          text NOT NULL,
  match_explanation   jsonb NOT NULL DEFAULT '[]',
  user_confirmed      boolean,
  status              text NOT NULL,
  status_reason       text,
  priority_score      numeric(5,2) NOT NULL DEFAULT 0,
  priority_level      text NOT NULL DEFAULT 'LOW',
  priority_factors    jsonb NOT NULL DEFAULT '[]',
  cluster_id          uuid REFERENCES exposure_clusters(id) ON DELETE SET NULL,
  parent_record_id    uuid REFERENCES discovered_records(id) ON DELETE SET NULL,
  public_interest_flag boolean NOT NULL DEFAULT false,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  removed_at          timestamptz,
  removal_outcome     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, url_hash)
);
CREATE INDEX discovered_records_profile_status_idx ON discovered_records(profile_id, status);
CREATE INDEX discovered_records_parent_idx ON discovered_records(parent_record_id);
CREATE INDEX discovered_records_cluster_idx ON discovered_records(cluster_id);

ALTER TABLE exposure_clusters
  ADD CONSTRAINT exposure_clusters_origin_fk FOREIGN KEY (origin_record_id)
  REFERENCES discovered_records(id) ON DELETE SET NULL;

CREATE TABLE removal_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  record_id           uuid NOT NULL REFERENCES discovered_records(id) ON DELETE CASCADE,
  source_id           text REFERENCES data_sources(id) ON DELETE SET NULL,
  method              text NOT NULL,
  pathway             text NOT NULL,
  pathway_confidence  text NOT NULL,
  pathway_rationale   text NOT NULL,
  status              text NOT NULL,
  approval_mode       text NOT NULL,
  recipient           text,
  request_subject     text,
  request_body_ciphertext text,
  approved_at         timestamptz,
  approved_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at        timestamptz,
  confirmation_ref    text,
  attempt_count       integer NOT NULL DEFAULT 0,
  next_check_at       timestamptz,
  user_action         jsonb,
  last_error          text,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX removal_requests_profile_idx ON removal_requests(profile_id, status);
CREATE INDEX removal_requests_source_idx ON removal_requests(source_id, created_at DESC);
CREATE UNIQUE INDEX removal_requests_one_open_per_record ON removal_requests(record_id)
  WHERE status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE removal_workflows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL UNIQUE REFERENCES removal_requests(id) ON DELETE CASCADE,
  source_id            text REFERENCES data_sources(id) ON DELETE SET NULL,
  provider_config_id   uuid REFERENCES provider_configs(id) ON DELETE SET NULL,
  definition_version   integer NOT NULL,
  state                text NOT NULL,
  current_step         integer NOT NULL DEFAULT 0,
  -- Non-sensitive scratch state only (page refs, form tokens); PII is resolved at run time.
  context              jsonb NOT NULL DEFAULT '{}',
  resume_at            timestamptz,
  paused_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX removal_workflows_resume_idx ON removal_workflows(state, resume_at);

CREATE TABLE workflow_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid NOT NULL REFERENCES removal_workflows(id) ON DELETE CASCADE,
  step_index   integer NOT NULL,
  step_id      text NOT NULL,
  type         text NOT NULL,
  status       text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PAUSED', 'WAITING', 'FAILED', 'SKIPPED')),
  attempt      integer NOT NULL DEFAULT 1,
  output       jsonb NOT NULL DEFAULT '{}',
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX workflow_steps_workflow_idx ON workflow_steps(workflow_id, step_index);

CREATE TABLE verification_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    uuid NOT NULL REFERENCES discovered_records(id) ON DELETE CASCADE,
  request_id   uuid REFERENCES removal_requests(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('POST_SUBMISSION', 'MONITORING', 'DOWNSTREAM')),
  found        boolean,
  outcome      text NOT NULL,
  method       text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}',
  checked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_checks_record_idx ON verification_checks(record_id, checked_at DESC);

CREATE TABLE monitoring_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  record_id        uuid REFERENCES discovered_records(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('RECORD_RECHECK', 'PROFILE_RESCAN')),
  schedule_step    integer NOT NULL DEFAULT 0,
  interval_days    integer,
  next_run_at      timestamptz NOT NULL,
  last_run_at      timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitoring_jobs_due_idx ON monitoring_jobs(active, next_run_at);
CREATE UNIQUE INDEX monitoring_jobs_one_rescan ON monitoring_jobs(profile_id) WHERE kind = 'PROFILE_RESCAN';
CREATE UNIQUE INDEX monitoring_jobs_one_per_record ON monitoring_jobs(record_id) WHERE kind = 'RECORD_RECHECK';

CREATE TABLE privacy_score_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  score       integer NOT NULL,
  factors     jsonb NOT NULL,
  counts      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX privacy_score_profile_idx ON privacy_score_snapshots(profile_id, created_at DESC);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  uuid REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  severity    text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

-- Temporary, user-provided verification documents (§8). Deleted by the retention sweeper.
CREATE TABLE temp_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id   uuid NOT NULL REFERENCES removal_requests(id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX temp_documents_expiry_idx ON temp_documents(expires_at);

-- Append-only audit trail. actor/target ids are kept; payloads must not contain PII.
CREATE TABLE audit_logs (
  id              bigserial PRIMARY KEY,
  actor_user_id   uuid,
  actor_type      text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'worker')),
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  metadata        jsonb NOT NULL DEFAULT '{}',
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs(action, created_at DESC);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- Provider health events (§28).
CREATE TABLE provider_health_events (
  id           bigserial PRIMARY KEY,
  source_id    text NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('RUN_SUCCEEDED', 'RUN_FAILED', 'AUTO_PAUSED', 'RESUMED', 'SYNTHETIC_CHECK')),
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_health_source_idx ON provider_health_events(source_id, created_at DESC);

CREATE TABLE abuse_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_contact_ciphertext text,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  category        text NOT NULL,
  description     text NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'ACTIONED', 'DISMISSED')),
  source          text NOT NULL CHECK (source IN ('external', 'automated')),
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

-- Messages received on relay aliases (e.g. broker confirmation emails). Short-lived.
CREATE TABLE inbound_emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES privacy_profiles(id) ON DELETE CASCADE,
  from_domain      text NOT NULL,
  subject_ciphertext text NOT NULL,
  body_ciphertext  text NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  consumed_at      timestamptz
);
CREATE INDEX inbound_emails_profile_idx ON inbound_emails(profile_id, received_at DESC);

CREATE TABLE failed_jobs (
  id           bigserial PRIMARY KEY,
  queue        text NOT NULL,
  job_name     text NOT NULL,
  job_id       text,
  source_id    text,
  error        text NOT NULL,
  attempts     integer NOT NULL,
  -- Only opaque ids are stored (never decrypted identifiers).
  payload_ref  jsonb NOT NULL DEFAULT '{}',
  resolved     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
