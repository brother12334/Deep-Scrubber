"use client";

import { useState } from "react";
import { SiteChrome } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function ReportAbuse() {
  const [form, setForm] = useState({ category: "TARGETING_OTHERS", description: "", contact: "" });
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/abuse-reports", { body: { ...form, contact: form.contact || undefined } });
      setState("sent");
    } catch (err) {
      setState("error");
      setMsg((err as Error).message);
    }
  }
  return (
    <SiteChrome>
      <section className="prose" style={{ maxWidth: 620 }}>
        <h1>Report abuse</h1>
        <p className="muted">If you believe someone is using Deep Scrubber to target you or others, tell us. Reports are reviewed by our trust &amp; safety team.</p>
        {state === "sent" ? (
          <div className="notice ok">Thank you — your report was received.</div>
        ) : (
          <form className="card stack" onSubmit={submit}>
            <label className="field">
              Category
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="TARGETING_OTHERS">Someone is targeting other people</option>
                <option value="IMPERSONATION">Impersonation</option>
                <option value="FRAUDULENT_REQUEST">Fraudulent removal request</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="field">
              What happened?
              <textarea className="input" required minLength={20} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="field">
              Contact (optional)
              <input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </label>
            {state === "error" && <div className="error-text">{msg}</div>}
            <button className="btn primary">Send report</button>
          </form>
        )}
      </section>
    </SiteChrome>
  );
}
