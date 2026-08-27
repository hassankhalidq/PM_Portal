"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { logout } from "@/lib/actions";
import ThemeToggle from "./ThemeToggle";
import {
  DENSITY_EVENT,
  KPIS_EVENT,
  getDensity,
  getShowKpis,
  setDensity,
  setShowKpis,
  type Density,
} from "@/lib/uiPrefs";

type Active = "dashboard" | "projects" | "roadmap" | "admin";

const SAVED_VIEWS: { key: string; label: string }[] = [
  { key: "my-week", label: "My week" },
  { key: "blocked", label: "Blocked" },
  { key: "no-dates", label: "No dates set" },
  { key: "high-priority", label: "High priority" },
];

const NAV_ITEMS: { key: Active; href: string; label: string; icon: React.ReactNode }[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="11" width="8" height="10" rx="1.5" />
        <rect x="3" y="14" width="8" height="7" rx="1.5" />
      </>
    ),
  },
  {
    key: "projects",
    href: "/projects",
    label: "Project",
    icon: <path d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    key: "roadmap",
    href: "/roadmap",
    label: "Product",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <rect x="3" y="10" width="12" height="4" rx="1" />
        <rect x="3" y="16" width="15" height="4" rx="1" />
      </>
    ),
  },
  {
    key: "admin",
    href: "/admin/users",
    label: "Admin",
    icon: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
        <circle cx="18" cy="8" r="2.3" />
        <path d="M16.5 15.3c2.2.4 4 2 4.5 4.2" />
      </>
    ),
  },
];

const TRANSITION = "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]";

export default function SidebarNav({
  active,
  userName,
  role,
}: {
  active: Active;
  userName: string;
  role?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [density, setDensityState] = useState<Density>("comfortable");
  const [showKpis, setShowKpisState] = useState(true);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "1") setCollapsed(true);
    setDensityState(getDensity());
    setShowKpisState(getShowKpis());
    setMounted(true);
    const onDensity = (e: Event) => setDensityState((e as CustomEvent<Density>).detail);
    const onKpis = (e: Event) => setShowKpisState((e as CustomEvent<boolean>).detail);
    window.addEventListener(DENSITY_EVENT, onDensity);
    window.addEventListener(KPIS_EVENT, onKpis);
    return () => {
      window.removeEventListener(DENSITY_EVENT, onDensity);
      window.removeEventListener(KPIS_EVENT, onKpis);
    };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  const toggleDensity = () => {
    const next: Density = density === "compact" ? "comfortable" : "compact";
    setDensityState(next);
    setDensity(next);
  };

  const toggleKpis = () => {
    const next = !showKpis;
    setShowKpisState(next);
    setShowKpis(next);
  };

  const boardParam = searchParams.get("board");
  const savedViewHref = (key: string) =>
    boardParam ? `/projects?board=${boardParam}&saved=${key}` : `/projects?saved=${key}`;

  return (
    <div
      className={`sticky top-0 relative h-screen shrink-0 ${mounted ? TRANSITION : ""}`}
      style={{ width: collapsed ? 64 : 224 }}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        title={collapsed ? "Expand menu" : "Collapse menu"}
        className={`focus-ring absolute top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-sm hover:text-text ${TRANSITION}`}
        style={{ left: collapsed ? 64 - 12 : 224 - 12 }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)" }}
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>

      <aside className="flex h-full flex-col overflow-hidden border-r border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border px-4 py-5">
          <img src="/vyro-mark.png" alt="Vyro" className="h-6 w-6 shrink-0 object-contain" />
          <div
            className={`min-w-0 overflow-hidden whitespace-nowrap ${TRANSITION}`}
            style={{ maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1 }}
          >
            <p className="truncate text-lg font-semibold leading-tight text-accent">Vyro</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => {
          if (item.key === "admin" && role !== "ADMIN") return null;
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={false}
              title={item.label}
              aria-label={item.label}
              className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                isActive ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-bg hover:text-text"
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0"
              >
                {item.icon}
              </svg>
              <span
                className={`overflow-hidden whitespace-nowrap ${TRANSITION}`}
                style={{ maxWidth: collapsed ? 0 : 140, opacity: collapsed ? 0 : 1 }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
        </nav>

        {active === "projects" && (
          <div
            className={`overflow-hidden border-t border-border p-3 ${TRANSITION}`}
            style={{ maxHeight: collapsed ? 0 : 200, opacity: collapsed ? 0 : 1 }}
          >
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Saved views
            </p>
            {SAVED_VIEWS.map((v) => (
              <Link
                key={v.key}
                href={savedViewHref(v.key)}
                prefetch={false}
                className="block truncate rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-bg hover:text-text"
              >
                {v.label}
              </Link>
            ))}
          </div>
        )}

        <div className="border-t border-border p-3">
          <div
            className={`overflow-hidden ${TRANSITION}`}
            style={{ maxHeight: collapsed ? 0 : 280, opacity: collapsed ? 0 : 1 }}
          >
            <ThemeToggle />
            <button
              type="button"
              role="switch"
              aria-checked={density === "compact"}
              aria-label="Toggle row density"
              onClick={toggleDensity}
              className="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-bg"
            >
              <span>{density === "compact" ? "Compact rows" : "Comfortable rows"}</span>
              <span
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  density === "compact" ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    density === "compact" ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={showKpis}
              aria-label="Toggle KPI strip"
              onClick={toggleKpis}
              className="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-bg"
            >
              <span>KPI strip</span>
              <span
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  showKpis ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    showKpis ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
            <p className="truncate px-3 pb-2 text-xs text-text-muted">{userName}</p>
            <form action={logout}>
              <button className="btn-ghost w-full justify-center text-text-muted" type="submit">
                Log out
              </button>
            </form>
          </div>
        </div>
      </aside>
    </div>
  );
}
