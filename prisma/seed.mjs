import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@sahulatpay.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "changeme123";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN" },
    create: { email, name: "Portal Admin", passwordHash, role: "ADMIN" },
  });

  let defaultBoard = await prisma.board.findFirst({ where: { isDefault: true } });
  if (!defaultBoard) {
    defaultBoard = await prisma.board.upsert({
      where: { id: "seed-default-board" },
      update: {},
      create: { id: "seed-default-board", name: "General", isDefault: true },
    });
  }

  let defaultRoadmap = await prisma.roadmap.findFirst({ where: { isDefault: true } });
  if (!defaultRoadmap) {
    defaultRoadmap = await prisma.roadmap.upsert({
      where: { id: "seed-default-roadmap" },
      update: {},
      create: { id: "seed-default-roadmap", name: "General", isDefault: true, theme: "indigo" },
    });
  }

  const count = await prisma.category.count();
  if (count === 0) {
    await prisma.category.create({
      data: { name: "General", color: "#0E7A5F", sortOrder: 0, roadmapId: defaultRoadmap.id },
    });
  }

  // Backfill any pre-existing rows created before boardId/roadmapId existed.
  await prisma.projectNode.updateMany({
    where: { boardId: null },
    data: { boardId: defaultBoard.id },
  });
  await prisma.category.updateMany({
    where: { roadmapId: null },
    data: { roadmapId: defaultRoadmap.id },
  });
  await prisma.milestone.updateMany({
    where: { roadmapId: null },
    data: { roadmapId: defaultRoadmap.id },
  });

  console.log(`Seeded. Login: ${email} / ${password} - change this password immediately.`);
}

main().finally(() => prisma.$disconnect());
