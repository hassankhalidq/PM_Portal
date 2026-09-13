import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// For a brand-new database only (first-time setup). An existing database
// upgrading to the org/permissions model uses provision-multitenancy.mjs
// instead — it backfills real data onto an org rather than assuming there
// is none yet.
async function main() {
  const orgName = process.env.SEED_ORG_NAME || "Company A";
  const orgSlug = process.env.SEED_ORG_SLUG || "company-a";
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { name: orgName, slug: orgSlug },
  });

  const email = (process.env.SEED_ADMIN_EMAIL || "admin@sahulatpay.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "changeme123";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email } },
    update: { role: "ADMIN" },
    create: { email, name: "Portal Admin", passwordHash, role: "ADMIN", orgId: org.id },
  });

  let defaultBoard = await prisma.board.findFirst({ where: { isDefault: true, orgId: org.id } });
  if (!defaultBoard) {
    defaultBoard = await prisma.board.upsert({
      where: { id: "seed-default-board" },
      update: {},
      create: { id: "seed-default-board", name: "General", isDefault: true, orgId: org.id },
    });
  }

  let defaultRoadmap = await prisma.roadmap.findFirst({ where: { isDefault: true, orgId: org.id } });
  if (!defaultRoadmap) {
    defaultRoadmap = await prisma.roadmap.upsert({
      where: { id: "seed-default-roadmap" },
      update: {},
      create: { id: "seed-default-roadmap", name: "General", isDefault: true, theme: "indigo", orgId: org.id },
    });
  }

  const count = await prisma.category.count({ where: { roadmapId: defaultRoadmap.id } });
  if (count === 0) {
    await prisma.category.create({
      data: { name: "General", color: "#0E7A5F", sortOrder: 0, roadmapId: defaultRoadmap.id },
    });
  }

  console.log(`Seeded org "${org.name}" (${org.slug}). Login: /login?org=${org.slug} — ${email} / ${password}`);
  console.log("Change this password immediately.");
}

main().finally(() => prisma.$disconnect());
