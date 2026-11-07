import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ThemeScript } from "@/components/shell/ThemeScript";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Cartograph", template: "%s · Cartograph" },
  description: "Paste a public TypeScript or JavaScript repo and get a map: folders are boxes, imports are lines.",
};

// The CSP (src/proxy.ts) allows only scripts carrying this request's nonce
// ('strict-dynamic'). Next.js adds the nonce only when it renders per request,
// so a prebuilt static page would load with every script blocked. Render every
// route at request time; `instant = false` lets the whole tree block on it.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <Suspense>
          <ThemeScript />
        </Suspense>
        <ClerkProvider dynamic>{children}</ClerkProvider>
      </body>
    </html>
  );
}
