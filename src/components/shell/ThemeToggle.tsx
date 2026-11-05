"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const t = localStorage.getItem("theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a browser-only value after mount
    if (t === "light" || t === "dark") setTheme(t);
  }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    const el = document.documentElement;
    el.classList.remove("light", "dark");
    if (t === "system") localStorage.removeItem("theme");
    else {
      localStorage.setItem("theme", t);
      el.classList.add(t);
    }
  };
  return (
    <div className="flex rounded-md border border-border p-0.5 text-xs" role="radiogroup" aria-label="Theme">
      {(["system", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => apply(t)}
          className={`rounded px-2 py-0.5 capitalize ${theme === t ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
