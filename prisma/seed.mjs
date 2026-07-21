import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@sahulatpay.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "changeme123";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Portal Admin", passwordHash, role: "INTERNAL" },
  });

  const count = await prisma.category.count();
  if (count === 0) {
    await prisma.category.create({
      data: { name: "General", color: "#0E7A5F", sortOrder: 0 },
    });
  }

  console.log(`Seeded. Login: ${email} / ${password} - change this password immediately.`);
}

main().finally(() => prisma.$disconnect());
