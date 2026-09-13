import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import DashboardBoard from "./DashboardBoard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const orgId = (session?.user as { orgId?: string } | undefined)?.orgId;

  const [boards, roadmaps] = await Promise.all([
    prisma.board.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
    prisma.roadmap.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
  ]);
  const boardIds = boards.map((b) => b.id);
  const roadmapIds = roadmaps.map((r) => r.id);

  const [nodes, categories, milestones, logEntries] = await Promise.all([
    prisma.projectNode.findMany({
      where: { boardId: { in: boardIds } },
      select: {
        id: true,
        name: true,
        owner: true,
        boardId: true,
        parentId: true,
        status: true,
        progress: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.category.findMany({
      where: { roadmapId: { in: roadmapIds } },
      select: { id: true, roadmapId: true, name: true, color: true },
    }),
    prisma.milestone.findMany({
      where: { roadmapId: { in: roadmapIds }, date: { gte: new Date() } },
      orderBy: { date: "asc" },
    }),
    prisma.logEntry.findMany({
      where: { node: { boardId: { in: boardIds } } },
      select: { date: true, activity: true, node: { select: { boardId: true } } },
      orderBy: { date: "desc" },
      take: 50,
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
    // A node with children shows/stores a rolled-up progress, not its own
    // raw field (see updateNode's guard + progressRollup in ProjectBoard) —
    // only leaves ever hold a live, meaningful progress value, so average
    // over those rather than every node (which would double-count a
    // parent's stale stored value alongside its own children's).
    const parentIds = new Set(boardNodes.map((n) => n.parentId).filter((id): id is string => id !== null));
    const leafNodes = boardNodes.filter((n) => !parentIds.has(n.id));
    const statusCounts = { NOT_STARTED: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
    let progressSum = 0;
    let overdueCount = 0;
    for (const n of boardNodes) {
      statusCounts[n.status]++;
      if (n.endDate && n.endDate < now && n.status !== "DONE") overdueCount++;
    }
    for (const n of leafNodes) progressSum += n.progress;
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      totalProjects: boardNodes.filter((n) => n.parentId === null).length,
      totalItems: boardNodes.length,
      statusCounts,
      avgProgress: leafNodes.length ? Math.round(progressSum / leafNodes.length) : 0,
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
      lanes: cats.map((c) => ({
        name: c.name,
        color: c.color,
        count: items.filter((i) => i.categoryId === c.id).length,
      })),
      milestones: milestones
        .filter((m) => m.roadmapId === r.id)
        .slice(0, 4)
        .map((m) => ({
          name: m.name,
          date: m.date.toISOString().slice(0, 10),
          type: m.type,
        })),
    };
  });

  const attentionNodes = nodes
    .filter((n) => n.boardId)
    .map((n) => ({
      id: n.id,
      name: n.name,
      owner: n.owner,
      boardId: n.boardId as string,
      parentId: n.parentId,
      status: n.status,
      startDate: n.startDate ? n.startDate.toISOString().slice(0, 10) : null,
    }));

  const logs = logEntries
    .filter((l) => l.node.boardId)
    .map((l) => ({
      date: l.date.toISOString().slice(0, 10),
      activity: l.activity,
      boardId: l.node.boardId as string,
    }));

  const u = session?.user as { projectAccess?: string; roadmapAccess?: string } | undefined;
  const canViewProjects = role === "SUPER_ADMIN" || u?.projectAccess !== "NONE";
  const canViewRoadmap = role === "SUPER_ADMIN" || u?.roadmapAccess !== "NONE";

  return (
    <Shell
      active="dashboard"
      userName={session?.user?.name ?? ""}
      role={role}
      projectAccess={u?.projectAccess}
      roadmapAccess={u?.roadmapAccess}
    >
      <DashboardBoard
        boards={canViewProjects ? boardStats : []}
        roadmaps={canViewRoadmap ? roadmapStats : []}
        nodes={canViewProjects ? attentionNodes : []}
        logs={canViewProjects ? logs : []}
      />
    </Shell>
  );
}
