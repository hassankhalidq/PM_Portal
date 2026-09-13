"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth, signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import type { NodeStatus, Priority, MilestoneType, RoadmapStage, Role, AccessLevel } from "@prisma/client";
import { hash } from "bcryptjs";
import { ROADMAP_THEMES } from "@/lib/roadmapThemes";

// ---------- Session / access-control helpers ----------
// Every write in this file funnels through one of these. SUPER_ADMIN bypasses
// both the org boundary and the per-section access level everywhere; every
// other role is confined to its own org, and further gated by
// projectAccess/roadmapAccess for the two boards.
type SessionCtx = {
  id: string;
  role: string;
  orgId: string;
  projectAccess: string;
  roadmapAccess: string;
};

function isSuperAdmin(ctx: SessionCtx) {
  return ctx.role === "SUPER_ADMIN";
}

async function requireSession(): Promise<SessionCtx> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const u = session.user as {
    id: string;
    role: string;
    orgId: string;
    projectAccess: string;
    roadmapAccess: string;
  };
  return { id: u.id, role: u.role, orgId: u.orgId, projectAccess: u.projectAccess, roadmapAccess: u.roadmapAccess };
}

async function requireAdmin(): Promise<SessionCtx> {
  const ctx = await requireSession();
  if (ctx.role !== "ADMIN" && !isSuperAdmin(ctx)) throw new Error("Admin access required.");
  return ctx;
}

async function requireSuperAdmin(): Promise<SessionCtx> {
  const ctx = await requireSession();
  if (!isSuperAdmin(ctx)) throw new Error("Super admin access required.");
  return ctx;
}

// Board write guard: EDIT access (or super admin) required for any mutation
// under the Project board.
async function requireProjectEdit(): Promise<SessionCtx> {
  const ctx = await requireSession();
  if (!isSuperAdmin(ctx) && ctx.projectAccess !== "EDIT") {
    throw new Error("You have read-only access to the Project board.");
  }
  return ctx;
}

// Same, for the Roadmap board.
async function requireRoadmapEdit(): Promise<SessionCtx> {
  const ctx = await requireSession();
  if (!isSuperAdmin(ctx) && ctx.roadmapAccess !== "EDIT") {
    throw new Error("You have read-only access to the Roadmap board.");
  }
  return ctx;
}

// Resource ownership checks. Each resolves the minimal chain up to the
// owning org and throws "Not found" (not "Forbidden") on a mismatch, so a
// cross-org id doesn't even confirm that the row exists. Super admin skips
// the lookup entirely.
async function assertBoardInOrg(boardId: string, ctx: SessionCtx) {
  if (isSuperAdmin(ctx)) return;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { orgId: true } });
  if (!board || board.orgId !== ctx.orgId) throw new Error("Not found.");
}

async function assertRoadmapInOrg(roadmapId: string, ctx: SessionCtx) {
  if (isSuperAdmin(ctx)) return;
  const roadmap = await prisma.roadmap.findUnique({ where: { id: roadmapId }, select: { orgId: true } });
  if (!roadmap || roadmap.orgId !== ctx.orgId) throw new Error("Not found.");
}

async function assertNodeInOrg(nodeId: string, ctx: SessionCtx) {
  if (isSuperAdmin(ctx)) return;
  const node = await prisma.projectNode.findUnique({
    where: { id: nodeId },
    select: { board: { select: { orgId: true } } },
  });
  if (!node?.board || node.board.orgId !== ctx.orgId) throw new Error("Not found.");
}

// Returns the category's roadmap org (also used to resolve items/milestones
// via their categoryId) so callers needing the id back (e.g. to derive the
// true roadmapId rather than trust a client-supplied one) can reuse it.
async function categoryOrg(categoryId: string): Promise<{ orgId: string; roadmapId: string } | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { roadmapId: true, roadmap: { select: { orgId: true } } },
  });
  if (!category?.roadmap || !category.roadmapId) return null;
  return { orgId: category.roadmap.orgId, roadmapId: category.roadmapId };
}

async function assertCategoryInOrg(categoryId: string, ctx: SessionCtx) {
  const org = await categoryOrg(categoryId);
  if (!isSuperAdmin(ctx) && (!org || org.orgId !== ctx.orgId)) throw new Error("Not found.");
  return org;
}

