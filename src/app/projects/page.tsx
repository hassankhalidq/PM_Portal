import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import ProjectBoard from "./ProjectBoard";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { board?: string | string[] };
}) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const boards = await prisma.board.findMany({ orderBy: { createdAt: "asc" } });
  const boardParam = Array.isArray(searchParams.board) ? searchParams.board[0] : searchParams.board;
  const currentBoard =
    (boardParam ? boards.find((b) => b.id === boardParam) : undefined) ??
    boards.find((b) => b.isDefault) ??
    boards[0];

  const nodes = currentBoard
    ? await prisma.projectNode.findMany({
        where: { boardId: currentBoard.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          comments: {
            orderBy: { createdAt: "asc" },
            include: { author: { select: { name: true } } },
          },
          attachments: { orderBy: { createdAt: "asc" } },
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
    link: n.link,
    startDate: n.startDate ? n.startDate.toISOString().slice(0, 10) : null,
    endDate: n.endDate ? n.endDate.toISOString().slice(0, 10) : null,
    description: n.description,
    parentId: n.parentId,
    comments: n.comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author.name,
      createdAt: c.createdAt.toISOString(),
    })),
    attachments: n.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      size: a.size,
    })),
  }));

  return (
    <Shell active="projects" userName={session?.user?.name ?? ""} role={role}>
      <ProjectBoard
        nodes={serialized}
        boards={boards.map((b) => ({ id: b.id, name: b.name, isDefault: b.isDefault }))}
        currentBoardId={currentBoard?.id ?? ""}
      />
    </Shell>
  );
}
