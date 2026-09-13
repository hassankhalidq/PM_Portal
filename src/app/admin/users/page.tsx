import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import UsersBoard from "./UsersBoard";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") redirect("/projects");
  const isSuperAdmin = role === "SUPER_ADMIN";
  const orgId = (session?.user as { orgId?: string } | undefined)?.orgId;

  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      // A super admin manages every company from here; a regular admin only
      // ever sees their own org's accounts.
      where: isSuperAdmin ? {} : { orgId },
      orderBy: [{ orgId: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        projectAccess: true,
        roadmapAccess: true,
        orgId: true,
        organization: { select: { name: true, slug: true } },
        createdAt: true,
      },
    }),
    isSuperAdmin
      ? prisma.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true } })
      : Promise.resolve([]),
  ]);

  return (
    <Shell active="admin" userName={session?.user?.name ?? ""} role={role}>
      <UsersBoard
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          projectAccess: u.projectAccess,
          roadmapAccess: u.roadmapAccess,
          orgId: u.orgId,
          orgName: u.organization.name,
          orgSlug: u.organization.slug,
          createdAt: u.createdAt.toISOString(),
        }))}
        organizations={organizations}
        currentUserId={(session!.user as { id: string }).id}
        isSuperAdmin={isSuperAdmin}
        homeOrgId={orgId ?? ""}
      />
    </Shell>
  );
}
