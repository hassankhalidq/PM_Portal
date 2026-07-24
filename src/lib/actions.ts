"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth, signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import type { NodeStatus, Priority, MilestoneType, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { ROADMAP_THEMES } from "@/lib/roadmapThemes";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

async function requireAdmin() {
  const session = await requireSession();
  if ((session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Admin access required.");
  }
  return session;
}

// ---------- Auth ----------
export async function login(_prev: string | undefined, formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/projects",
    });
  } catch (error) {
    if (error instanceof AuthError) return "Invalid email or password.";
    throw error;
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

// ---------- Boards ----------
export async function createBoard(name: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  const board = await prisma.board.create({ data: { name: clean } });
  revalidatePath("/projects");
  return { id: board.id };
}

export async function renameBoard(id: string, name: string, description?: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  await prisma.board.update({
    where: { id },
    data: { name: clean, ...(description !== undefined ? { description: description.trim() } : {}) },
  });
  revalidatePath("/projects");
}

export async function deleteBoard(id: string) {
  await requireSession();
  const count = await prisma.board.count();
  if (count <= 1) throw new Error("At least one board must exist.");
  const target = await prisma.board.findUnique({ where: { id } });
  if (!target) return;
  await prisma.$transaction(async (tx) => {
    await tx.board.delete({ where: { id } });
    if (target.isDefault) {
      const fallback = await tx.board.findFirst({ orderBy: { createdAt: "asc" } });
      if (fallback) await tx.board.update({ where: { id: fallback.id }, data: { isDefault: true } });
    }
  });
  revalidatePath("/projects");
}

// ---------- Project board ----------
export async function createNode(parentId: string | null, name: string, boardId?: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) return;

  let resolvedBoardId: string;
  if (parentId) {
    const parent = await prisma.projectNode.findUnique({ where: { id: parentId }, select: { boardId: true } });
    if (!parent?.boardId) throw new Error("Parent not found.");
    resolvedBoardId = parent.boardId;
  } else {
    if (!boardId) throw new Error("boardId is required for root projects.");
    resolvedBoardId = boardId;
  }

  const max = await prisma.projectNode.aggregate({
    where: { parentId },
    _max: { sortOrder: true },
  });
  await prisma.projectNode.create({
    data: { name: clean, parentId, boardId: resolvedBoardId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/projects");
}

export async function updateNode(
  id: string,
  data: {
    name?: string;
    owner?: string;
    status?: NodeStatus;
    priority?: Priority;
    progress?: number;
    link?: string;
    startDate?: string | null;
    endDate?: string | null;
    description?: string;
  }
) {
  await requireSession();
  await prisma.projectNode.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.owner !== undefined ? { owner: data.owner.trim() } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.progress !== undefined
        ? { progress: Math.max(0, Math.min(100, Math.round(data.progress))) }
        : {}),
      ...(data.link !== undefined ? { link: data.link.trim() } : {}),
      ...(data.startDate !== undefined
        ? { startDate: data.startDate ? new Date(data.startDate) : null }
        : {}),
      ...(data.endDate !== undefined
        ? { endDate: data.endDate ? new Date(data.endDate) : null }
        : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
  revalidatePath("/projects");
}

export async function reorderProjectGroups(boardId: string, orderedIds: string[]) {
  await requireSession();
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.projectNode.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  revalidatePath("/projects");
}

// ---------- Attachments ----------
export async function uploadAttachment(nodeId: string, formData: FormData) {
  await requireSession();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file selected." };
  if (file.size > 10 * 1024 * 1024) return { error: "File must be under 10MB." };

  const { put } = await import("@vercel/blob");
  const blob = await put(`attachments/${nodeId}/${Date.now()}-${file.name}`, file, {
    access: "public",
  });

  await prisma.attachment.create({
    data: { nodeId, name: file.name, url: blob.url, size: file.size },
  });
  revalidatePath("/projects");
  return { error: null };
}

export async function deleteAttachment(id: string) {
  await requireSession();
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (attachment) {
    const { del } = await import("@vercel/blob");
    await del(attachment.url).catch(() => {});
  }
  await prisma.attachment.delete({ where: { id } });
  revalidatePath("/projects");
}

export async function deleteNode(id: string) {
  await requireSession();
  await prisma.projectNode.delete({ where: { id } });
  revalidatePath("/projects");
}

export async function addComment(nodeId: string, body: string) {
  const session = await requireSession();
  const clean = body.trim();
  if (!clean) return;
  await prisma.comment.create({
    data: { nodeId, body: clean, authorId: (session.user as { id: string }).id },
  });
  revalidatePath("/projects");
}

// ---------- Roadmaps ----------
export async function createRoadmap(name: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  const roadmap = await prisma.roadmap.create({ data: { name: clean } });
  revalidatePath("/roadmap");
  return { id: roadmap.id };
}

export async function renameRoadmap(id: string, name: string, description?: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  await prisma.roadmap.update({
    where: { id },
    data: { name: clean, ...(description !== undefined ? { description: description.trim() } : {}) },
  });
  revalidatePath("/roadmap");
}

export async function deleteRoadmap(id: string) {
  await requireSession();
  const count = await prisma.roadmap.count();
  if (count <= 1) throw new Error("At least one roadmap must exist.");
  const target = await prisma.roadmap.findUnique({ where: { id } });
  if (!target) return;
  await prisma.$transaction(async (tx) => {
    await tx.roadmap.delete({ where: { id } });
    if (target.isDefault) {
      const fallback = await tx.roadmap.findFirst({ orderBy: { createdAt: "asc" } });
      if (fallback) await tx.roadmap.update({ where: { id: fallback.id }, data: { isDefault: true } });
    }
  });
  revalidatePath("/roadmap");
}

export async function applyRoadmapTheme(roadmapId: string, theme: string) {
  await requireSession();
  const preset = ROADMAP_THEMES[theme];
  if (!preset) throw new Error("Unknown theme.");
  const categories = await prisma.category.findMany({
    where: { roadmapId },
    orderBy: { sortOrder: "asc" },
  });
  await prisma.$transaction([
    prisma.roadmap.update({ where: { id: roadmapId }, data: { theme } }),
    ...categories.map((c, idx) =>
      prisma.category.update({
        where: { id: c.id },
        data: { color: preset.laneColors[idx % preset.laneColors.length] },
      })
    ),
  ]);
  revalidatePath("/roadmap");
}

// ---------- Roadmap board ----------
export async function createCategory(name: string, color: string, roadmapId: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) return;
  const max = await prisma.category.aggregate({ where: { roadmapId }, _max: { sortOrder: true } });
  await prisma.category.create({
    data: { name: clean, color, roadmapId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/roadmap");
}

export async function updateCategory(id: string, data: { name?: string; color?: string }) {
  await requireSession();
  await prisma.category.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    },
  });
  revalidatePath("/roadmap");
}

export async function moveCategory(id: string, direction: "up" | "down") {
  await requireSession();
  const current = await prisma.category.findUnique({ where: { id }, select: { roadmapId: true } });
  if (!current) return;
  const cats = await prisma.category.findMany({
    where: { roadmapId: current.roadmapId },
    orderBy: { sortOrder: "asc" },
  });
  const idx = cats.findIndex((c) => c.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= cats.length) return;
  await prisma.$transaction([
    prisma.category.update({ where: { id: cats[idx].id }, data: { sortOrder: cats[swapWith].sortOrder } }),
    prisma.category.update({ where: { id: cats[swapWith].id }, data: { sortOrder: cats[idx].sortOrder } }),
  ]);
  revalidatePath("/roadmap");
}

export async function deleteCategory(id: string) {
  await requireSession();
  const target = await prisma.category.findUnique({ where: { id }, select: { roadmapId: true } });
  if (!target) return;
  const count = await prisma.category.count({ where: { roadmapId: target.roadmapId } });
  if (count <= 1) throw new Error("At least one category must exist.");
  await prisma.category.delete({ where: { id } });
  revalidatePath("/roadmap");
}

export async function createItem(data: {
  categoryId: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
}) {
  await requireSession();
  if (!data.name.trim()) return;
  const max = await prisma.roadmapItem.aggregate({
    where: { categoryId: data.categoryId },
    _max: { sortOrder: true },
  });
  await prisma.roadmapItem.create({
    data: {
      categoryId: data.categoryId,
      name: data.name.trim(),
      description: data.description,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  revalidatePath("/roadmap");
}

export async function updateItem(
  id: string,
  data: { categoryId?: string; name?: string; description?: string; startDate?: string; endDate?: string }
) {
  await requireSession();
  await prisma.roadmapItem.update({
    where: { id },
    data: {
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.startDate !== undefined ? { startDate: new Date(data.startDate) } : {}),
      ...(data.endDate !== undefined ? { endDate: new Date(data.endDate) } : {}),
    },
  });
  revalidatePath("/roadmap");
}

export async function reorderItems(categoryId: string, orderedIds: string[]) {
  await requireSession();
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.roadmapItem.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  revalidatePath("/roadmap");
}

export async function deleteItem(id: string) {
  await requireSession();
  await prisma.roadmapItem.delete({ where: { id } });
  revalidatePath("/roadmap");
}

export async function createMilestone(data: {
  name: string;
  type: MilestoneType;
  date: string;
  description: string;
  roadmapId: string;
}) {
  await requireSession();
  if (!data.name.trim()) return;
  await prisma.milestone.create({
    data: {
      name: data.name.trim(),
      type: data.type,
      date: new Date(data.date),
      description: data.description,
      roadmapId: data.roadmapId,
    },
  });
  revalidatePath("/roadmap");
}

export async function updateMilestone(
  id: string,
  data: { name?: string; type?: MilestoneType; date?: string; description?: string }
) {
  await requireSession();
  await prisma.milestone.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
  revalidatePath("/roadmap");
}

export async function deleteMilestone(id: string) {
  await requireSession();
  await prisma.milestone.delete({ where: { id } });
  revalidatePath("/roadmap");
}

// ---------- Admin: user management ----------
export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role: Role;
}) {
  await requireAdmin();
  const email = data.email.trim().toLowerCase();
  const name = data.name.trim();
  if (!email || !name) throw new Error("Email and name are required.");
  if (data.password.length < 8) throw new Error("Password must be at least 8 characters.");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("A user with that email already exists.");
  const passwordHash = await hash(data.password, 12);
  await prisma.user.create({ data: { email, name, passwordHash, role: data.role } });
  revalidatePath("/admin/users");
}

export async function updateUserRole(id: string, role: Role) {
  await requireAdmin();
  if (role !== "ADMIN") {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) throw new Error("At least one admin must remain.");
    }
  }
  await prisma.user.update({ where: { id }, data: { role } });
  revalidatePath("/admin/users");
}

export async function deleteUser(id: string) {
  const session = await requireAdmin();
  if ((session.user as { id: string }).id === id) {
    throw new Error("You cannot delete your own account.");
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;
  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) throw new Error("At least one admin must remain.");
  }
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
}
