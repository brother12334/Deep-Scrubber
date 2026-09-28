import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card stack fade-in">
        <Link href="/" className="brand" style={{ color: "var(--text)", justifyContent: "center" }}>
          <span className="brand-mark"><Icon.shield width={15} height={15} /></span>
          Deep Scrubber
        </Link>
        {children}
      </div>
    </div>
  );
}
