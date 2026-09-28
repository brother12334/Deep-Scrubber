"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = password.length >= 16 ? 3 : password.length >= 12 ? 2 : password.length >= 8 ? 1 : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/signup", { body: { email, password, acceptTerms: accept } });
      router.replace("/onboarding");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h1 style={{ fontSize: "1.4rem" }}>Create your account</h1>
      <p className="muted small" style={{ margin: 0 }}>
        Deep Scrubber is for removing <strong>your own</strong> information, or that of someone who has authorized you.
      </p>
      <label className="field">
        Email
        <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        Password
        <input className="input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="bar" aria-hidden><span style={{ width: `${(strength / 3) * 100}%`, background: strength >= 2 ? "var(--green)" : "var(--amber)" }} /></div>
        <span className="small faint">At least 12 characters. A passphrase works well.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
        <span>
          I agree to the <Link href="/terms">Terms of Service</Link> and have read the <Link href="/privacy">Privacy Policy</Link>.
        </span>
      </label>
      {error && <div className="error-text" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy || !accept}>{busy ? "Creating account…" : "Create account"}</button>
      <div className="small muted">
        Already have an account? <Link href="/login">Log in</Link>
      </div>
    </form>
  );
}
