import type { Metadata } from "next";
import { SiteChrome } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Help" };

const FAQ: Array<[string, string]> = [
  ["What does Deep Scrubber actually do?", "It searches authorized search APIs and the public search pages of supported data brokers for your identifiers, works out which results are really about you, and then uses each website's legitimate removal or opt-out process. It verifies each result afterwards and keeps monitoring."],
  ["Can you erase me from the internet?", "No one can honestly promise that. Some information has no removal process, some sites ignore requests, and some content is lawful public-interest material. We tell you exactly what happened with every result."],
  ["What's the difference between “removed from source”, “removed from search results” and “no longer detected”?", "Removed from source means the page itself is gone. Removed from search results means a search engine stopped listing it, but the page may still exist. No longer detected means the page still loads but your information no longer appears on it — a weaker signal we still re-check."],
  ["Why do some providers need me to do something?", "Many sites require human verification (like a CAPTCHA), email confirmation or signing in. We never bypass these. We prepare everything, pause, and tell you exactly what to do."],
  ["How do you avoid acting on someone else's listing?", "Our identity-matching engine combines your name with contact details, locations and age. A name alone is never enough. Uncertain matches wait for you to confirm “Yes, this is me” before anything is submitted."],
  ["What is a relay address?", "An optional, service-managed email address used for provider confirmations. Brokers never get your real email, and we can confirm opt-outs for you automatically."],
  ["Why did a removed listing come back?", "Data brokers regularly rebuild profiles from new data. We re-check on day 1, 3, 7, 14 and 30 after removal, then on your schedule, and alert you when something reappears."],
  ["Can I remove information about someone else?", "Only with their explicit authorization (for example on a Family plan). The service is not for suppressing information about other people."],
];

export default function Help() {
  return (
    <SiteChrome>
      <article className="prose">
        <h1>How it works</h1>
        <div className="pipeline">
          {["Discover", "Match", "Classify", "Prioritize", "Request removal", "Verify", "Monitor", "Repeat"].map((s) => <span key={s}>{s}</span>)}
        </div>
        {FAQ.map(([q, a]) => (
          <details key={q} className="card" style={{ marginBottom: 10 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{q}</summary>
            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>{a}</p>
          </details>
        ))}
      </article>
    </SiteChrome>
  );
}
