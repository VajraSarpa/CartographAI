import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { adminDb } from "./supabase";

export interface OrgSession {
  userId: string;
  orgId: string;
  orgName: string;
}

/**
 * The signed-in member and their active organization, read from the verified
 * session token. No call to the identity provider. Redirects when missing.
 */
export async function requireOrg(): Promise<OrgSession> {
  const a = await auth();
  if (!a.userId) redirect("/sign-in");
  if (!a.orgId) redirect("/onboarding");
  const claims = a.sessionClaims as Record<string, unknown> | null;
  const orgName = typeof claims?.org_name === "string" ? claims.org_name : a.orgSlug ?? a.orgId;
  return { userId: a.userId, orgId: a.orgId, orgName };
}

/** Mirror the Clerk organization into the database (FK target for every row). */
export async function ensureOrgRow(s: OrgSession): Promise<void> {
  const { error } = await adminDb()
    .from("organizations")
    .upsert({ id: s.orgId, name: s.orgName }, { onConflict: "id" });
  if (error) throw new Error(`Could not record organization: ${error.message}`);
}
