import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import RoadmapBoard from "./RoadmapBoard";

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  const session = await auth();
  const [categories, milestones] = await Promise.all([
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { startDate: "asc" } } },
    }),
    prisma.milestone.findMany({ orderBy: { date: "asc" } }),
  ]);

  return (
    <Shell active="roadmap" userName={session?.user?.name ?? ""}>
      <RoadmapBoard
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          items: c.items.map((i) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            startDate: i.startDate.toISOString().slice(0, 10),
            endDate: i.endDate.toISOString().slice(0, 10),
            categoryId: i.categoryId,
          })),
        }))}
        milestones={milestones.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          date: m.date.toISOString().slice(0, 10),
          description: m.description,
        }))}
      />
    </Shell>
  );
}
