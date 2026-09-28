"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/providers", label: "Providers" },
  { href: "/jobs", label: "Failed jobs" },
  { href: "/abuse", label: "Abuse reports" },
  { href: "/audit", label: "Audit log" },
];

/**
 * Admin chrome. Access requires role=admin and a verified MFA session; the API
 * enforces this — the UI only routes to the login/MFA screen.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api("/admin/metrics")
      .then(() => setReady(true))
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.code === "MFA_REQUIRED" || e.status === 403)) router.replace("/login");
      });
    // The CSRF token comes from /auth/me.
    api("/auth/me").catch(() => undefined);
  }, [router]);

  if (!ready) return <div className="auth-wrap muted">Checking access…</div>;
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Admin">
        <div className="brand"><span className="brand-mark">A</span>Admin console</div>
        <div className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={(n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </div>
        <div className="spacer" />
        <p className="small faint" style={{ padding: "0 10px" }}>
          Admin views show operational data only — never users&apos; identifiers, listing URLs or request contents.
        </p>
        <button className="btn ghost sm" onClick={() => api("/auth/logout", { body: {} }).finally(() => router.replace("/login"))}>Log out</button>
      </nav>
      <main className="content fade-in">{children}</main>
    </div>
  );
}
