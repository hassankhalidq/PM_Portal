import Link from "next/link";
import { logout } from "@/lib/actions";
import ThemeToggle from "./ThemeToggle";

export default function Shell({
  active,
  userName,
  role,
  children,
}: {
  active: "projects" | "roadmap" | "admin";
  userName: string;
  role?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border px-5 py-5">
          <p className="text-lg font-semibold leading-tight text-accent">
            SahulatPay
          </p>
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted">PM Portal</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          <Link
            href="/projects"
            className={`focus-ring rounded-lg px-3 py-2.5 text-sm font-medium ${
              active === "projects"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:bg-bg hover:text-text"
            }`}
          >
            Project
          </Link>
          <Link
            href="/roadmap"
            className={`focus-ring rounded-lg px-3 py-2.5 text-sm font-medium ${
              active === "roadmap"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:bg-bg hover:text-text"
            }`}
          >
            Product
          </Link>
          {role === "ADMIN" && (
            <Link
              href="/admin/users"
              className={`focus-ring rounded-lg px-3 py-2.5 text-sm font-medium ${
                active === "admin"
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:bg-bg hover:text-text"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="border-t border-border p-3">
          <ThemeToggle />
          <p className="truncate px-3 pb-2 text-xs text-text-muted">{userName}</p>
          <form action={logout}>
            <button className="btn-ghost w-full justify-center text-text-muted" type="submit">
              Log out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
