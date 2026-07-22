import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import ProjectBoard from "./ProjectBoard";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  const nodes = await prisma.projectNode.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true } } },
      },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });

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
    <Shell active="projects" userName={session?.user?.name ?? ""}>
      <ProjectBoard nodes={serialized} />
    </Shell>
  );
}