// ---------- Auth ----------
export async function login(_prev: string | undefined, formData: FormData) {
  try {
    await signIn("credentials", {
      org: formData.get("org"),
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/projects",
    });
  } catch (error) {
    if (error instanceof AuthError) return "Invalid organization, email, or password.";
    throw error;
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

// ---------- Boards ----------
// orgId is accepted only so a super admin can target a specific company
// while viewing it; for every other role the server ignores it and always
// uses the caller's own org — never trust a client-supplied org otherwise.
export async function createBoard(name: string, orgId?: string) {
  const ctx = await requireProjectEdit();
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  const targetOrgId = isSuperAdmin(ctx) && orgId ? orgId : ctx.orgId;
  const board = await prisma.board.create({ data: { name: clean, orgId: targetOrgId } });
  revalidatePath("/projects");
  return { id: board.id };
}

export async function renameBoard(id: string, name: string, description?: string) {
  const ctx = await requireProjectEdit();
  await assertBoardInOrg(id, ctx);
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  await prisma.board.update({
    where: { id },
    data: { name: clean, ...(description !== undefined ? { description: description.trim() } : {}) },
  });
  revalidatePath("/projects");
}

export async function deleteBoard(id: string) {
  const ctx = await requireProjectEdit();
  const target = await prisma.board.findUnique({ where: { id } });
  if (!target) return;
  if (!isSuperAdmin(ctx) && target.orgId !== ctx.orgId) throw new Error("Not found.");
  const count = await prisma.board.count({ where: { orgId: target.orgId } });
  if (count <= 1) throw new Error("At least one board must exist.");
  await prisma.$transaction(async (tx) => {
    await tx.board.delete({ where: { id } });
    if (target.isDefault) {
      const fallback = await tx.board.findFirst({ where: { orgId: target.orgId }, orderBy: { createdAt: "asc" } });
      if (fallback) await tx.board.update({ where: { id: fallback.id }, data: { isDefault: true } });
    }
  });
  revalidatePath("/projects");
}

// ---------- Project board ----------
export async function createNode(parentId: string | null, name: string, boardId?: string) {
  const ctx = await requireProjectEdit();
  const clean = name.trim();
  if (!clean) return;

  let resolvedBoardId: string;
  if (parentId) {
    await assertNodeInOrg(parentId, ctx);
    const parent = await prisma.projectNode.findUnique({ where: { id: parentId }, select: { boardId: true } });
    if (!parent?.boardId) throw new Error("Parent not found.");
    resolvedBoardId = parent.boardId;
  } else {
    if (!boardId) throw new Error("boardId is required for root projects.");
    await assertBoardInOrg(boardId, ctx);
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
    blockReason?: string;
    request?: string;
  }
) {
  const ctx = await requireProjectEdit();
  await assertNodeInOrg(id, ctx);
  // A node with children shows a progress rollup, not its own raw field —
  // the UI never sends `progress` for one, but guard it here too so a
  // direct call can't silently desync a parent's stored value from what
  // it's actually displaying.
  let progress = data.progress;
  if (progress !== undefined) {
    const childCount = await prisma.projectNode.count({ where: { parentId: id } });
    if (childCount > 0) progress = undefined;
  }
  await prisma.projectNode.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.owner !== undefined ? { owner: data.owner.trim() } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, Math.round(progress))) } : {}),
      ...(data.link !== undefined ? { link: data.link.trim() } : {}),
      ...(data.startDate !== undefined
        ? { startDate: data.startDate ? new Date(data.startDate) : null }
        : {}),
      ...(data.endDate !== undefined
        ? { endDate: data.endDate ? new Date(data.endDate) : null }
        : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.blockReason !== undefined ? { blockReason: data.blockReason } : {}),
      ...(data.request !== undefined ? { request: data.request.trim() } : {}),
    },
  });
  revalidatePath("/projects");
}

export async function reorderProjectGroups(orderedIds: string[]) {
  const ctx = await requireProjectEdit();
  if (!isSuperAdmin(ctx) && orderedIds.length > 0) {
    const rows = await prisma.projectNode.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true, board: { select: { orgId: true } } },
    });
    if (rows.length !== orderedIds.length || rows.some((r) => r.board?.orgId !== ctx.orgId)) {
      throw new Error("Not found.");
    }
  }
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.projectNode.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  revalidatePath("/projects");
}

// ---------- Attachments ----------
export async function uploadAttachment(nodeId: string, formData: FormData) {
  const ctx = await requireProjectEdit();
  await assertNodeInOrg(nodeId, ctx);
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
  const ctx = await requireProjectEdit();
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: { node: { select: { board: { select: { orgId: true } } } } },
  });
  if (!attachment) return;
  if (!isSuperAdmin(ctx) && attachment.node.board?.orgId !== ctx.orgId) throw new Error("Not found.");
  const { del } = await import("@vercel/blob");
  await del(attachment.url).catch(() => {});
  await prisma.attachment.delete({ where: { id } });
  revalidatePath("/projects");
}

