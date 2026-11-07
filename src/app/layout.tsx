import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <Suspense>
          <ThemeScript />
        </Suspense>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
