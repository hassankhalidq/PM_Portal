import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="animate-view-in w-full max-w-md">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <img src="/vyro-mark.png" alt="Vyro" className="h-20 w-20 object-contain" />
          <p className="text-4xl font-semibold tracking-tight text-accent">Vyro</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-text-muted">
          Internal tool. Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
