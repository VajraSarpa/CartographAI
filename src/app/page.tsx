import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-semibold">Cartograph</h1>
        <p className="text-muted">Folders are boxes. Imports are lines.</p>
        <Link href="/dashboard" className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
          Open the dashboard
        </Link>
      </div>
    </main>
  );
}
