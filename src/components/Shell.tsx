import Link from "next/link";
import { logout } from "@/lib/actions";

export default function Shell({
  active,
  userName,
  children,
}: {
  active: "projects" | "roadmap";
  userName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-5 py-5">
          <p className="font-display text-lg font-700 leading-tight text-primary-deep">
            SahulatPay
          </p>
          <p className="text-xs font-medium uppercase tracking-widest text-muted">PM Portal</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          <Link
            href="/projects"
            className={`focus-ring rounded-lg px-3 py-2.5 text-sm font-medium ${
              active === "projects"
                ? "bg-primary-soft text-primary-deep"
                : "text-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            Project board
          </Link>
          <Link
            href="/roadmap"
            className={`focus-ring rounded-lg px-3 py-2.5 text-sm font-medium ${
              active === "roadmap"
                ? "bg-primary-soft text-primary-deep"
                : "text-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            Roadmap board
          </Link>
        </nav>
        <div className="border-t border-line p-3">
          <p className="truncate px-3 pb-2 text-xs text-muted">{userName}</p>
          <form action={logout}>
            <button className="btn-ghost w-full justify-center text-muted" type="submit">
              Log out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
