import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Suspense>
        <SignUp fallbackRedirectUrl="/onboarding" />
      </Suspense>
    </main>
  );
}
