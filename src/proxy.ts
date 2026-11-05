import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Every page requires a signed-in session except the ones below. Signed-out
 * visitors are redirected to sign-in before anything renders. Agent endpoints
 * verify their own short-lived credential instead of a Clerk session.
 */
const isPublic = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/api/agent/(.*)", "/api/health"]);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^http/, "ws");

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublic(req)) await auth.protect();
  },
  {
    // Clerk builds a strict, per-request nonce CSP and merges our directives.
    contentSecurityPolicy: {
      strict: true,
      directives: {
        "connect-src": ["'self'", supabaseUrl, supabaseWs].filter(Boolean),
        "img-src": ["'self'", "data:", "https://img.clerk.com", "https://avatars.githubusercontent.com"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
      },
    },
  },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
