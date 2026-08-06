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
      if (request.nextUrl.pathname.startsWith("/admin")) {
        const role = (auth!.user as { role?: string }).role;
        if (role !== "ADMIN") return Response.redirect(new URL("/projects", request.nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
