"use client";

import { useState } from "react";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

interface Plan { id: string; name: string; priceMonthlyUsd: number; summary: string[] }

export default function BillingPage() {
  const { me, refresh } = useSession();
  const plans = useApi<{ plans: Plan[]; disclaimer: string }>("/billing/plans", { scoped: false });
  const [err, setErr] = useState<Error | null>(null);

  async function choose(plan: string) {
    setErr(null);
    try {
      await api("/billing/change-plan", { body: { plan } });
      await refresh();
    } catch (e) {
      setErr(e as Error);
    }
  }

  return (
    <>
      <PageHeader title="Billing" subtitle={`Current plan: ${me?.plan}`} />
      <ErrorNote error={err} />
      {!plans.data ? (
        <Spinner />
      ) : (
        <div className="grid cols-4">
          {plans.data.plans.map((p) => (
            <Card key={p.id}>
              <h3>{p.name}</h3>
              <div className="stat-value">{p.id === "BUSINESS" ? "Contact us" : p.priceMonthlyUsd === 0 ? "Free" : `$${p.priceMonthlyUsd}/mo`}</div>
              <ul className="small muted" style={{ paddingLeft: 18 }}>
                {p.summary.map((s) => <li key={s}>{s}</li>)}
              </ul>
              {me?.plan === p.id ? (
                <span className="badge green">Current plan</span>
              ) : p.id === "BUSINESS" ? (
                <a className="btn sm" href="mailto:sales@example.com">Contact sales</a>
              ) : (
                <button className="btn sm primary" onClick={() => void choose(p.id)}>Switch to {p.name}</button>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="small faint" style={{ marginTop: 16 }}>{plans.data?.disclaimer}</p>
    </>
  );
}
