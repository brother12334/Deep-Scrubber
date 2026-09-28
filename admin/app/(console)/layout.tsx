import type { ReactNode } from "react";
import { AdminShell } from "@/components/AdminShell";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
