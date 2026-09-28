# Adding a provider (data broker, directory, platform)

Adding a source never requires changes to the application core. There are three levels of integration. Pick the lowest level that works.

## Level 1: registry entry only (guided manual removal)

Create `providers/registry/sources/<id>.json`. It is validated by `providers/registry/types.ts`.

```json
{
  "id": "newbroker",
  "name": "NewBroker",
  "domain": "newbroker.com",
  "categories": ["PEOPLE_SEARCH"],
  "discoveryMethods": ["SEARCH_API"],
  "removalMethods": ["WEB_FORM"],
  "requiresUserVerification": true,
  "requiresEmailVerification": true,
  "requiresIdentityVerification": false,
  "estimatedRemovalTime": 14,
  "reappearsFrequently": true,
  "supportedRegions": ["US"],
  "automationStatus": "USER_ACTION_REQUIRED",
  "agent": "manual-guidance",
  "optOutUrl": "https://newbroker.com/opt-out",
  "notes": "Why automation is or isn't used."
}
```

Then run `npm run db:seed`. Discovery immediately attributes search results on `newbroker.com`, and its subdomains, to this source. The platform then:
- matches and prioritizes the results
- prepares step-by-step instructions
- verifies the removal after the user reports it done
- monitors for reappearance

Set `lastVerifiedAt` only after a person has confirmed the opt-out URL and process.

## Level 2: structured workflow (automated web form)

If the opt-out is an ordinary public form, with no login, CAPTCHA or identity upload, describe it as data. Add `providers/registry/workflows/<id>.v1.json`:

```json
{
  "source": "newbroker",
  "version": 1,
  "steps": [
    { "id": "open-form", "type": "OPEN_URL", "params": { "url": "{{base}}/opt-out" } },
    { "id": "fill-url", "type": "FILL_FIELD", "params": { "form": "#optout", "field": "listing", "value": "{{record.url}}" } },
    { "id": "fill-email", "type": "FILL_FIELD", "params": { "form": "#optout", "field": "email", "value": "{{subject.contactEmail}}" } },
    { "id": "confirm", "type": "USER_CONFIRMATION", "params": { "skipWhenPreAuthorized": true } },
    { "id": "submit", "type": "SUBMIT", "params": {
        "form": "#optout",
        "successPattern": "request received",
        "confirmationPattern": "Reference:\\s*(\\w+)",
        "emailVerificationPattern": "check your email" } },
    { "id": "verify-email", "type": "VERIFY_EMAIL", "when": "context.emailVerificationRequired",
      "params": { "linkPattern": "https://newbroker\\.com/confirm\\?t=\\w+", "successPattern": "confirmed" } }
  ]
}
```

Set `"agent": "workflow"` and `"automationStatus": "AUTOMATED"` in the source file, then seed. Step types and template variables are documented in [workflow-engine.md](workflow-engine.md).

Workflows are versioned in `provider_configs`. When a site changes its layout, an admin can:
- create a new DRAFT version in the admin console
- ask the AI assistant to propose one from the live form markup
- activate the new version once it is reviewed

Old versions are retained.

## Level 3: custom agent (code)

Only needed when discovery or verification is site-specific, for example a broker whose own search page should be queried. Implement `RemovalAgent` (`removal-agents/types.ts`), usually by extending `WorkflowAgent` and overriding `discover()` and/or `verifyRemoval()`. See `removal-agents/agents/example-broker.ts`. Register the agent in `removal-agents/registry.ts` and set `"agent": "<key>"`.

## Rules every integration must follow

- Use only public functionality and official opt-out mechanisms.
- Never bypass CAPTCHAs, logins, MFA, bot protection, rate limits or access restrictions. The engine pauses automatically when it detects human verification. Don't try to work around it.
- Only follow confirmation links that point back to the source's own domain. The `VERIFY_EMAIL` step enforces this.
- Send the minimum data the provider requires.
- Test the integration against a mock first. Copy the pattern in `removal-agents/example-broker/mock-server.ts` and `tests/unit/workflow-engine.test.ts`.

The provider-health circuit breaker (`backend/src/services/health.ts`) pauses automation when the recent failure rate crosses `PROVIDER_FAILURE_THRESHOLD`. While a provider is paused, affected requests fall back to guided manual removal.
