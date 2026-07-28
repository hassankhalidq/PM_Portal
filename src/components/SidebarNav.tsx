"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { logout } from "@/lib/actions";
import ThemeToggle from "./ThemeToggle";

type Active = "dashboard" | "projects" | "roadmap" | "admin";

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

  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "1") setCollapsed(true);
    setMounted(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-surface ${
        mounted ? TRANSITION : ""
      }`}
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

      <div className="flex items-center gap-3 border-b border-border px-4 py-5">
        <span className="shrink-0 text-lg font-bold text-accent">H</span>
        <div
          className={`min-w-0 overflow-hidden whitespace-nowrap ${TRANSITION}`}
          style={{ maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1 }}
        >
          <p className="truncate text-lg font-semibold leading-tight text-accent">Huzzah</p>
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted">PM Portal</p>
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

      <div className="border-t border-border p-3">
        <div
          className={`overflow-hidden ${TRANSITION}`}
          style={{ maxHeight: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1 }}
        >
          <ThemeToggle />
          <p className="truncate px-3 pb-2 text-xs text-text-muted">{userName}</p>
          <form action={logout}>
            <button className="btn-ghost w-full justify-center text-text-muted" type="submit">
              Log out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
