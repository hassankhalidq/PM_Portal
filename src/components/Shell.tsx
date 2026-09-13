import SidebarNav from "./SidebarNav";

export default function Shell({
  active,
  userName,
  role,
  projectAccess,
  roadmapAccess,
  children,
}: {
  active: "dashboard" | "projects" | "roadmap" | "admin";
  userName: string;
  role?: string;
  projectAccess?: string;
  roadmapAccess?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SidebarNav active={active} userName={userName} role={role} projectAccess={projectAccess} roadmapAccess={roadmapAccess} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
