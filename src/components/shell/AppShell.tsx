import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell({ children, full = false }: { children: ReactNode; full?: boolean }) {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-4">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Cartograph
        </Link>
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
          appearance={{ elements: { rootBox: "flex items-center" } }}
        />
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <UserButton />
        </div>
      </header>
      <div className={full ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-y-auto"}>{children}</div>
    </div>
  );
}