export async function deleteNode(id: string) {
  const ctx = await requireProjectEdit();
  await assertNodeInOrg(id, ctx);
  await prisma.projectNode.delete({ where: { id } });
  revalidatePath("/projects");
}

export async function addComment(nodeId: string, body: string) {
  const ctx = await requireProjectEdit();
  await assertNodeInOrg(nodeId, ctx);
  const clean = body.trim();
  if (!clean) return;
  await prisma.comment.create({
    data: { nodeId, body: clean, authorId: ctx.id },
  });
  revalidatePath("/projects");
}

// ---------- Log entries ----------
export async function createLogEntry(
  nodeId: string,
  data: { date: string; activity: string; owner?: string; waitingOn?: string; status?: string; remarks?: string }
) {
  const ctx = await requireProjectEdit();
  await assertNodeInOrg(nodeId, ctx);
  const activity = data.activity.trim();
  if (!activity) throw new Error("Activity is required.");
  await prisma.logEntry.create({
    data: {
      nodeId,
      date: new Date(data.date),
      activity,
      owner: (data.owner ?? "").trim(),
      waitingOn: (data.waitingOn ?? "").trim(),
      status: (data.status ?? "").trim(),
      remarks: (data.remarks ?? "").trim(),
    },
  });
  revalidatePath("/projects");
}

export async function updateLogEntry(
  id: string,
  data: Partial<{ date: string; nodeId: string; activity: string; owner: string; waitingOn: string; status: string; remarks: string }>
) {
  const ctx = await requireProjectEdit();
  if (!isSuperAdmin(ctx)) {
    const entry = await prisma.logEntry.findUnique({
      where: { id },
      select: { node: { select: { board: { select: { orgId: true } } } } },
    });
    if (!entry?.node.board || entry.node.board.orgId !== ctx.orgId) throw new Error("Not found.");
  }
  if (data.nodeId !== undefined) await assertNodeInOrg(data.nodeId, ctx);
  if (data.activity !== undefined && !data.activity.trim()) throw new Error("Activity is required.");
  await prisma.logEntry.update({
    where: { id },
    data: {
      ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
      ...(data.nodeId !== undefined ? { nodeId: data.nodeId } : {}),
      ...(data.activity !== undefined ? { activity: data.activity.trim() } : {}),
      ...(data.owner !== undefined ? { owner: data.owner.trim() } : {}),
      ...(data.waitingOn !== undefined ? { waitingOn: data.waitingOn.trim() } : {}),
      ...(data.status !== undefined ? { status: data.status.trim() } : {}),
      ...(data.remarks !== undefined ? { remarks: data.remarks.trim() } : {}),
    },
  });
  revalidatePath("/projects");
}

export async function deleteLogEntry(id: string) {
  const ctx = await requireProjectEdit();
  if (!isSuperAdmin(ctx)) {
    const entry = await prisma.logEntry.findUnique({
      where: { id },
      select: { node: { select: { board: { select: { orgId: true } } } } },
    });
    if (!entry?.node.board || entry.node.board.orgId !== ctx.orgId) throw new Error("Not found.");
  }
  await prisma.logEntry.delete({ where: { id } });
  revalidatePath("/projects");
}

// ---------- Weekly status ----------
type BlockerTeamInput = { team: string; days: number };
type BlockerDetailInput = { detail: string; team: string };

function sanitizeBlockerTeams(teams: BlockerTeamInput[]) {
  return teams
    .map((t) => ({ team: (t.team ?? "").trim(), days: Math.max(0, Math.round(Number(t.days) || 0)) }))
    .filter((t) => t.team.length > 0);
}
function sanitizeBlockerDetails(details: BlockerDetailInput[]) {
  return details
    .map((d) => ({ detail: (d.detail ?? "").trim(), team: (d.team ?? "").trim() }))
    .filter((d) => d.detail.length > 0);
}

export async function createWeeklyStatus(
  boardId: string,
  data: {
    weekStart: string;
    weekEnd: string;
    label?: string;
    summary?: string;
    issuesFound?: number;
    issuesResolved?: number;
    blockerTeams?: BlockerTeamInput[];
    blockerDetails?: BlockerDetailInput[];
  }
) {
  const ctx = await requireProjectEdit();
  await assertBoardInOrg(boardId, ctx);
  if (!data.weekStart || !data.weekEnd) throw new Error("Week start and end are required.");
  if (new Date(data.weekEnd) < new Date(data.weekStart)) throw new Error("Week end must be on or after week start.");
  await prisma.weeklyStatus.create({
    data: {
      boardId,
      weekStart: new Date(data.weekStart),
      weekEnd: new Date(data.weekEnd),
      label: (data.label ?? "").trim(),
      summary: (data.summary ?? "").trim(),
      issuesFound: Math.max(0, Math.round(data.issuesFound ?? 0)),
      issuesResolved: Math.max(0, Math.round(data.issuesResolved ?? 0)),
      blockerTeams: sanitizeBlockerTeams(data.blockerTeams ?? []),
      blockerDetails: sanitizeBlockerDetails(data.blockerDetails ?? []),
    },
  });
  revalidatePath("/projects");
}

