import type { AppContext } from "../context";
export { listIdentifiers, listProfiles } from "./profiles";

/** Decrypt all identifiers of a profile for the owner's data export. */
export async function revealIdentifierValues(ctx: AppContext, profileId: string) {
  const rows = await ctx.db.query<{ type: string; value_ciphertext: string; is_previous: boolean }>(
    "SELECT type, value_ciphertext, is_previous FROM identifiers WHERE profile_id = $1 ORDER BY type",
    [profileId],
  );
  return rows.map((r) => ({ type: r.type, value: ctx.cipher.decrypt(r.value_ciphertext, `identifier:${profileId}`), isPrevious: r.is_previous }));
}
