"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import { Icon } from "./icons";
import { Spinner } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Icon.dashboard },
  { href: "/scan", label: "Scan", icon: Icon.scan },
  { href: "/exposures", label: "Exposures", icon: Icon.exposures },
  { href: "/removals", label: "Removals", icon: Icon.removals },
  { href: "/monitoring", label: "Monitoring", icon: Icon.monitoring },
  { href: "/sources", label: "Sources", icon: Icon.sources },
  { href: "/reports", label: "Reports", icon: Icon.reports },
];
const NAV2 = [
  { href: "/settings", label: "Settings", icon: Icon.settings },
  { href: "/billing", label: "Billing", icon: Icon.billing },
  { href: "/help", label: "Help", icon: Icon.help },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { me, profiles, profile, selectProfile, loading, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const notes = useApi<{ notifications: Array<{ read_at: string | null }> }>(me ? "/notifications" : null, { scoped: false, pollMs: 60_000 });
  const unread = notes.data?.notifications.filter((n) => !n.read_at).length ?? 0;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!loading && me && profiles.length === 0 && pathname !== "/onboarding") router.replace("/onboarding");
  }, [loading, me, profiles.length, pathname, router]);

  if (loading || !me) {
    return (
      <div className="auth-wrap">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className={`sidebar ${open ? "open" : ""}`} aria-label="Main">
        <Link href="/dashboard" className="brand" style={{ color: "var(--text)" }}>
          <span className="brand-mark"><Icon.shield width={15} height={15} /></span>
          Deep Scrubber
        </Link>
        <div className="nav">
          {NAV.map(({ href, label, icon: I }) => (
            <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}>
              <I /> {label}
            </Link>
          ))}
          <div className="nav-section">Account</div>
          {NAV2.map(({ href, label, icon: I }) => (
            <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}>
              <I /> {label}
            </Link>
          ))}
        </div>
        <div className="spacer" />
        <div className="small faint" style={{ padding: "0 10px" }}>
          We find where your information is publicly exposed and automate legitimate removal and opt-out processes wherever possible.
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost sm menu-btn" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>
            <Icon.menu />
          </button>
          {profiles.length > 1 ? (
            <select className="input" style={{ width: "auto" }} value={profile?.id ?? ""} onChange={(e) => selectProfile(e.target.value)} aria-label="Active profile">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          ) : (
            <span className="muted small">{profile?.label}</span>
          )}
          {profile?.underReview && <span className="badge amber">Under review</span>}
          <div className="spacer" />
          <Link href="/notifications" className="btn ghost sm" aria-label={`Notifications (${unread} unread)`}>
            <Icon.bell /> {unread > 0 && <span className="badge amber plain">{unread}</span>}
          </Link>
          <span className="badge gray plain">{me.plan}</span>
          <button className="btn ghost sm" onClick={() => void logout()}>Log out</button>
        </header>
        {me.mustVerifyEmail && (
          <div className="notice warn" style={{ margin: "16px 28px 0" }}>
            Please verify your email address to start scanning. Check your inbox for the verification link.
          </div>
        )}
        <main className="content fade-in">{children}</main>
      </div>
    </div>
  );
}
