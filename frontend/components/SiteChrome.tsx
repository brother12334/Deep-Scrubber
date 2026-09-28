import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className="site-nav" aria-label="Site">
        <Link href="/" className="brand" style={{ color: "var(--text)", padding: 0 }}>
          <span className="brand-mark"><Icon.shield width={15} height={15} /></span>
          Deep Scrubber
        </Link>
        <div className="spacer" />
        <Link href="/help" className="muted">How it works</Link>
        <Link href="/pricing" className="muted">Pricing</Link>
        <Link href="/login" className="muted">Log in</Link>
        <Link href="/signup" className="btn primary sm">Get started</Link>
      </nav>
      {children}
      <footer className="footer">
        <span>© {new Date().getFullYear()} Deep Scrubber</span>
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/terms">Terms of service</Link>
        <Link href="/help">Help</Link>
        <Link href="/report-abuse">Report abuse</Link>
      </footer>
    </>
  );
}
