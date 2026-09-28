"use client";

import Link from "next/link";
import { Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface N { id: string; kind: string; severity: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }
const TONE: Record<string, string> = { success: "green", info: "blue", warning: "amber", critical: "red" };

export default function NotificationsPage() {
  const n = useApi<{ notifications: N[] }>("/notifications", { scoped: false });
  async function readAll() {
    await api("/notifications/read-all", { body: {} });
    await n.reload();
  }
  return (
    <>
      <PageHeader title="Notifications" actions={<button className="btn sm" onClick={() => void readAll()}>Mark all read</button>} />
      <Card>
        {!n.data ? (
          <Spinner />
        ) : n.data.notifications.length === 0 ? (
          <Empty title="No notifications" />
        ) : (
          <div className="list">
            {n.data.notifications.map((x) => (
              <div key={x.id} className="list-item" style={{ opacity: x.read_at ? 0.65 : 1 }}>
                <span className={`badge ${TONE[x.severity] ?? "gray"}`}>{x.kind.replace(/_/g, " ").toLowerCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 550 }}>{x.link ? <Link href={x.link} style={{ color: "inherit" }}>{x.title}</Link> : x.title}</div>
                  <div className="small muted">{x.body}</div>
                </div>
                <div className="spacer" />
                <span className="small faint">{fmtRelative(x.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
