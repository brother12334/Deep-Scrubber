"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IdentifierEditor } from "@/components/IdentifierEditor";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { SessionProvider, useSession } from "@/lib/session";

function Onboarding() {
  const { me, profiles, profile, loading, refresh } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [jurisdictions, setJurisdictions] = useState<Array<{ code: string; name: string }>>([]);
  const [form, setForm] = useState({ label: "Me", relationship: "SELF", jurisdictionCode: "", statement: "", attest: false });
  const [prefs, setPrefs] = useState({ mode: "APPROVAL_REQUIRED", blanket: false, relay: false });
  const [error, setError] = useState<string | null>(null);
  const paid = me?.plan !== "FREE";

  useEffect(() => {
    api<{ jurisdictions: Array<{ code: string; name: string }> }>("/jurisdictions").then((r) => setJurisdictions(r.jurisdictions)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!loading && profiles.length > 0 && step === 0) setStep(1);
  }, [loading, profiles.length, step]);

  if (loading || !me) return <div className="auth-wrap"><Spinner /></div>;

  async function createProfile() {
    setError(null);
    try {
      await api("/profile", {
        body: {
          label: form.label,
          relationship: form.relationship,
          authorizationStatement: form.statement || "I am requesting removal of my own personal information.",
          attest: form.attest,
          jurisdictionCode: form.jurisdictionCode || null,
        },
      });
      await refresh();
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function savePrefs() {
    if (!profile) return;
    setError(null);
    try {
      await api(`/profile/${profile.id}`, {
        method: "PATCH",
        body: { defaultApprovalMode: prefs.mode, blanketAuthorization: prefs.mode === "AUTOMATIC" ? prefs.blanket : false, useRelayEmail: prefs.relay },
      });
      await refresh();
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function startScan() {
    setError(null);
    try {
      await api(`/scans?profileId=${profile?.id}`, { body: {} });
      router.replace("/scan");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const hasName = profile?.identifiers.some((i) => i.type === "FULL_NAME");
  return (
    <div className="prose fade-in" style={{ maxWidth: 720 }}>
      <div className="row between">
        <h1>Set up your privacy profile</h1>
        <span className="muted small">Step {step + 1} of 4</span>
      </div>
      <div className="bar" style={{ marginBottom: 24 }}><span style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>

      {step === 0 && (
        <div className="card stack">
          <h2>Who is this profile for?</h2>
          <p className="muted">Deep Scrubber only acts on information about you, or someone who has authorized you to act for them.</p>
          <label className="field">
            Profile name
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="field">
            Relationship
            <select className="input" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
              <option value="SELF">This is me</option>
              <option value="FAMILY_MEMBER" disabled={me.plan !== "FAMILY"}>A family member who authorized me (Family plan)</option>
            </select>
          </label>
          <label className="field">
            Where do you live? (privacy rights vary by region)
            <select className="input" value={form.jurisdictionCode} onChange={(e) => setForm({ ...form, jurisdictionCode: e.target.value })}>
              <option value="">Prefer not to say</option>
              {jurisdictions.map((j) => (
                <option key={j.code} value={j.code}>{j.name}</option>
              ))}
            </select>
          </label>
          {form.relationship !== "SELF" && (
            <label className="field">
              How were you authorized?
              <textarea className="input" style={{ minHeight: 90 }} value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={form.attest} onChange={(e) => setForm({ ...form, attest: e.target.checked })} />
            <span>
              I confirm this profile describes me, or a person who has explicitly authorized me to manage their information. I will not
              use Deep Scrubber to suppress information about anyone else.
            </span>
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={!form.attest} onClick={() => void createProfile()}>Continue</button>
          </div>
        </div>
      )}

      {step === 1 && profile && (
        <div className="card stack">
          <h2>Your identifiers</h2>
          <p className="muted">
            Add what you&apos;d like us to look for. Everything is encrypted. Sensitive values are masked and never shown in full unless you reveal
            them. Add only information about <strong>this person</strong>.
          </p>
          <IdentifierEditor profileId={profile.id} identifiers={profile.identifiers} onChange={() => void refresh()} compact />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={!hasName} onClick={() => setStep(2)}>Continue</button>
          </div>
        </div>
      )}

      {step === 2 && profile && (
        <div className="card stack">
          <h2>How should we handle removals?</h2>
          {[
            { id: "AUTOMATIC", title: "Automatic", body: "We submit supported, low-risk opt-outs as soon as we find a strong match.", disabled: !paid },
            { id: "APPROVAL_REQUIRED", title: "Approval required", body: "We prepare every request; you review and approve each one.", disabled: false },
            { id: "MANUAL", title: "Manual", body: "We only find results and give you step-by-step instructions.", disabled: false },
          ].map((o) => (
            <label key={o.id} className="check card flat" style={{ padding: 14, opacity: o.disabled ? 0.6 : 1 }}>
              <input type="radio" name="mode" disabled={o.disabled} checked={prefs.mode === o.id} onChange={() => setPrefs({ ...prefs, mode: o.id })} />
              <span>
                <strong>{o.title}</strong>
                {o.disabled && <span className="badge gray plain" style={{ marginLeft: 8 }}>Pro</span>}
                <br />
                <span className="muted small">{o.body}</span>
              </span>
            </label>
          ))}
          {prefs.mode === "AUTOMATIC" && (
            <label className="check">
              <input type="checkbox" checked={prefs.blanket} onChange={(e) => setPrefs({ ...prefs, blanket: e.target.checked })} />
              <span>
                I authorize Deep Scrubber to submit opt-out requests on my behalf to supported providers when a listing strongly matches me. I can
                change this at any time. Weak matches always need my confirmation.
              </span>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={prefs.relay} onChange={(e) => setPrefs({ ...prefs, relay: e.target.checked })} />
            <span>
              Use a private relay address for provider confirmations, so brokers never receive your real email and we can confirm opt-outs for you.
            </span>
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" disabled={prefs.mode === "AUTOMATIC" && !prefs.blanket} onClick={() => void savePrefs()}>Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card stack">
          <h2>Ready to scan</h2>
          <p className="muted">
            We&apos;ll search authorized search APIs and known data-broker sites for your information, then show you exactly what we found and what we
            can do about it.
          </p>
          {me.mustVerifyEmail && <div className="notice warn">Verify your email address first — check your inbox for the link.</div>}
          {error && <div className="error-text">{error}</div>}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link className="btn ghost" href="/dashboard">Skip for now</Link>
            <button className="btn primary" disabled={me.mustVerifyEmail} onClick={() => void startScan()}>Start my first scan</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <SessionProvider>
      <Onboarding />
    </SessionProvider>
  );
}
