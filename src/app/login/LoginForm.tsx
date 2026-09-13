"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { login } from "@/lib/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full justify-center disabled:opacity-60">
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

export default function LoginForm() {
  const [error, formAction] = useFormState(login, undefined);
  const searchParams = useSearchParams();
  // Each company gets a bookmarkable link like /login?org=company-b so day
  // to day nobody has to know or type their org slug. It's only shown as a
  // visible field when that link wasn't used (or someone lands on the bare
  // /login page) — a rare fallback, not the normal path.
  const orgFromLink = searchParams.get("org")?.trim() ?? "";

  return (
    <form action={formAction} className="space-y-4">
      {orgFromLink ? (
        <input type="hidden" name="org" value={orgFromLink} />
      ) : (
        <div>
          <label htmlFor="org" className="mb-1 block text-sm font-medium">
            Organization
          </label>
          <input
            id="org"
            name="org"
            type="text"
            required
            autoFocus
            autoComplete="off"
            placeholder="your-company"
            className="field"
          />
          <p className="mt-1 text-xs text-text-muted">
            Use your company&apos;s login link if you have one — this won&apos;t be needed there.
          </p>
        </div>
      )}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus={!!orgFromLink}
          autoComplete="email"
          className="field"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="field"
        />
      </div>
      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
