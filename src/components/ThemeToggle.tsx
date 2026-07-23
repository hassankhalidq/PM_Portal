"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme-preference", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      onClick={toggle}
      className="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-bg"
    >
      <span>{isDark ? "Dark mode" : "Light mode"}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${isDark ? "bg-accent" : "bg-border"}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform ${
            isDark ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
