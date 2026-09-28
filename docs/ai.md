# AI usage

AI is used where it adds value, never as the authority. Deterministic code handles authentication, authorization, encryption, submission state, audit logs, rate limiting, deletion, billing and workflow execution.

Provider abstraction: `ai/provider.ts`.
- `AI_PROVIDER=anthropic` uses `ai/anthropic.ts`: Claude via the official SDK with structured outputs, defaulting to the `AI_MODEL=claude-opus-5` model.
- `AI_PROVIDER=none` uses deterministic fallbacks everywhere.

Any failure, refusal, truncation or schema mismatch returns `null`, and the caller falls back.

| Task | Module | Guardrails |
|---|---|---|
| Removal request drafting | `ai/request-generator.ts` | A deterministic template always exists. An AI rewrite is rejected when it contains emails, phone numbers or URLs that were not supplied, cites laws the pathway engine did not surface, uses threatening or legal-representation language, omits the listing URL, or is too long. The user previews and can edit the text before approving. |
| Result classification | `ai/classifier.ts` | Only for results the rules classify as `OTHER`. It cannot override a registry match or mark a page as user-controlled. Page text is truncated and marked as untrusted data. |
| Workflow maintenance | `ai/workflow-assist.ts` | Produces a DRAFT workflow version only. The step types and their order must be unchanged. It is never activated automatically. |
| Status explanations | `ai/explain.ts` | Deterministic text, so users are always told exactly what happened. |

Identity matching, duplicate detection and prioritization are deterministic (`core/`). They are transparent, explainable and testable. An AI suggestion can never raise a match's confidence or authorize a submission.
