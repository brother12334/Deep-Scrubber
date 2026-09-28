# Workflow engine

`removal-agents/engine/` interprets declarative, versioned workflows (`WorkflowDefinitionSchema`). It saves progress after every step, so a run can pause for a person, wait for time to pass, or resume after a crash.

## Step types

| Type | Behaviour |
|---|---|
| `OPEN_URL` | GET a page. 404/410 fails with `PAGE_NOT_FOUND`. Remembers the URL as the form page |
| `SEARCH` | GET `url` with `query` params and collect links matching `resultSelector` into `secure[storeAs]` |
| `SELECT_RESULT` | Pick the result whose canonical URL equals the record's URL. If none matches, returns `NOT_FOUND_AT_SOURCE`, which triggers verification rather than failure |
| `FILL_FIELD` | Checks the field exists on the live form, then stores the value's *template* (never the resolved PII) |
| `USER_CONFIRMATION` | Pauses for approval unless the request was already approved or blanket-authorized (`skipWhenPreAuthorized`) |
| `UPLOAD_USER_PROVIDED_DOCUMENT` | Always pauses and offers "continue manually" or "skip". Documents are never collected by default |
| `SUBMIT` | Re-opens the form if needed (fresh CSRF token), resolves templates and posts. Requires `successPattern`. Extracts `confirmationPattern` and detects `emailVerificationPattern` |
| `SEND_EMAIL` | Sends the user-approved request text to the provider's privacy contact, with Reply-To set to the user's contact address |
| `WAIT_FOR_EMAIL` | Pauses for the user to click a verification email |
| `VERIFY_EMAIL` | With a relay alias, polls the relay inbox and follows the confirmation link, but only if it points at the source's own domain. Otherwise it pauses for the user |
| `WAIT` | Resumes after `minutes` or `days` |
| `CHECK_STATUS` | GET a status URL and record whether the source reports completion |
| `VERIFY_REMOVAL` | Runs the agent's verification inline |

Any step can have `"when": "context.someFlag"`. It is skipped when the flag is falsy.

## Templates

`{{base}}`, `{{sourceDomain}}`, `{{record.url}}`, `{{subject.name|firstName|lastName|city|region|email|contactEmail|phone}}`, `{{context.*}}`, `{{secure.*}}`.

Only dot-paths are allowed. There are no expressions and no code execution. A missing value fails the step with `MISSING_DATA` rather than submitting blanks.

## State & privacy

- `removal_workflows.context` stores plain, non-personal state: cookies, the form URL, the confirmation reference and flags.
- Anything derived from personal data, such as the selected profile URL or search results, goes in `secure`. It is saved encrypted as `context.__secure`.
- Subject values are resolved in memory at run time from the decrypted profile.

## Safety properties

- **Human verification:** CAPTCHA, Turnstile and challenge markers raise `HumanVerificationRequired`. The run pauses with a `HUMAN_VERIFICATION` action offering "continue manually".
- **No duplicate submissions:** before a `SUBMIT` or `SEND_EMAIL` step, the engine checks for an earlier attempt that started but never finished. If it finds one, it fails with `SUBMISSION_STATE_UNKNOWN`, which is not retryable and goes to manual review.
- **Layout changes:** these fail fast with `LAYOUT_CHANGED`, which is not retryable and counts toward provider health.
- **Transient errors:** HTTP 5xx, 429 and network errors are retryable, and the job queue backs off exponentially.
- **Step budget:** 60 steps per run, as a guard against looping definitions.
- **Network safety:** all HTTP goes through `security/ssrf.ts#safeFetch`.

## Outcomes → request status

| Engine outcome | Request status |
|---|---|
| `COMPLETED` | `AWAITING_VERIFICATION`, with a VerificationJob scheduled after the provider's estimated removal time |
| `PAUSED_FOR_USER` | `REQUIRES_USER_ACTION` plus an ACTION REQUIRED card. `resume: next` continues the workflow; `resume: manual` means the user finishes the process themselves |
| `WAITING` | `APPROVED`. `MonitoringTick` resumes it at `resume_at` |
| `FAILED` (retryable) | Retried with backoff, up to 4 attempts |
| `FAILED` (final) | `FAILED`, plus a `failed_jobs` row, a user notification and a provider-health event |