export async function updateWeeklyStatus(
  id: string,
  data: Partial<{
    weekStart: string;
    weekEnd: string;
    label: string;
    summary: string;
    issuesFound: number;
    issuesResolved: number;
    blockerTeams: BlockerTeamInput[];
    blockerDetails: BlockerDetailInput[];
  }>
) {
  const ctx = await requireProjectEdit();
  if (!isSuperAdmin(ctx)) {
    const status = await prisma.weeklyStatus.findUnique({ where: { id }, select: { board: { select: { orgId: true } } } });
    if (!status?.board || status.board.orgId !== ctx.orgId) throw new Error("Not found.");
  }
  if (data.weekStart !== undefined && data.weekEnd !== undefined && new Date(data.weekEnd) < new Date(data.weekStart)) {
    throw new Error("Week end must be on or after week start.");
  }
  await prisma.weeklyStatus.update({
    where: { id },
    data: {
      ...(data.weekStart !== undefined ? { weekStart: new Date(data.weekStart) } : {}),
      ...(data.weekEnd !== undefined ? { weekEnd: new Date(data.weekEnd) } : {}),
      ...(data.label !== undefined ? { label: data.label.trim() } : {}),
      ...(data.summary !== undefined ? { summary: data.summary.trim() } : {}),
      ...(data.issuesFound !== undefined ? { issuesFound: Math.max(0, Math.round(data.issuesFound)) } : {}),
      ...(data.issuesResolved !== undefined ? { issuesResolved: Math.max(0, Math.round(data.issuesResolved)) } : {}),
      ...(data.blockerTeams !== undefined ? { blockerTeams: sanitizeBlockerTeams(data.blockerTeams) } : {}),
      ...(data.blockerDetails !== undefined ? { blockerDetails: sanitizeBlockerDetails(data.blockerDetails) } : {}),
    },
  });
  revalidatePath("/projects");
}

export async function deleteWeeklyStatus(id: string) {
  const ctx = await requireProjectEdit();
  if (!isSuperAdmin(ctx)) {
    const status = await prisma.weeklyStatus.findUnique({ where: { id }, select: { board: { select: { orgId: true } } } });
    if (!status?.board || status.board.orgId !== ctx.orgId) throw new Error("Not found.");
  }
  await prisma.weeklyStatus.delete({ where: { id } });
  revalidatePath("/projects");
}

// ---------- Item dependencies ----------
export async function addDependency(predecessorId: string, successorId: string) {
  const ctx = await requireProjectEdit();
  if (predecessorId === successorId) throw new Error("An item can't depend on itself.");
  await assertNodeInOrg(predecessorId, ctx);

  const [predecessor, successor] = await Promise.all([
    prisma.projectNode.findUnique({ where: { id: predecessorId }, select: { boardId: true } }),
    prisma.projectNode.findUnique({ where: { id: successorId }, select: { boardId: true } }),
  ]);
  if (!predecessor || !successor) throw new Error("Item not found.");
  if (predecessor.boardId !== successor.boardId) {
    throw new Error("Items must be on the same board to be linked.");
  }

  // Reject if this edge would close a cycle: walk forward from the proposed
  // successor through existing predecessor->successor edges: if that walk
  // ever reaches the proposed predecessor, adding predecessor->successor
  // would make a loop.
  const edges = await prisma.itemDependency.findMany({
    where: { predecessor: { boardId: predecessor.boardId } },
    select: { predecessorId: true, successorId: true },
  });
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    const list = forward.get(e.predecessorId) ?? [];
    list.push(e.successorId);
    forward.set(e.predecessorId, list);
  }
  const seen = new Set<string>();
  const queue = [successorId];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === predecessorId) throw new Error("That link would create a circular dependency.");
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(forward.get(current) ?? []));
  }

  await prisma.itemDependency.upsert({
    where: { predecessorId_successorId: { predecessorId, successorId } },
    create: { predecessorId, successorId },
    update: {},
  });
  revalidatePath("/projects");
}

