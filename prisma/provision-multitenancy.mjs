// One-time migration script for the org/permissions rollout.
//
// Run order (see the deploy checklist this ships with):
//   1. Temporarily relax `orgId` to optional on User/Board/Roadmap in
//      schema.prisma and `npx prisma db push` — adds the columns without
//      touching existing rows.
//   2. `node prisma/provision-multitenancy.mjs` (this script) — creates the
//      first organization, backfills every existing row onto it, and
//      creates the SUPER_ADMIN account.
//   3. Put `orgId` back to required in schema.prisma and `npx prisma db
//      push` again — now succeeds because no row is null anymore.
//
// Safe to re-run: each step is idempotent (find-or-create / updateMany on
// nulls only).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

function randomPassword(bytes = 12) {
  return randomBytes(bytes).toString("base64url");
}

async function main() {
  const orgName = process.env.PROVISION_ORG_NAME || "Company A";
  const orgSlug = process.env.PROVISION_ORG_SLUG || "company-a";

  let org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    org = await prisma.organization.create({ data: { name: orgName, slug: orgSlug } });
    console.log(`Created organization "${org.name}" (slug: ${org.slug}).`);
  } else {
    console.log(`Organization "${org.name}" (slug: ${org.slug}) already exists.`);
  }

  const [users, boards, roadmaps] = await Promise.all([
    prisma.user.updateMany({ where: { orgId: null }, data: { orgId: org.id } }),
    prisma.board.updateMany({ where: { orgId: null }, data: { orgId: org.id } }),
    prisma.roadmap.updateMany({ where: { orgId: null }, data: { orgId: org.id } }),
  ]);
  console.log(`Backfilled onto ${org.slug}: ${users.count} users, ${boards.count} boards, ${roadmaps.count} roadmaps.`);

  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || "superadmin@vyro.local").toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: superAdminEmail } });
  if (existing) {
    if (existing.role !== "SUPER_ADMIN") {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "SUPER_ADMIN" } });
      console.log(`Promoted existing ${superAdminEmail} to SUPER_ADMIN.`);
    } else {
      console.log(`${superAdminEmail} is already SUPER_ADMIN — no changes made, password left as-is.`);
    }
  } else {
    const password = process.env.SUPER_ADMIN_PASSWORD || randomPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email: superAdminEmail,
        name: process.env.SUPER_ADMIN_NAME || "Super Admin",
        passwordHash,
        role: "SUPER_ADMIN",
        orgId: org.id,
      },
    });
    console.log("---");
    console.log("SUPER_ADMIN account created:");
    console.log(`  Email:      ${superAdminEmail}`);
    console.log(`  Password:   ${password}`);
    console.log("Change this password after first login.");
    console.log("---");
  }
}

main().finally(() => prisma.$disconnect());
