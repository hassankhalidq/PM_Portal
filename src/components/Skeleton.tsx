// Shared building blocks for route `loading.tsx` files — the App Router
// renders these as the Suspense fallback while a page's server component
// awaits its data, so every route that talks to the database on every
// navigation (all of them; see the `force-dynamic` exports) gets an
// immediate, non-blank paint instead of a frozen screen for several
// seconds. Kept deliberately dumb (no session data, no real content) since
// loading.tsx can't be async or receive props.
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-border/70 ${className}`} />;
}

export function SkeletonSidebar() {
  return (
    <div className="flex h-screen w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3">
      <div className="mb-4 flex items-center gap-3 border-b border-border px-1 pb-5">
        <SkeletonBlock className="h-6 w-6 rounded-full" />
        <SkeletonBlock className="h-4 w-16" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <SkeletonBlock key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function SkeletonShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <SkeletonSidebar />
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