export async function removeDependency(id: string) {
  const ctx = await requireProjectEdit();
  if (!isSuperAdmin(ctx)) {
    const dep = await prisma.itemDependency.findUnique({
      where: { id },
      select: { predecessor: { select: { board: { select: { orgId: true } } } } },
    });
    if (!dep?.predecessor.board || dep.predecessor.board.orgId !== ctx.orgId) throw new Error("Not found.");
  }
  await prisma.itemDependency.delete({ where: { id } });
  revalidatePath("/projects");
}

// ---------- Roadmaps ----------
export async function createRoadmap(name: string, orgId?: string) {
  const ctx = await requireRoadmapEdit();
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  const targetOrgId = isSuperAdmin(ctx) && orgId ? orgId : ctx.orgId;
  const roadmap = await prisma.roadmap.create({ data: { name: clean, orgId: targetOrgId } });
  revalidatePath("/roadmap");
  return { id: roadmap.id };
}

export async function renameRoadmap(id: string, name: string, description?: string) {
  const ctx = await requireRoadmapEdit();
  await assertRoadmapInOrg(id, ctx);
  const clean = name.trim();
  if (!clean) throw new Error("Name is required.");
  await prisma.roadmap.update({
    where: { id },
    data: { name: clean, ...(description !== undefined ? { description: description.trim() } : {}) },
  });
  revalidatePath("/roadmap");
}

export async function deleteRoadmap(id: string) {
  const ctx = await requireRoadmapEdit();
  const target = await prisma.roadmap.findUnique({ where: { id } });
  if (!target) return;
  if (!isSuperAdmin(ctx) && target.orgId !== ctx.orgId) throw new Error("Not found.");
  const count = await prisma.roadmap.count({ where: { orgId: target.orgId } });
  if (count <= 1) throw new Error("At least one roadmap must exist.");
  await prisma.$transaction(async (tx) => {
    await tx.roadmap.delete({ where: { id } });
    if (target.isDefault) {
      const fallback = await tx.roadmap.findFirst({ where: { orgId: target.orgId }, orderBy: { createdAt: "asc" } });
      if (fallback) await tx.roadmap.update({ where: { id: fallback.id }, data: { isDefault: true } });
    }
  });
  revalidatePath("/roadmap");
}

export async function applyRoadmapTheme(roadmapId: string, theme: string) {
  const ctx = await requireRoadmapEdit();
  await assertRoadmapInOrg(roadmapId, ctx);
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
  const ctx = await requireRoadmapEdit();
  await assertRoadmapInOrg(roadmapId, ctx);
  const clean = name.trim();
  if (!clean) return;
  const max = await prisma.category.aggregate({ where: { roadmapId }, _max: { sortOrder: true } });
  await prisma.category.create({
    data: { name: clean, color, roadmapId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/roadmap");
}

export async function updateCategory(id: string, data: { name?: string; color?: string }) {
  const ctx = await requireRoadmapEdit();
  await assertCategoryInOrg(id, ctx);
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
  const ctx = await requireRoadmapEdit();
  await assertCategoryInOrg(id, ctx);
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
  const ctx = await requireRoadmapEdit();
  await assertCategoryInOrg(id, ctx);
  const target = await prisma.category.findUnique({ where: { id }, select: { roadmapId: true } });
  if (!target) return;
  const count = await prisma.category.count({ where: { roadmapId: target.roadmapId } });
  if (count <= 1) throw new Error("At least one category must exist.");
  await prisma.category.delete({ where: { id } });
  revalidatePath("/roadmap");
}

// Inserts a new item/milestone at the sortOrder rank matching its date among
// the category's existing entries (both kinds), bumping everyone at/after
// that rank up by one — rather than always appending at the end. sortOrder
// is the primary key roadmap lane packing sorts by, so an out-of-chronological
// -order insert (e.g. backfilling an earlier item after later ones already
// exist) would otherwise pack last and needlessly open a new row.
async function nextSortOrderForDate(categoryId: string, dateMs: number): Promise<number> {
  const [items, mss] = await Promise.all([
    prisma.roadmapItem.findMany({ where: { categoryId }, select: { id: true, sortOrder: true, startDate: true } }),
    prisma.milestone.findMany({ where: { categoryId }, select: { id: true, sortOrder: true, date: true } }),
  ]);
  const rank =
    items.filter((i) => i.startDate.getTime() <= dateMs).length +
    mss.filter((m) => m.date.getTime() <= dateMs).length;
  const bumpItems = items.filter((i) => i.sortOrder >= rank);
  const bumpMs = mss.filter((m) => m.sortOrder >= rank);
  if (bumpItems.length > 0 || bumpMs.length > 0) {
    await prisma.$transaction([
      ...bumpItems.map((i) => prisma.roadmapItem.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder + 1 } })),
      ...bumpMs.map((m) => prisma.milestone.update({ where: { id: m.id }, data: { sortOrder: m.sortOrder + 1 } })),
    ]);
  }
  return rank;
}

