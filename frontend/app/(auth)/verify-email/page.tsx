"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";

function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!token) {
      setState("error");
      setMsg("Missing verification token.");
      return;
    }
    api("/auth/verify-email", { body: { token } })
      .then(() => setState("ok"))
      .catch((e: Error) => {
        setState("error");
        setMsg(e.message);
      });
  }, [token]);
  return (
    <div className="card stack">
      <h1 style={{ fontSize: "1.4rem" }}>Email verification</h1>
      {state === "pending" && <p className="muted">Verifying…</p>}
      {state === "ok" && (
        <>
          <div className="notice ok">Your email is verified.</div>
          <Link className="btn primary" href="/onboarding">Continue</Link>
        </>
      )}
      {state === "error" && <div className="notice err">{msg}</div>}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
