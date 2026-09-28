"use client";

import { useEffect, useState } from "react";
import { IdentifierEditor } from "@/components/IdentifierEditor";
import { Card, ErrorNote, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

type Tab = "identities" | "removals" | "notifications" | "data";

export default function SettingsPage() {
  const { profile, me, refresh, logout } = useSession();
  const [tab, setTab] = useState<Tab>("identities");
  const [err, setErr] = useState<Error | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ notify_email: boolean; notify_push: boolean; notify_in_app: boolean; record_retention_days: number } | null>(null);
  const [del, setDel] = useState({ password: "", confirm: "" });

  useEffect(() => {
    api<{ settings: typeof settings }>("/settings").then((r) => setSettings(r.settings)).catch(() => undefined);
  }, []);

  if (!profile || !me) return <Spinner />;

  async function patchProfile(body: Record<string, unknown>) {
    setErr(null);
    setOk(null);
    try {
      await api(`/profile/${profile!.id}`, { method: "PATCH", body });
      await refresh();
      setOk("Saved.");
    } catch (e) {
      setErr(e as Error);
    }
  }
  async function saveSettings() {
    if (!settings) return;
    setErr(null);
    try {
      await api("/settings", {
        method: "PUT",
        body: { notifyEmail: settings.notify_email, notifyPush: settings.notify_push, notifyInApp: settings.notify_in_app, recordRetentionDays: settings.record_retention_days },
      });
      setOk("Saved.");
    } catch (e) {
      setErr(e as Error);
    }
  }
  async function deleteAccount() {
    setErr(null);
    try {
      await api("/account", { method: "DELETE", body: { password: del.password, confirm: del.confirm } });
      await logout();
    } catch (e) {
      setErr(e as Error);
    }
  }

  const paid = me.plan !== "FREE";
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => { setTab(t); setOk(null); setErr(null); }}
        tabs={[
          { id: "identities", label: "My identities" },
          { id: "removals", label: "Removal preferences" },
          { id: "notifications", label: "Notifications" },
          { id: "data", label: "Your data" },
        ]}
      />
      <ErrorNote error={err} />
      {ok && <div className="notice ok" style={{ marginBottom: 12 }}>{ok}</div>}

      {tab === "identities" && (
        <Card title="My identities">
          <p className="small muted">Sensitive values are encrypted and shown masked. Revealing one is logged. Deleting an identifier removes it permanently.</p>
          <IdentifierEditor profileId={profile.id} identifiers={profile.identifiers} onChange={() => void refresh()} />
        </Card>
      )}

      {tab === "removals" && (
        <Card title="Default approval mode">
          <div className="stack">
            {[
              { id: "AUTOMATIC", label: "Automatic", body: "Submit supported, low-risk opt-outs automatically after your blanket authorization.", disabled: !paid },
              { id: "APPROVAL_REQUIRED", label: "Approval required", body: "Prepare every request and wait for your approval." },
              { id: "MANUAL", label: "Manual", body: "Only identify results and give instructions." },
            ].map((o) => (
              <label key={o.id} className="check" style={{ opacity: o.disabled ? 0.6 : 1 }}>
                <input type="radio" name="mode" disabled={o.disabled} checked={profile.defaultApprovalMode === o.id} onChange={() => void patchProfile({ defaultApprovalMode: o.id })} />
                <span><strong>{o.label}</strong><br /><span className="small muted">{o.body}</span></span>
              </label>
            ))}
            <div className="divider" />
            <label className="check">
              <input type="checkbox" disabled={!paid} checked={profile.blanketAuthorization} onChange={(e) => void patchProfile({ blanketAuthorization: e.target.checked })} />
              <span>
                <strong>Blanket authorization</strong><br />
                <span className="small muted">Allow automatic submission to supported providers for strong matches. Weak matches always need your confirmation. Revoke any time.</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!profile.relayEmail} onChange={(e) => void patchProfile({ useRelayEmail: e.target.checked })} />
              <span>
                <strong>Private relay address</strong>{profile.relayEmail && <span className="mono small"> · {profile.relayEmail}</span>}<br />
                <span className="small muted">Providers send confirmations to a relay address so they never receive your real email, and we can confirm opt-outs for you.</span>
              </span>
            </label>
            <p className="small faint">You can override the mode per provider on the Sources page.</p>
          </div>
        </Card>
      )}

      {tab === "notifications" && settings && (
        <Card title="Notifications">
          <div className="stack">
            <label className="check"><input type="checkbox" checked={settings.notify_in_app} onChange={(e) => setSettings({ ...settings, notify_in_app: e.target.checked })} /> In-app</label>
            <label className="check"><input type="checkbox" checked={settings.notify_email} onChange={(e) => setSettings({ ...settings, notify_email: e.target.checked })} /> Email</label>
            <label className="check"><input type="checkbox" checked={settings.notify_push} onChange={(e) => setSettings({ ...settings, notify_push: e.target.checked })} /> Push (on supported browsers)</label>
            <p className="small faint">Notifications never include your identifiers or the addresses of listings.</p>
            <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => void saveSettings()}>Save</button>
          </div>
        </Card>
      )}

      {tab === "data" && settings && (
        <>
          <Card title="Retention">
            <label className="field" style={{ maxWidth: 320 }}>
              Keep details of removed or dismissed results for (days)
              <input className="input" type="number" min={30} max={3650} value={settings.record_retention_days} onChange={(e) => setSettings({ ...settings, record_retention_days: Number(e.target.value) })} />
            </label>
            <p className="small faint">Temporary verification documents are always deleted within 24 hours.</p>
            <button className="btn" onClick={() => void saveSettings()}>Save</button>
          </Card>
          <Card title="Export">
            <p className="small muted">Download everything we hold about your account as JSON.</p>
            <a className="btn" href="/api/account/export">Export my data</a>
          </Card>
          <Card title="Delete account">
            <p className="small muted">Permanently deletes your account, profiles, identifiers, exposures and request history. This cannot be undone. Requests already sent to providers are not recalled.</p>
            <div className="stack" style={{ maxWidth: 360 }}>
              <input className="input" type="password" placeholder="Password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />
              <input className="input" placeholder='Type "DELETE" to confirm' value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} />
              <button className="btn danger" disabled={del.confirm !== "DELETE" || !del.password} onClick={() => void deleteAccount()}>Permanently delete account</button>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