// Append-at-end sortOrder for an entry moving into a category via the edit
// form's Lane dropdown (as opposed to a drag, which computes its own via
// commitLaneDrop) — keeps the destination lane's packing well-defined
// instead of leaving the entry's old, now-meaningless sortOrder in place.
async function appendSortOrder(categoryId: string): Promise<number> {
  const [maxItem, maxMs] = await Promise.all([
    prisma.roadmapItem.aggregate({ where: { categoryId }, _max: { sortOrder: true } }),
    prisma.milestone.aggregate({ where: { categoryId }, _max: { sortOrder: true } }),
  ]);
  return Math.max(maxItem._max.sortOrder ?? -1, maxMs._max.sortOrder ?? -1) + 1;
}

export async function createItem(data: {
  categoryId: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  stage?: RoadmapStage;
}) {
  const ctx = await requireRoadmapEdit();
  await assertCategoryInOrg(data.categoryId, ctx);
  if (!data.name.trim()) return;
  const sortOrder = await nextSortOrderForDate(data.categoryId, new Date(data.startDate).getTime());
  await prisma.roadmapItem.create({
    data: {
      categoryId: data.categoryId,
      name: data.name.trim(),
      description: data.description,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      ...(data.stage !== undefined ? { stage: data.stage } : {}),
      sortOrder,
    },
  });
  revalidatePath("/roadmap");
}

export async function updateItem(
  id: string,
  data: {
    categoryId?: string;
    name?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    stage?: RoadmapStage;
  }
) {
  const ctx = await requireRoadmapEdit();
  const item = await prisma.roadmapItem.findUnique({ where: { id }, select: { categoryId: true } });
  if (!item) return;
  await assertCategoryInOrg(item.categoryId, ctx);
  if (data.categoryId !== undefined) await assertCategoryInOrg(data.categoryId, ctx);
  const sortOrder = data.categoryId !== undefined ? await appendSortOrder(data.categoryId) : undefined;
  await prisma.roadmapItem.update({
    where: { id },
    data: {
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId, sortOrder } : {}),
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.startDate !== undefined ? { startDate: new Date(data.startDate) } : {}),
      ...(data.endDate !== undefined ? { endDate: new Date(data.endDate) } : {}),
      ...(data.stage !== undefined ? { stage: data.stage } : {}),
    },
  });
  revalidatePath("/roadmap");
}

export async function deleteItem(id: string) {
  const ctx = await requireRoadmapEdit();
  const item = await prisma.roadmapItem.findUnique({ where: { id }, select: { categoryId: true } });
  if (!item) return;
  await assertCategoryInOrg(item.categoryId, ctx);
  await prisma.roadmapItem.delete({ where: { id } });
  revalidatePath("/roadmap");
}

// Converts a roadmap item into a milestone (its start date becomes the
// milestone's date, type defaults to RELEASE) or vice versa (a milestone
// becomes a 21-day item starting on its date, stage defaults to EXPLORING —
// it's a fresh idea again, not yet scheduled with confidence). Each is one
// create+delete transaction so a failure never leaves both records behind.
export async function convertItemToMilestone(id: string) {
  const ctx = await requireRoadmapEdit();
  const item = await prisma.roadmapItem.findUniqueOrThrow({ where: { id } });
  await assertCategoryInOrg(item.categoryId, ctx);
  const sortOrder = await nextSortOrderForDate(item.categoryId, item.startDate.getTime());
  await prisma.$transaction([
    prisma.milestone.create({
      data: {
        name: item.name,
        type: "RELEASE",
        date: item.startDate,
        description: item.description,
        categoryId: item.categoryId,
        sortOrder,
      },
    }),
    prisma.roadmapItem.delete({ where: { id } }),
  ]);
  revalidatePath("/roadmap");
}

export async function convertMilestoneToItem(id: string) {
  const ctx = await requireRoadmapEdit();
  const ms = await prisma.milestone.findUniqueOrThrow({ where: { id } });
  await assertCategoryInOrg(ms.categoryId, ctx);
  const endDate = new Date(ms.date.getTime() + 21 * 86400000);
  const sortOrder = await nextSortOrderForDate(ms.categoryId, ms.date.getTime());
  await prisma.$transaction([
    prisma.roadmapItem.create({
      data: {
        name: ms.name,
        description: ms.description,
        startDate: ms.date,
        endDate,
        stage: "EXPLORING",
        categoryId: ms.categoryId,
        sortOrder,
      },
    }),
    prisma.milestone.delete({ where: { id } }),
  ]);
  revalidatePath("/roadmap");
}

