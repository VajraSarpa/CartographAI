import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Two clients, two trust levels:
 * - userDb(): acts as the signed-in member. Every read goes through RLS with
 *   their Clerk session token, so the database decides what they can see.
 * - adminDb(): the secret key. Bypasses RLS. Only the pipeline and metering
 *   use it, always with an organization id taken from a verified session token.
 */

let admin: SupabaseClient | null = null;

export function adminDb(): SupabaseClient {
  const env = serverEnv();
  admin ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "cartograph-server" } },
  });
  return admin;
}

export function userDb(): SupabaseClient {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => (await (await auth()).getToken()) ?? null,
  });
}
