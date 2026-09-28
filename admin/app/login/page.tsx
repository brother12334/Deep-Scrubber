"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export default function AdminLogin() {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "mfa" | "setup">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api<{ user: { role: string; mfaEnabled: boolean } }>("/auth/login", { body: { email, password } });
      if (r.user.role !== "admin") return setErr("This account is not an administrator.");
      if (r.user.mfaEnabled) setStep("mfa");
      else {
        setSetup(await api("/auth/mfa/setup", { body: {} }));
        setStep("setup");
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api("/auth/mfa/verify", { body: { code, enable: step === "setup" } });
      router.replace("/");
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card stack">
        <h1 style={{ fontSize: "1.3rem" }}>Administrator sign-in</h1>
        {step === "password" ? (
          <form className="stack" onSubmit={login}>
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn primary">Continue</button>
          </form>
        ) : (
          <form className="stack" onSubmit={verify}>
            {step === "setup" && setup && (
              <div className="notice small">
                Multi-factor authentication is required for administrators. Add this secret to your authenticator app:
                <div className="mono" style={{ wordBreak: "break-all", marginTop: 6 }}>{setup.secret}</div>
              </div>
            )}
            <input className="input" inputMode="numeric" pattern="\d{6}" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button className="btn primary">Verify</button>
          </form>
        )}
        {err && <div className="error-text">{err}</div>}
      </div>
    </div>
  );
}
