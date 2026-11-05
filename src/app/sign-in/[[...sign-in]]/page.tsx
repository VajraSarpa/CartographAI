import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Suspense>
        <SignIn fallbackRedirectUrl="/onboarding" />
      </Suspense>
    </main>
  );
}
