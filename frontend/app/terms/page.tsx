import type { Metadata } from "next";
import { SiteChrome } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Terms of service" };

export default function Terms() {
  return (
    <SiteChrome>
      <article className="prose">
        <div className="notice warn">
          <strong>Placeholder.</strong> These terms are a template and must be reviewed by qualified counsel before launch.
        </div>
        <h1>Terms of service</h1>
        <p className="muted">Last updated: [DATE]</p>
        <h2>1. What the service does</h2>
        <p>
          Deep Scrubber finds where your information is publicly exposed and automates legitimate removal and opt-out processes wherever
          possible. We do not and cannot guarantee that any information will be removed from the internet, from a particular website, or from
          search results.
        </p>
        <h2>2. Authorized use only</h2>
        <p>You may only create profiles for yourself, or for a person who has explicitly authorized you to act on their behalf. You must not use the service to:</p>
        <ul>
          <li>suppress or remove information about another person without their authorization;</li>
          <li>submit false, misleading or fraudulent removal requests;</li>
          <li>remove lawful public-interest information merely because it is unfavorable;</li>
          <li>attempt to bypass website security, authentication, CAPTCHAs, rate limits or other access controls.</li>
        </ul>
        <p>We may suspend accounts that violate these rules and cancel pending requests.</p>
        <h2>3. Your authorization</h2>
        <p>
          When you choose Automatic mode and grant blanket authorization, you authorize us to submit opt-out requests on your behalf to supported
          providers for strong matches. You can revoke this at any time. Weak or ambiguous matches always require your confirmation.
        </p>
        <h2>4. Not legal advice</h2>
        <p>Information about potential privacy rights or removal pathways is general information, not legal advice.</p>
        <h2>5. Subscriptions</h2>
        <p>[Billing, renewal, cancellation and refund terms.]</p>
        <h2>6. Liability</h2>
        <p>[Limitation of liability, warranties disclaimer, governing law.]</p>
      </article>
    </SiteChrome>
  );
}
