import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActivateTeam } from "./ActivateTeam";

export const metadata = { title: "Setting up" };

/**
 * First landing: a member with no team gets one, created once by the server
 * ("<name>'s team"). Clerk can't do this from dashboard config. The browser
 * then makes it the active organization so the next session token carries it.
 */
async function Onboard() {
  const a = await auth();
  if (!a.userId) redirect("/sign-in");
  if (a.orgId) redirect("/dashboard");
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({ userId: a.userId, limit: 1 });
  let orgId = memberships.data[0]?.organization.id;
  if (!orgId) {
    const user = await currentUser();
    const who = user?.firstName || user?.username || "My";
    const org = await client.organizations.createOrganization({
      name: who === "My" ? "My team" : `${who}'s team`,
      createdBy: a.userId,
    });
    orgId = org.id;
  }
  return <ActivateTeam orgId={orgId} />;
}

export default function OnboardingPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-sm text-muted">
      <Suspense fallback={<p>Setting up your team…</p>}>
        <Onboard />
      </Suspense>
    </main>
  );
}
