import type { Metadata } from "next";
import { SiteChrome } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <SiteChrome>
      <article className="prose">
        <div className="notice warn">
          <strong>Placeholder.</strong> This privacy policy is a template describing how the software is designed to behave. It must be reviewed
          and completed by qualified counsel before the service is offered to the public.
        </div>
        <h1>Privacy policy</h1>
        <p className="muted">Last updated: [DATE]</p>
        <h2>Our principle</h2>
        <p>A privacy service must not become another data broker. We collect the minimum information needed to find and remove your personal information, and nothing more.</p>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Account data:</strong> your email address and a password hash.</li>
          <li><strong>Identifiers you provide:</strong> names, emails, phone numbers, usernames, locations, domains and optionally date of birth. These are encrypted with field-level encryption.</li>
          <li><strong>Discovery results:</strong> links to and excerpts of public pages that appear to be about you, encrypted at rest and purged per your retention setting.</li>
          <li><strong>Verification documents:</strong> only if a provider requires one and you choose to provide it. Deleted automatically within [24 hours].</li>
        </ul>
        <h2>How we use it</h2>
        <p>Only to discover exposure, submit the removal and opt-out requests you authorize, verify results and monitor for reappearance.</p>
        <h2>Who we share it with</h2>
        <ul>
          <li><strong>Search providers</strong> receive search queries built from your name, email, phone number and usernames. Date of birth and street addresses are never sent.</li>
          <li><strong>Data brokers and websites</strong> receive only what their official removal process requires (for example the listing URL and a contact email), and only for requests you authorized.</li>
          <li><strong>AI providers</strong> (if enabled) may process page excerpts and request drafts. [Describe provider and retention terms.]</li>
        </ul>
        <p>We never sell your information and never use it for advertising.</p>
        <h2>Your choices</h2>
        <ul>
          <li>Delete individual identifiers at any time.</li>
          <li>Export all of your data.</li>
          <li>Permanently delete your account.</li>
        </ul>
        <h2>Security</h2>
        <p>Encryption in transit and at rest, keyed blind indexes instead of plaintext lookups, minimal logging, audit trails, and administrator access that excludes personal data by default.</p>
        <h2>Contact</h2>
        <p>[privacy@example.com]</p>
      </article>
    </SiteChrome>
  );
}
