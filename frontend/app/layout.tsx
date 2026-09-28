import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Deep Scrubber — Personal privacy remediation", template: "%s · Deep Scrubber" },
  description:
    "We find where your information is publicly exposed and automate legitimate removal and opt-out processes wherever possible.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0b0d12", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
