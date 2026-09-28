# Security model

## Data protection

- **Field-level encryption** (`security/crypto.ts`): AES-256-GCM with a random IV per value and a versioned key ring. The ciphertext format is `keyId.iv.tag.ct`. Each value is bound to its context with AAD (for example `identifier:<profileId>`), so ciphertexts cannot be swapped between rows or tenants.
- **What is encrypted:** identifiers, the account email, MFA secrets, relay aliases, discovered URLs, titles, snippets and extracted attributes, request bodies, workflow secure state, inbound relay mail, push subscriptions, and abuse-report contacts.
- **Blind indexes:** HMAC-SHA256 under a separate `BLIND_INDEX_KEY`, with domain separation. They support uniqueness and lookups without storing plaintext. Plaintext display hints are stored only for *masked* values, for example `••••••••42`.
- **Key rotation:**
  1. Add a new key.
  2. Switch `ENCRYPTION_ACTIVE_KEY_ID`.
  3. Run `npm run keys:rotate` (idempotent).
  4. Remove the old key.

  The blind-index key cannot be rotated in place. Rotating it would require a re-index job that decrypts each identifier and recomputes its hash.
- **Tested:** the integration suite dumps every row of the main tables and asserts that no test PII appears in plaintext.

## Authentication & sessions

- Passwords are hashed with scrypt (N=2^15, r=8, p=1, 16-byte salt) and upgraded transparently when parameters change. A minimum length of 12 is enforced.
- Sessions use opaque 256-bit tokens, stored as SHA-256 hashes, in an `HttpOnly`, `SameSite=Lax` cookie that is `Secure` in production.
- Every non-GET request needs a per-session CSRF token in `x-csrf-token`.
- Login responds with generic errors and constant-work hashing for unknown emails, is rate limited per IP, and is audited.
- Email verification is required before scans and other state changes when `REQUIRE_EMAIL_VERIFICATION=true`.
- Administrators must pass TOTP MFA (RFC 6238) in the current session before any `/api/admin` call.

## Authorization

- Every profile-scoped query filters by the owner's `user_id`. Anything owned by someone else returns 404.
- Automated submissions depend on deterministic checks. See "Authorization rules" in [architecture.md](architecture.md).
- Admin endpoints return ids, enums, counts and error codes only. A test asserts that admin responses contain no PII.

## Outbound requests (SSRF)

`security/ssrf.ts#safeFetch` is the only path for outbound page requests. It enforces:
- `http`/`https` only, no credentials in the URL, and allow-listed ports (80/443)
- no hosts such as `localhost`, `*.local`, `*.internal` or `metadata.google.internal`, single-label names, or numeric or hex IP encodings
- DNS validation: *every* resolved address must be public. Blocked ranges include RFC 1918, loopback, link-local (including `169.254.169.254`), CGNAT, the IPv6 ULA and link-local ranges, IPv4-mapped addresses, NAT64 and documentation ranges
- DNS pinning: the socket connects to the address that was validated, which defeats DNS rebinding
- manual redirect handling with re-validation of every hop (at most 3)
- a timeout, a response-size cap, a content-type allow-list, and per-host crawl budgets per job

`FETCH_ALLOWLIST_PRIVATE_HOSTS` exists only so the local mock broker can be reached in development. Configuration loading rejects it when `NODE_ENV=production`.

## Abuse prevention

- A signed authorization attestation is required for every profile. Relationships beyond `SELF` require the matching plan (Family or Business).
- **Limits:** caps on profiles, identifiers and names per plan; daily scan quotas; submission, reveal and export quotas.
- **Heuristics** (`core/abuse.ts`):
  - many unrelated surnames on one profile
  - an email or phone already claimed by another account (detected with blind indexes)
  - high identifier churn

  Flagged profiles get an automated abuse report and cannot auto-submit until an administrator clears them.
- **Data minimization:** results below a 0.40 match confidence are discarded, never stored.
- **Public-interest content:** it is detected and never prioritized for removal.
- **Reports and accountability:** a public abuse-report form feeds an admin workflow that can suspend accounts, which cancels their pending requests. There is also an append-only audit log, protected by a database trigger against updates.

## Headers & transport

- The API uses Helmet (CSP `default-src 'none'`), `Cache-Control: no-store` and a CORS allow-list.
- The web apps send a strict CSP, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, and set `nofollow noopener` on outbound links.
- TLS terminates at the load balancer. Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` behind it.

## Things this platform deliberately does not do

- It does not solve or outsource CAPTCHAs, rotate IPs, or fake browser fingerprints.
- It does not store third-party account passwords.
- It does not log in to users' accounts.
- It does not send requests about people the user has not been authorized to represent.
