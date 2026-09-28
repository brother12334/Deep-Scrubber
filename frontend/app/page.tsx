import Link from "next/link";
import { SiteChrome } from "@/components/SiteChrome";

const STEPS = ["Discover", "Match", "Classify", "Prioritize", "Request removal", "Verify", "Monitor", "Repeat"];

const FEATURES = [
  { title: "Finds exposure for you", body: "Authorized search APIs and data-broker lookups run continuously, so you never search dozens of sites by hand." },
  { title: "Knows it's really you", body: "An identity-matching engine weighs names, contact details, locations and ages. Nothing is submitted on a weak match without your confirmation." },
  { title: "Uses legitimate processes", body: "Official opt-out forms, published privacy contacts and search-engine tools. We never bypass CAPTCHAs, logins or access controls." },
  { title: "You stay in control", body: "Choose automatic, approval-required or manual mode — per provider. Every request can be previewed and edited before it's sent." },
  { title: "Verifies the result", body: "Submitting isn't enough. We re-check each source and tell you precisely whether it was removed from the source, from search results, or is simply no longer detected." },
  { title: "Watches for reappearance", body: "Brokers regenerate records. We re-check on day 1, 3, 7, 14 and 30, then on your schedule, and alert you if anything comes back." },
];

export default function Home() {
  return (
    <SiteChrome>
      <section className="hero fade-in">
        <div className="badge blue plain" style={{ marginBottom: 18 }}>Personal privacy remediation</div>
        <h1>Take your personal information back from data brokers.</h1>
        <p className="lede">
          We find where your information is publicly exposed and automate legitimate removal and opt-out processes wherever
          possible — then verify the results and keep watching.
        </p>
        <div className="pipeline" aria-label="How it works">
          {STEPS.map((s, i) => (
            <span key={s}>
              {i + 1}. {s}
            </span>
          ))}
        </div>
        <div className="row">
          <Link href="/signup" className="btn primary">Start a free scan</Link>
          <Link href="/help" className="btn">How it works</Link>
        </div>
        <p className="small faint" style={{ marginTop: 18 }}>
          No service can erase everything from the internet. We tell you exactly what happened at every stage — including when
          removal isn&apos;t possible.
        </p>
      </section>
      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h3>{f.title}</h3>
            <p className="muted" style={{ margin: 0 }}>{f.body}</p>
          </div>
        ))}
      </section>
      <section className="prose" style={{ paddingTop: 0 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Built so we don&apos;t become another data broker</h2>
          <ul className="muted">
            <li>Sensitive identifiers are encrypted at rest with field-level encryption.</li>
            <li>We never sell your information or use it for advertising.</li>
            <li>Temporary verification documents are deleted automatically.</li>
            <li>Export or permanently delete your account at any time.</li>
            <li>Only for your own information, or someone who has authorized you.</li>
          </ul>
        </div>
      </section>
    </SiteChrome>
  );
}
