import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { OrgSession } from "./org";

export { ensureOrgRow, type OrgSession } from "./org";

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
