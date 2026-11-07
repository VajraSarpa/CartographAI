"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function ActivateTeam({ orgId }: { orgId: string }) {
  const { setActive, loaded } = useClerk();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    setActive({ organization: orgId })
      .then(() => router.replace("/dashboard"))
      .catch((e: Error) => setError(e.message));
  }, [loaded, orgId, setActive, router]);
  return <p>{error ? `Could not activate your team: ${error}` : "Opening your team…"}</p>;
}
