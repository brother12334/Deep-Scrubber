import Link from "next/link";
import type { Metadata } from "next";
import { SiteChrome } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Pricing" };

const PLANS = [
  { name: "Free", price: "$0", items: ["Limited scan", "Manual removal guidance", "Verification of your own removals"] },
  { name: "Pro", price: "$12/mo", items: ["Full monitoring", "Automated removal", "Continuous rescans", "Private relay address"] },
  { name: "Family", price: "$24/mo", items: ["Up to 5 authorized profiles", "Everything in Pro"] },
  { name: "Business", price: "Contact us", items: ["Employee and company-owned information monitoring", "Requires signed authorization"] },
];

export default function Pricing() {
  return (
    <SiteChrome>
      <section className="prose" style={{ maxWidth: 1100 }}>
        <h1>Pricing</h1>
        <p className="muted">Every plan follows the same rule: legitimate processes only, and an honest account of what happened.</p>
        <div className="grid cols-4">
          {PLANS.map((p) => (
            <div key={p.name} className="card">
              <h3>{p.name}</h3>
              <div className="stat-value">{p.price}</div>
              <ul className="small muted" style={{ paddingLeft: 18 }}>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="small faint" style={{ marginTop: 16 }}>No service can guarantee removal of information from the internet.</p>
        <Link className="btn primary" href="/signup">Start free</Link>
      </section>
    </SiteChrome>
  );
}
