"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth, signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import type { NodeStatus, Priority, MilestoneType } from "@prisma/client";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
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

// ---------- Project board ----------
export async function createNode(parentId: string | null, name: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) return;
  const max = await prisma.projectNode.aggregate({
    where: { parentId },
    _max: { sortOrder: true },
  });
  await prisma.projectNode.create({
    data: { name: clean, parentId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
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

// ---------- Roadmap board ----------
export async function createCategory(name: string, color: string) {
  await requireSession();
  const clean = name.trim();
  if (!clean) return;
  const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
  await prisma.category.create({
    data: { name: clean, color, sortOrder: (max._max.sortOrder ?? 0) + 1 },
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
  const cats = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
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
  const count = await prisma.category.count();
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
  await prisma.roadmapItem.create({
    data: {
      categoryId: data.categoryId,
      name: data.name.trim(),
      description: data.description,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
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
}) {
  await requireSession();
  if (!data.name.trim()) return;
  await prisma.milestone.create({
    data: {
      name: data.name.trim(),
      type: data.type,
      date: new Date(data.date),
      description: data.description,
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
