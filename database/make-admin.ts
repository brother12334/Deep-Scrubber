import { closeContext, createContext } from "../backend/src/context";
import { MemoryJobQueue } from "../backend/src/infra/queue";
import { emailHash } from "../backend/src/services/users";
import { MemoryRateLimiter } from "../security/rate-limit";

/** Promote an existing account to administrator: npm run make-admin -- you@example.com */
const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}
const ctx = createContext({ queue: new MemoryJobQueue(), rateLimiter: new MemoryRateLimiter() });
ctx.db
  .one<{ id: string }>("UPDATE users SET role = 'admin' WHERE email_hash = $1 RETURNING id", [emailHash(ctx, email)])
  .then(async (row) => {
    if (!row) {
      console.error("No account with that email. Sign up in the web app first.");
      process.exitCode = 1;
      return;
    }
    await ctx.db.query(
      "INSERT INTO audit_logs (actor_type, action, target_type, target_id) VALUES ('system', 'admin.promoted', 'user', $1)",
      [row.id],
    );
    console.log("Promoted to admin. Sign in at the admin console; you'll be asked to set up two-factor authentication.");
  })
  .finally(() => closeContext(ctx));
