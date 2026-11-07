import Link from "next/link";

export const metadata = {
  title: { absolute: "Cartograph: a map of any TypeScript or JavaScript repo" },
};

const FRAMEWORKS = [
  { name: "Next.js", detail: "pages, layouts, route handlers, server actions, middleware" },
  { name: "Nest.js", detail: "controllers, modules, providers, routes from decorators" },
  { name: "Express", detail: "routes, controllers, services, models (CommonJS too)" },
  { name: "React", detail: "components, hooks, contexts" },
  { name: "Docusaurus", detail: "site pages, swizzled theme files" },
];

const WONT = [
  "Guess a connection. A line exists only when the parser resolved a real import to a real file.",
  "Show a route unless its method and full path are both written in the code.",
  "Hide what it couldn't read. Every unresolved import keeps its reason.",
  "Grade your code. The graph can't know whether code is good, so it doesn't pretend to.",
  "Let the AI name a file it wasn't shown. Every explanation is checked.",
];

function Figure() {
  // folders are boxes, imports are lines
  return (
    <svg viewBox="0 0 320 220" className="w-full max-w-sm" role="img" aria-label="Folders drawn as boxes connected by import lines">
      <g fill="none" strokeWidth="1.5">
        <path d="M110 50 C150 50,150 110,190 110" stroke="var(--edge)" />
        <path d="M110 170 C150 170,150 110,190 110" stroke="var(--in)" />
        <path d="M250 120 C280 120,280 175,250 175" stroke="var(--out)" />
        <path d="M110 55 C150 60,170 170,190 175" stroke="var(--edge)" opacity="0.5" />
      </g>
      {[
        { x: 10, y: 30, w: 100, h: 40, t: "app/" },
        { x: 10, y: 150, w: 100, h: 40, t: "components/" },
        { x: 190, y: 85, w: 110, h: 50, t: "lib/" },
        { x: 190, y: 160, w: 60, h: 30, t: "db/" },
      ].map((b) => (
        <g key={b.t}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="6" fill="var(--panel)" stroke="var(--border)" />
          <text x={b.x + 10} y={b.y + 22} fontSize="12" fontFamily="var(--font-geist-mono), monospace" fill="var(--fg)">
            {b.t}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-semibold tracking-tight">Cartograph</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/sign-in" className="text-muted hover:text-fg">
            Sign in
          </Link>
          <Link href="/dashboard" className="rounded-md bg-accent px-3 py-1.5 font-medium text-white">
            Open dashboard
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-24 px-6 pb-24">
        <section className="grid items-center gap-10 pt-10 md:grid-cols-[1fr_auto]">
          <div className="space-y-6">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">A map of any TypeScript or JavaScript repo.</h1>
            <p className="max-w-[46ch] text-lg text-muted">
              Paste a public GitHub URL. Folders become boxes, imports become lines. Select a file to see what imports it and what breaks two steps out.
            </p>
            <form action="/dashboard" method="get" className="flex max-w-xl gap-2">
              <label htmlFor="hero-url" className="sr-only">
                Public GitHub repository URL
              </label>
              <input
                id="hero-url"
                name="url"
                required
                maxLength={300}
                placeholder="https://github.com/owner/repo"
                className="min-w-0 flex-1 rounded-md border border-border bg-panel px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
              />
              <button type="submit" className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white">
                Map it
              </button>
            </form>
            <p className="text-xs text-muted">Sign in with GitHub to start. Public repositories only.</p>
          </div>
          <Figure />
        </section>

        <section className="space-y-8">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {[
              ["Parse", "The TypeScript compiler reads every import, re-export, dynamic import and require, and resolves each one with your tsconfig."],
              ["Map", "Folders fold into boxes sized by how much depends on them. Click one to open its files. Selecting lights up neighbours."],
              ["Ask", "Explain a file from its real neighbours, or ask the repo a question. Every answer comes from the graph, through tools you can watch."],
            ].map(([t, d], i) => (
              <li key={t} className="space-y-2 rounded-lg border border-border bg-panel p-5">
                <div className="text-xs font-semibold text-accent">Step {i + 1}</div>
                <div className="font-medium">{t}</div>
                <p className="max-w-[46ch] text-sm text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Supported frameworks</h2>
          <p className="max-w-[64ch] text-muted">
            Any TypeScript or JavaScript repository maps. When a framework is detected from a package.json, its files also get roles by rule, and
            routes appear when the code spells out both the method and the full path.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FRAMEWORKS.map((f) => (
              <li key={f.name} className="rounded-lg border border-border bg-panel p-4">
                <div className="font-medium">{f.name}</div>
                <div className="text-sm text-muted">{f.detail}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">What it won&apos;t do</h2>
          <ul className="max-w-[64ch] space-y-3">
            {WONT.map((w) => (
              <li key={w} className="flex gap-3 text-muted">
                <span className="text-warn" aria-hidden>
                  ✕
                </span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-panel p-10 text-center">
          <h2 className="text-2xl font-semibold">See your codebase as a map</h2>
          <p className="mx-auto mt-2 max-w-[46ch] text-muted">Sign in with GitHub, make a team, paste a repository.</p>
          <Link href="/sign-in" className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white">
            Sign in to start
          </Link>
        </section>
      </main>
    </div>
  );
}
