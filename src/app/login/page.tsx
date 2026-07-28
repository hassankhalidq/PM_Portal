import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold text-accent">Huzzah</p>
          <p className="text-sm font-medium uppercase tracking-widest text-text-muted">PM Portal</p>
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
