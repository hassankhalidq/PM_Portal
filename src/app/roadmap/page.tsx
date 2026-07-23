import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import RoadmapBoard from "./RoadmapBoard";

export const dynamic = "force-dynamic";

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: { roadmap?: string | string[] };
}) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const roadmaps = await prisma.roadmap.findMany({ orderBy: { createdAt: "asc" } });
  const roadmapParam = Array.isArray(searchParams.roadmap) ? searchParams.roadmap[0] : searchParams.roadmap;
  const currentRoadmap =
    (roadmapParam ? roadmaps.find((r) => r.id === roadmapParam) : undefined) ??
    roadmaps.find((r) => r.isDefault) ??
    roadmaps[0];

  const [categories, milestones] = currentRoadmap
    ? await Promise.all([
        prisma.category.findMany({
          where: { roadmapId: currentRoadmap.id },
          orderBy: { sortOrder: "asc" },
          include: { items: { orderBy: [{ sortOrder: "asc" }, { startDate: "asc" }] } },
        }),
        prisma.milestone.findMany({ where: { roadmapId: currentRoadmap.id }, orderBy: { date: "asc" } }),
      ])
    : [[], []];

  return (
    <Shell active="roadmap" userName={session?.user?.name ?? ""} role={role}>
      <RoadmapBoard
        roadmaps={roadmaps.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault }))}
        currentRoadmapId={currentRoadmap?.id ?? ""}
        currentTheme={currentRoadmap?.theme ?? "indigo"}
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
