import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="animate-view-in w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="on-accent flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-lg font-bold">
            H
          </span>
          <div>
            <p className="text-2xl font-semibold text-accent">Huzzah</p>
            <p className="text-sm font-medium uppercase tracking-widest text-text-muted">PM Portal</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-text-muted">
          Internal tool. Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
