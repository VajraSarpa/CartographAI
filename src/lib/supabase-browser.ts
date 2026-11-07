"use client";

import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";

/** Browser Supabase client that authenticates as the signed-in member (RLS applies). */
export function useSupabase(): SupabaseClient | null {
  const { session, isLoaded } = useSession();
  return useMemo(() => {
    if (!isLoaded || !session) return null;
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      accessToken: async () => (await session.getToken()) ?? null,
    });
  }, [session, isLoaded]);
}
