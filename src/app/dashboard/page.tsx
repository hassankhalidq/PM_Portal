import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import DashboardBoard from "./DashboardBoard";

export const dynamic = "force-dynamic";

const MILESTONE_COLORS: Record<string, string> = {
  RELEASE: "#D97706",
  LAUNCH: "#16A34A",
  DEADLINE: "#DC2626",
  CHECKPOINT: "#2563EB",
  DEPRECATION: "#71717A",
};

export default async function DashboardPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [boards, roadmaps] = await Promise.all([
    prisma.board.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.roadmap.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const boardIds = boards.map((b) => b.id);
  const roadmapIds = roadmaps.map((r) => r.id);

  const [nodes, categories, milestones] = await Promise.all([
    prisma.projectNode.findMany({
      where: { boardId: { in: boardIds } },
      select: { boardId: true, parentId: true, status: true, progress: true, endDate: true },
    }),
    prisma.category.findMany({
      where: { roadmapId: { in: roadmapIds } },
      select: { id: true, roadmapId: true },
    }),
    prisma.milestone.findMany({
      where: { roadmapId: { in: roadmapIds }, date: { gte: new Date() } },
      orderBy: { date: "asc" },
    }),
  ]);
  const categoryIds = categories.map((c) => c.id);
  const items = await prisma.roadmapItem.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { categoryId: true },
  });

  const now = new Date();
  const boardStats = boards.map((b) => {
    const boardNodes = nodes.filter((n) => n.boardId === b.id);
    const statusCounts = { NOT_STARTED: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
    let progressSum = 0;
    let overdueCount = 0;
    for (const n of boardNodes) {
      statusCounts[n.status]++;
      progressSum += n.progress;
      if (n.endDate && n.endDate < now && n.status !== "DONE") overdueCount++;
    }
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      totalProjects: boardNodes.filter((n) => n.parentId === null).length,
      totalItems: boardNodes.length,
      statusCounts,
      avgProgress: boardNodes.length ? Math.round(progressSum / boardNodes.length) : 0,
      overdueCount,
    };
  });

  const roadmapStats = roadmaps.map((r) => {
    const cats = categories.filter((c) => c.roadmapId === r.id);
    const catIdSet = new Set(cats.map((c) => c.id));
    const itemCount = items.filter((i) => catIdSet.has(i.categoryId)).length;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      laneCount: cats.length,
      itemCount,
      milestones: milestones
        .filter((m) => m.roadmapId === r.id)
        .slice(0, 4)
        .map((m) => ({
          name: m.name,
          date: m.date.toISOString().slice(0, 10),
          color: MILESTONE_COLORS[m.type] ?? "#71717A",
        })),
    };
  });

  return (
    <Shell active="dashboard" userName={session?.user?.name ?? ""} role={role}>
      <DashboardBoard boards={boardStats} roadmaps={roadmapStats} />
    </Shell>
  );
}