export async function createMilestone(data: {
  name: string;
  type: MilestoneType;
  date: string;
  description: string;
  roadmapId: string;
  categoryId: string;
}) {
  const ctx = await requireRoadmapEdit();
  const org = await assertCategoryInOrg(data.categoryId, ctx);
  if (!data.name.trim()) return;
  const sortOrder = await nextSortOrderForDate(data.categoryId, new Date(data.date).getTime());
  await prisma.milestone.create({
    data: {
      name: data.name.trim(),
      type: data.type,
      date: new Date(data.date),
      description: data.description,
      // Derived from the category rather than trusting the client's
      // roadmapId directly — they must agree, and the category is what the
      // org check above already verified.
      roadmapId: org ? org.roadmapId : data.roadmapId,
      categoryId: data.categoryId,
      sortOrder,
    },
  });
  revalidatePath("/roadmap");
}

export async function updateMilestone(
  id: string,
  data: { name?: string; type?: MilestoneType; date?: string; description?: string; categoryId?: string }
) {
  const ctx = await requireRoadmapEdit();
  const ms = await prisma.milestone.findUnique({ where: { id }, select: { categoryId: true } });
  if (!ms) return;
  await assertCategoryInOrg(ms.categoryId, ctx);
  if (data.categoryId !== undefined) await assertCategoryInOrg(data.categoryId, ctx);
  const sortOrder = data.categoryId !== undefined ? await appendSortOrder(data.categoryId) : undefined;
  await prisma.milestone.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId, sortOrder } : {}),
    },
  });
  revalidatePath("/roadmap");
}

// Commits a manual drag-to-row drop: renumbers the destination lane's full
// item+milestone sequence to dense 0..N-1 (computed client-side from the
// live drag position) and folds the dragged entry's own resolved date/lane
// patch into that same per-row update, in one transaction.
export async function commitLaneDrop(params: {
  categoryId: string;
  orderedEntries: { id: string; kind: "item" | "milestone" }[];
  draggedId: string;
  itemDates?: { startDate: string; endDate: string };
  milestoneDate?: string;
  categoryChanged: boolean;
}) {
  const ctx = await requireRoadmapEdit();
  const { categoryId, orderedEntries, draggedId, itemDates, milestoneDate, categoryChanged } = params;
  await assertCategoryInOrg(categoryId, ctx);
  if (!isSuperAdmin(ctx)) {
    const itemIds = orderedEntries.filter((e) => e.kind === "item").map((e) => e.id);
    const msIds = orderedEntries.filter((e) => e.kind === "milestone").map((e) => e.id);
    const [items, mss] = await Promise.all([
      prisma.roadmapItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, category: { select: { roadmap: { select: { orgId: true } } } } },
      }),
      prisma.milestone.findMany({
        where: { id: { in: msIds } },
        select: { id: true, category: { select: { roadmap: { select: { orgId: true } } } } },
      }),
    ]);
    const allInOrg =
      items.length === itemIds.length &&
      mss.length === msIds.length &&
      items.every((i) => i.category?.roadmap?.orgId === ctx.orgId) &&
      mss.every((m) => m.category?.roadmap?.orgId === ctx.orgId);
    if (!allInOrg) throw new Error("Not found.");
  }
  await prisma.$transaction(
    orderedEntries.map(({ id, kind }, index) => {
      const isDragged = id === draggedId;
      if (kind === "item") {
        const patch = isDragged
          ? {
              ...(itemDates ? { startDate: new Date(itemDates.startDate), endDate: new Date(itemDates.endDate) } : {}),
              ...(categoryChanged ? { categoryId } : {}),
            }
          : {};
        return prisma.roadmapItem.update({ where: { id }, data: { sortOrder: index, ...patch } });
      }
      const patch = isDragged
        ? {
            ...(milestoneDate ? { date: new Date(milestoneDate) } : {}),
            ...(categoryChanged ? { categoryId } : {}),
          }
        : {};
      return prisma.milestone.update({ where: { id }, data: { sortOrder: index, ...patch } });
    })
  );
  revalidatePath("/roadmap");
}

export async function deleteMilestone(id: string) {
  const ctx = await requireRoadmapEdit();
  const ms = await prisma.milestone.findUnique({ where: { id }, select: { categoryId: true } });
  if (!ms) return;
  await assertCategoryInOrg(ms.categoryId, ctx);
  await prisma.milestone.delete({ where: { id } });
  revalidatePath("/roadmap");
}

