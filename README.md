# SahulatPay PM Portal

Internal two-board tool: a **Project board** (recursive project breakdown, monday.com-style) and a **Roadmap board** (swimlane timeline with milestones, Roadmunk-style). Both sit behind a login. The boards are intentionally independent and share no data model.

## Stack

Next.js 14 (App Router, frontend + backend via Server Actions) · Vercel Postgres (Neon) · Prisma · Auth.js (NextAuth v5) with bcrypt-hashed credentials · Tailwind CSS.

## First-time setup

1. **Push to GitHub** — create a new private repo and push this folder.

2. **Create the Vercel project** — import the repo at vercel.com. Framework preset: Next.js (auto-detected). Do not deploy yet.

3. **Create the database** — in the Vercel project go to Storage, create a Postgres database, and connect it to the project. This auto-injects `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` into every environment.

4. **Add the auth secret** — in Vercel: Settings, Environment Variables, add `AUTH_SECRET`. Generate a value locally with:
   ```
   openssl rand -base64 32
   ```

5. **Local env** — install the Vercel CLI (`npm i -g vercel`), then in the project folder:
   ```
   vercel link
   vercel env pull .env.local
   npm install
   ```

6. **Create a Blob store** (for Project board file attachments) — in the Vercel project go to Storage, create a **Blob** store, and connect it to the project. This auto-injects `BLOB_READ_WRITE_TOKEN`. Re-run `vercel env pull .env.local` afterwards if you already pulled once.

7. **Create the tables**:
   ```
   npm run db:push
   ```

8. **Seed the first user** (creates `admin@sahulatpay.local` / `changeme123` and a default roadmap lane):
   ```
   npm run db:seed
   ```
   To choose your own credentials instead:
   ```
   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=yourStrongPassword npm run db:seed
   ```

9. **Run locally**:
   ```
   npm run dev
   ```

10. **Deploy** — push to GitHub; Vercel builds and deploys automatically. The build script already runs `prisma generate`.

Change the seeded password immediately if you used the default. There is deliberately no public signup; add users by inserting rows (bcrypt hash, cost 12) or re-running the seed with different env values.

## Security notes

- Passwords are hashed with bcrypt (cost 12); nothing is stored or logged in plaintext.
- Every Server Action and data page validates the session server-side; middleware gates all routes.
- Sessions are JWT-based, signed with `AUTH_SECRET`.
- The `Role` enum currently has only `INTERNAL`. Adding a client-facing tier later is an enum value + authorization checks, not a schema rewrite.
- Secrets live only in environment variables; `.env*` files are gitignored.

## Using the boards

**Project board** — "New project" creates a top-level project. Hover any row and press + to add a child; nesting is unlimited. Click a row to open the side panel: edit fields, delete (cascades to children), and comment. Filter by owner/status/priority; Export CSV downloads the currently visible (filtered) view.

Table/Kanban toggle in the header switches between the nested list and a drag-and-drop board grouped by status (drag a card to a new column to change its status). Each item also has a progress percentage (slider in the side panel, shown as a bar on both views), an optional link field (shown as a 🔗 icon on the row, opens in a new tab), and file attachments (upload from the side panel, stored in Vercel Blob, shown with a 📎 count on the row).

**Roadmap board** — "Manage lanes" creates/renames/recolors/reorders swimlanes (the last lane can't be deleted). "Add item" places a bar in a lane; "Add milestone" adds a typed marker (Release ◆, Launch flag, Deadline ■, Checkpoint ●, Deprecation ✕) on the dedicated top lane. Drag any bar or marker to reschedule; click to open its detail panel. The dashed amber seam marks the Now (monthly headers) / Later (quarterly headers) boundary; the zoom slider widens or narrows the day scale.

## Out of scope in this MVP (by design)

Jira sync, notifications/automation, and the client-facing role. The data model was kept clean so these can be added without restructuring.
