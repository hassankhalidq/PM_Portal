import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import ReadoutBoard from "./ReadoutBoard";

export const dynamic = "force-dynamic";

export default async function ReadoutPage({
  searchParams,
}: {
  searchParams: { board?: string | string[] };
}) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const orgId = (session?.user as { orgId?: string } | undefined)?.orgId;

  const boards = await prisma.board.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  const boardParam = Array.isArray(searchParams.board) ? searchParams.board[0] : searchParams.board;
  const currentBoard =
    (boardParam ? boards.find((b) => b.id === boardParam) : undefined) ??
    boards.find((b) => b.isDefault) ??
    boards[0];

  const nodes = currentBoard
    ? await prisma.projectNode.findMany({
        where: { boardId: currentBoard.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          owner: true,
          status: true,
          priority: true,
          progress: true,
          startDate: true,
          endDate: true,
          blockReason: true,
          parentId: true,
          updatedAt: true,
        },
      })
    : [];

  const serialized = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    owner: n.owner,
    status: n.status,
    priority: n.priority,
    progress: n.progress,
    startDate: n.startDate ? n.startDate.toISOString().slice(0, 10) : null,
    endDate: n.endDate ? n.endDate.toISOString().slice(0, 10) : null,
    blockReason: n.blockReason,
    parentId: n.parentId,
    updatedAt: n.updatedAt.toISOString(),
  }));

  return (
    <Shell
      active="projects"
      userName={session?.user?.name ?? ""}
      role={role}
      projectAccess={(session?.user as { projectAccess?: string } | undefined)?.projectAccess}
      roadmapAccess={(session?.user as { roadmapAccess?: string } | undefined)?.roadmapAccess}
    >
      <ReadoutBoard nodes={serialized} boardId={currentBoard?.id ?? ""} boardName={currentBoard?.name ?? ""} />
    </Shell>
  );
}