// ---------- Admin: organizations (super admin only) ----------
export async function createOrganization(name: string, slug: string) {
  await requireSuperAdmin();
  const cleanName = name.trim();
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!cleanName || !cleanSlug) throw new Error("Name and slug are required.");
  const existing = await prisma.organization.findUnique({ where: { slug: cleanSlug } });
  if (existing) throw new Error("That organization slug is already in use.");
  const org = await prisma.organization.create({
    data: {
      name: cleanName,
      slug: cleanSlug,
      // A fresh org needs at least one board and one roadmap to be usable —
      // matches what seed.mjs sets up for the very first org.
      boards: { create: { name: "General", isDefault: true } },
      roadmaps: {
        create: { name: "General", isDefault: true, theme: "indigo", categories: { create: { name: "General", color: "#0E7A5F" } } },
      },
    },
  });
  revalidatePath("/admin/users");
  return { id: org.id, slug: org.slug };
}

// ---------- Admin: user management ----------
// orgId/role here can only diverge from "caller's own org" / "never above
// ADMIN" when the caller is themselves SUPER_ADMIN — checked explicitly
// below, not just left to whatever the client sends.
export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role: Role;
  orgId?: string;
  projectAccess?: AccessLevel;
  roadmapAccess?: AccessLevel;
}) {
  const ctx = await requireAdmin();
  const superAdmin = isSuperAdmin(ctx);
  if (data.role === "SUPER_ADMIN" && !superAdmin) {
    throw new Error("Only a super admin can create another super admin.");
  }
  const targetOrgId = superAdmin && data.orgId ? data.orgId : ctx.orgId;

  const email = data.email.trim().toLowerCase();
  const name = data.name.trim();
  if (!email || !name) throw new Error("Email and name are required.");
  if (data.password.length < 8) throw new Error("Password must be at least 8 characters.");
  const existing = await prisma.user.findUnique({ where: { orgId_email: { orgId: targetOrgId, email } } });
  if (existing) throw new Error("A user with that email already exists in this organization.");
  const passwordHash = await hash(data.password, 12);
  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: data.role,
      orgId: targetOrgId,
      projectAccess: data.projectAccess ?? "EDIT",
      roadmapAccess: data.roadmapAccess ?? "EDIT",
    },
  });
  revalidatePath("/admin/users");
}

async function assertSameOrgTarget(targetId: string, ctx: SessionCtx) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return null;
  if (!isSuperAdmin(ctx)) {
    if (target.orgId !== ctx.orgId) throw new Error("Not found.");
    if (target.role === "SUPER_ADMIN") throw new Error("Only a super admin can modify a super admin account.");
  }
  return target;
}

export async function updateUserRole(id: string, role: Role) {
  const ctx = await requireAdmin();
  const target = await assertSameOrgTarget(id, ctx);
  if (!target) return;
  if (role === "SUPER_ADMIN" && !isSuperAdmin(ctx)) {
    throw new Error("Only a super admin can grant super admin.");
  }
  if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const superAdminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
    if (superAdminCount <= 1) throw new Error("At least one super admin must remain.");
  }
  if (target.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN", orgId: target.orgId } });
    if (adminCount <= 1) throw new Error("At least one admin must remain in this organization.");
  }
  await prisma.user.update({ where: { id }, data: { role } });
  revalidatePath("/admin/users");
}

export async function updateUserAccess(
  id: string,
  data: { projectAccess?: AccessLevel; roadmapAccess?: AccessLevel }
) {
  const ctx = await requireAdmin();
  const target = await assertSameOrgTarget(id, ctx);
  if (!target) return;
  await prisma.user.update({
    where: { id },
    data: {
      ...(data.projectAccess !== undefined ? { projectAccess: data.projectAccess } : {}),
      ...(data.roadmapAccess !== undefined ? { roadmapAccess: data.roadmapAccess } : {}),
    },
  });
  revalidatePath("/admin/users");
}

export async function deleteUser(id: string) {
  const ctx = await requireAdmin();
  if (ctx.id === id) {
    throw new Error("You cannot delete your own account.");
  }
  const target = await assertSameOrgTarget(id, ctx);
  if (!target) return;
  if (target.role === "SUPER_ADMIN") {
    const superAdminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
    if (superAdminCount <= 1) throw new Error("At least one super admin must remain.");
  }
  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN", orgId: target.orgId } });
    if (adminCount <= 1) throw new Error("At least one admin must remain in this organization.");
  }
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
}
