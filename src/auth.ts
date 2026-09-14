import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // Email is globally unique, so the org comes along for free with
        // the account itself -- no separate org step for the person logging in.
        const user = await prisma.user.findUnique({
          where: { email },
          include: { organization: { select: { slug: true } } },
        });
        if (!user) return null;
        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          orgSlug: user.organization.slug,
          projectAccess: user.projectAccess,
          roadmapAccess: user.roadmapAccess,
        };
      },
    }),
  ],
});
