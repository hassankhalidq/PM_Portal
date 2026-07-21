import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-2xl font-700 text-primary-deep">SahulatPay</p>
          <p className="text-sm font-medium uppercase tracking-widest text-muted">PM Portal</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <h1 className="mb-4 font-display text-lg font-600">Sign in</h1>
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Internal tool. Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
