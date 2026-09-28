"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setCsrf } from "./api";

export interface Me {
  id: string;
  role: "user" | "admin";
  plan: "FREE" | "PRO" | "FAMILY" | "BUSINESS";
  emailVerified: boolean;
  /** Server requires verification and the user hasn't verified yet. */
  mustVerifyEmail: boolean;
}

export interface Identifier {
  id: string;
  type: string;
  displayValue: string;
  masked: boolean;
  isPrevious: boolean;
}

export interface Profile {
  id: string;
  label: string;
  relationship: string;
  jurisdictionCode: string | null;
  defaultApprovalMode: "AUTOMATIC" | "APPROVAL_REQUIRED" | "MANUAL";
  blanketAuthorization: boolean;
  monitoringIntervalDays: number;
  monitoringEnabled: boolean;
  underReview: boolean;
  relayEmail: string | null;
  identifiers: Identifier[];
}

interface SessionState {
  me: Me | null;
  profiles: Profile[];
  profile: Profile | null;
  loading: boolean;
  selectProfile(id: string): void;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
const KEY = "ds.activeProfile";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me; csrfToken: string }>("/auth/me");
      setCsrf(r.csrfToken);
      setMe(r.user);
      const p = await api<{ profiles: Profile[] }>("/profile");
      setProfiles(p.profiles);
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        /* storage unavailable */
      }
      setActiveId((cur) => cur ?? (p.profiles.find((x) => x.id === stored)?.id ?? p.profiles[0]?.id ?? null));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [router, pathname]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      me,
      profiles,
      profile: profiles.find((p) => p.id === activeId) ?? null,
      loading,
      selectProfile(id) {
        setActiveId(id);
        try {
          localStorage.setItem(KEY, id);
        } catch {
          /* ignore */
        }
      },
      refresh,
      async logout() {
        await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
        setMe(null);
        router.replace("/login");
      },
    }),
    [me, profiles, activeId, loading, refresh, router],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
