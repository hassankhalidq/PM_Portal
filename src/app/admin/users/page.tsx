import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/Shell";
import UsersBoard from "./UsersBoard";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") redirect("/projects");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return (
    <Shell active="admin" userName={session?.user?.name ?? ""} role={role}>
      <UsersBoard
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
        }))}
        currentUserId={(session!.user as { id: string }).id}
      />
    </Shell>
  );
}
