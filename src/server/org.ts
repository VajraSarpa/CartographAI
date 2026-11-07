import "server-only";
import { adminDb } from "./supabase";

export interface OrgSession {
  userId: string;
  orgId: string;
  orgName: string;
}

/** Mirror the Clerk organization into the database (FK target for every row). */
export async function ensureOrgRow(s: OrgSession): Promise<void> {
  const { error } = await adminDb()
    .from("organizations")
    .upsert({ id: s.orgId, name: s.orgName }, { onConflict: "id" });
  if (error) throw new Error(`Could not record organization: ${error.message}`);
}
