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
        org: { label: "Organization", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const orgSlug = String(credentials?.org ?? "").toLowerCase().trim();
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const password = String(credentials?.password ?? "");
        if (!orgSlug || !email || !password) return null;

        const organization = await prisma.organization.findUnique({ where: { slug: orgSlug } });
        if (!organization) return null;

        const user = await prisma.user.findUnique({
          where: { orgId_email: { orgId: organization.id, email } },
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
          orgSlug: organization.slug,
          projectAccess: user.projectAccess,
          roadmapAccess: user.roadmapAccess,
        };
      },
    }),
  ],
});
