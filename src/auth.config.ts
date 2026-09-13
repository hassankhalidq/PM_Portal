import type { NextAuthConfig } from "next-auth";

// Edge-safe base config (no database imports) shared with middleware.
export const authConfig = {
  pages: { signIn: "/login" },
  // Rolling session: 4 hours of inactivity signs you out. Active use keeps
  // renewing it (checked every 30 min, well under the 4h ceiling) so you're
  // not interrupted mid-work — without an explicit maxAge, NextAuth's
  // default is 30 days, which is why sessions never seemed to expire.
  session: { strategy: "jwt", maxAge: 60 * 60 * 4, updateAge: 60 * 30 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isLogin = request.nextUrl.pathname.startsWith("/login");
      if (isLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/projects", request.nextUrl));
        return true;
      }
      if (!isLoggedIn) return false;

      const role = (auth!.user as { role?: string }).role;
      const isSuperAdmin = role === "SUPER_ADMIN";

      if (request.nextUrl.pathname.startsWith("/admin")) {
        if (role !== "ADMIN" && !isSuperAdmin) return Response.redirect(new URL("/projects", request.nextUrl));
      }

      // Section-level gating: a NONE access level hides the route entirely,
      // regardless of what URL is typed in. SUPER_ADMIN always passes.
      if (!isSuperAdmin) {
        const projectAccess = (auth!.user as { projectAccess?: string }).projectAccess;
        const roadmapAccess = (auth!.user as { roadmapAccess?: string }).roadmapAccess;
        if (request.nextUrl.pathname.startsWith("/projects") && projectAccess === "NONE") {
          return Response.redirect(new URL(roadmapAccess !== "NONE" ? "/roadmap" : "/dashboard", request.nextUrl));
        }
        if (request.nextUrl.pathname.startsWith("/roadmap") && roadmapAccess === "NONE") {
          return Response.redirect(new URL(projectAccess !== "NONE" ? "/projects" : "/dashboard", request.nextUrl));
        }
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id;
        token.role = (user as { role?: string }).role;
        token.orgId = (user as { orgId?: string }).orgId;
        token.orgSlug = (user as { orgSlug?: string }).orgSlug;
        token.projectAccess = (user as { projectAccess?: string }).projectAccess;
        token.roadmapAccess = (user as { roadmapAccess?: string }).roadmapAccess;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { orgId?: string }).orgId = token.orgId as string;
        (session.user as { orgSlug?: string }).orgSlug = token.orgSlug as string;
        (session.user as { projectAccess?: string }).projectAccess = token.projectAccess as string;
        (session.user as { roadmapAccess?: string }).roadmapAccess = token.roadmapAccess as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
