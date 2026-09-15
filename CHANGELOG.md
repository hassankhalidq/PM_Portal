# Changelog

Everything done on this repo since it was cloned onto this machine (2026-09-14). Five commits, all on `main`, all deployed to production (`pm-portal-phi.vercel.app`).

## Multi-tenant organization isolation

The app went from single-tenant (everyone who logged in saw every board, roadmap, and user account, with zero access boundary) to properly multi-tenant.

- New `Organization` model. `User`, `Board`, and `Roadmap` each belong to exactly one org.
- Every server action that reads or writes a board, roadmap, project item, roadmap item, milestone, category, comment, log entry, weekly status, or dependency now verifies the target actually belongs to the caller's org before touching it. ~39 mutating functions in `src/lib/actions.ts` were audited and hardened — none were missed.
- Every page query (`/projects`, `/roadmap`, `/dashboard`, `/projects/readout`) now filters by the caller's `orgId`.
- Existing production data was backfilled onto a new org, **Company A**, with zero data loss.

## Roles and permissions

- New `SUPER_ADMIN` role: full access across every organization. `ADMIN` stays scoped to its own org (manages that org's users only). `INTERNAL` is unchanged as the base role.
- New per-user, per-section access levels — `NONE` / `VIEW` / `EDIT` — independently for the **Project board** and the **Roadmap board**. `NONE` hides the section and its nav item entirely; `VIEW` renders it read-only; `EDIT` is full read/write. Enforced server-side in every relevant action, not just hidden in the UI.
- Admin → Users now supports, depending on who's logged in:
  - A regular **admin**: manage users and their access levels within their own org.
  - The **super admin**: manage every org's users from one screen, create new organizations, and assign a user to any org.
- A first `SUPER_ADMIN` account was created (credentials shared separately in chat, not stored here).

## Login flow — built, then reverted

Initially shipped with per-org email uniqueness (the same email could exist as separate accounts in different companies), which meant login needed an organization field alongside email + password.

After trying it, this was reverted: it added a real extra step to every login for no benefit anyone actually needed. **Email is globally unique again**, and login is back to plain email + password — the org is resolved automatically from whichever account that email belongs to. No org concept is exposed to the person logging in at all.

## Security hardening (from a full QA + VAPT pass)

- **Dependency fix**: upgraded `next-auth` to pull in a patched `@auth/core` (was carrying a critical advisory in its email-normalization code). Confirmed the vulnerable code path — the Email/magic-link provider — isn't used by this app at all (only the Credentials provider is), so it wasn't actually exploitable here, but the fix was free and non-breaking so it shipped anyway.
- **Response headers**: added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` locking down camera/mic/geolocation. Production was previously shipping none of these beyond Vercel's default HSTS.
- **Verified, not changed** (documented as known/accepted, not regressions):
  - No rate limiting or lockout on login attempts — bcrypt's cost factor is the only throttle. Flagged as a real gap; fixing it properly needs infrastructure (a KV-backed rate limiter or a lockout column), not a quick patch.
  - Next.js 14.2.35 (the last 14.x release) carries several unpatched CVEs; the fixes only exist in Next 15, a major-version migration out of scope for a same-session fix.
  - No Content-Security-Policy yet — the app's inline theme-init script needs either `unsafe-inline` or a nonce wired through middleware to add one safely; flagged as a follow-up rather than bolted on carelessly.
- Confirmed via live testing against production: no user/org enumeration on failed logins (uniform error regardless of what's wrong), no open redirect via `callbackUrl`/`redirectTo`, all protected routes correctly reject unauthenticated requests, `/api/auth/session` leaks nothing when logged out.
- Cross-org isolation was verified twice: once on a disposable Neon branch (a second throwaway org, zero leakage on any read path), and once for real in production using a second org's live admin account (same result — zero leakage).

## Bug fixed mid-flight

The first production migration attempt left the `orgId` column nullable instead of required (a scripted follow-up step silently didn't complete). Caught immediately by Vercel's own type-check failing the deploy — nothing broken went live. Fixed with a second, verified migration; the required constraint applied cleanly since every row already had its org set from the first step.

## Infrastructure notes

- This machine (`C:\Users\HP\PM_Portal`) is now the only working copy — the original machine is no longer in use.
- Vercel CLI and Neon CLI are authenticated on this machine for deploys and database branching.
- `prisma/provision-multitenancy.mjs` — the one-time script used to backfill the org/permissions migration onto existing data. Kept in the repo for reference.
