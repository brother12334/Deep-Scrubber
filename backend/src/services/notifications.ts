import webpush from "web-push";
import type { NotificationKind, Severity } from "../../../shared/domain";
import type { AppContext } from "../context";
import { JobNames } from "../infra/queue";
import { getUserEmail } from "./users";

/**
 * Notifications (spec §24): always stored in-app, then dispatched to email
 * and web push by a NotificationJob according to the user's settings.
 * Messages never include identifiers or URLs of listings.
 */
export async function notify(
  ctx: AppContext,
  n: { userId: string; profileId?: string | null; kind: NotificationKind; severity: Severity; title: string; body: string; link?: string },
): Promise<string> {
  const row = await ctx.db.one<{ id: string }>(
    `INSERT INTO notifications (user_id, profile_id, kind, severity, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [n.userId, n.profileId ?? null, n.kind, n.severity, n.title, n.body, n.link ?? null],
  );
  await ctx.queue.enqueue(JobNames.Notification, { notificationId: row!.id });
  return row!.id;
}

export async function notifyProfileOwner(
  ctx: AppContext,
  profileId: string,
  n: { kind: NotificationKind; severity: Severity; title: string; body: string; link?: string },
): Promise<void> {
  const p = await ctx.db.one<{ user_id: string }>("SELECT user_id FROM privacy_profiles WHERE id = $1", [profileId]);
  if (p) await notify(ctx, { ...n, userId: p.user_id, profileId });
}

export async function dispatchNotification(ctx: AppContext, notificationId: string): Promise<void> {
  const n = await ctx.db.one<{ user_id: string; title: string; body: string; link: string | null; severity: string }>(
    "SELECT user_id, title, body, link, severity FROM notifications WHERE id = $1",
    [notificationId],
  );
  if (!n) return;
  const s = await ctx.db.one<{ notify_email: boolean; notify_push: boolean }>("SELECT notify_email, notify_push FROM user_settings WHERE user_id = $1", [n.user_id]);
  const link = n.link ? `${ctx.cfg.PUBLIC_APP_URL}${n.link}` : `${ctx.cfg.PUBLIC_APP_URL}/dashboard`;
  if (s?.notify_email) {
    await ctx.mailer.send({ to: await getUserEmail(ctx, n.user_id), subject: n.title, text: `${n.body}\n\n${link}\n\nManage notifications: ${ctx.cfg.PUBLIC_APP_URL}/settings` });
  }
  if (s?.notify_push && ctx.cfg.VAPID_PUBLIC_KEY && ctx.cfg.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(ctx.cfg.VAPID_SUBJECT, ctx.cfg.VAPID_PUBLIC_KEY, ctx.cfg.VAPID_PRIVATE_KEY);
    const subs = await ctx.db.query<{ id: string; subscription_ciphertext: string }>("SELECT id, subscription_ciphertext FROM push_subscriptions WHERE user_id = $1", [n.user_id]);
    for (const sub of subs) {
      try {
        const parsed = ctx.cipher.decryptJson<webpush.PushSubscription>(sub.subscription_ciphertext, `push:${n.user_id}`);
        await webpush.sendNotification(parsed, JSON.stringify({ title: n.title, body: n.body, url: link }));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await ctx.db.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
      }
    }
  }
}
