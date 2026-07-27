"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addComment,
  addDependency,
  createBoard,
  createLogEntry,
  createNode,
  deleteAttachment,
  deleteBoard,
  deleteLogEntry,
  deleteNode,
  removeDependency,
  renameBoard,
  reorderProjectGroups,
  updateLogEntry,
  updateNode,
  uploadAttachment,
} from "@/lib/actions";
import EntitySwitcher from "@/components/EntitySwitcher";

type CommentT = { id: string; body: string; author: string; createdAt: string };
type AttachmentT = { id: string; name: string; url: string; size: number };
type BoardT = { id: string; name: string; description: string; isDefault: boolean };
export type LogEntryT = {
  id: string;
  date: string;
  activity: string;
  owner: string;
  waitingOn: string;
  status: string;
  remarks: string;
  nodeId: string;
  nodeName: string;
  nodeParentId: string | null;
};
export type DependencyT = { id: string; predecessorId: string; successorId: string };

export type NodeT = {
  id: string;
  name: string;
  owner: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  progress: number;
  link: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
  parentId: string | null;
  comments: CommentT[];
  attachments: AttachmentT[];
};

type ColumnKey = "item" | "owner" | "status" | "priority" | "progress" | "link" | "attachments" | "dates";
const COLUMN_ORDER: ColumnKey[] = ["item", "owner", "status", "priority", "progress", "link", "attachments", "dates"];
const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  item: 320,
  owner: 130,
  status: 140,
  priority: 120,
  progress: 150,
  link: 60,
  attachments: 100,
  dates: 180,
};

// White text on bg-success/bg-warning fails WCAG AA contrast for small bold
// text (~3.2:1 against a 4.5:1 requirement) — checked against the actual
// hex values these tokens resolve to. Black text on those two clears 6:1+.
const STATUS_META: Record<NodeT["status"], { label: string; bg: string; text: string }> = {
  NOT_STARTED: { label: "Not started", bg: "bg-text-muted", text: "text-white" },
  IN_PROGRESS: { label: "In progress", bg: "bg-info", text: "text-white" },
  BLOCKED: { label: "Blocked", bg: "bg-danger", text: "text-white" },
  DONE: { label: "Done", bg: "bg-success", text: "text-black" },
};

const PRIORITY_META: Record<NodeT["priority"], { label: string; bg: string; text: string }> = {
  LOW: { label: "Low", bg: "bg-info", text: "text-white" },
  MEDIUM: { label: "Medium", bg: "bg-warning", text: "text-black" },
  HIGH: { label: "High", bg: "bg-danger", text: "text-white" },
};

const STATUS_ORDER: Record<NodeT["status"], number> = { NOT_STARTED: 0, IN_PROGRESS: 1, BLOCKED: 2, DONE: 3 };
const PRIORITY_ORDER: Record<NodeT["priority"], number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border ${className}`}>
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// Depth-first, indented flat list of every node in the tree — reused by the
// dependency picker (SidePanel) and the item picker (LogView).
function flattenTree(nodes: NodeT[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, NodeT[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const out: { id: string; label: string }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push({ id: n.id, label: `${"— ".repeat(depth)}${n.name}` });
      visit(n.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

// Owner is free text (not a User relation), so avatars are derived client-side:
// deterministic initials + a hash-to-color pick from a fixed palette.
function ownerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = ["#4F46E5", "#0D9488", "#DB2777", "#475569", "#0284C7", "#16A34A"];
function ownerColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

type SortKey = "name" | "owner" | "status" | "priority";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

function SortArrow({ active, dir }: { active: boolean; dir?: "asc" | "desc" }) {
  return (
    <span className={active ? "text-accent" : "text-text-muted/40"}>
      {!active ? "↕" : dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function ColumnResizeHandle({
  columnKey,
  colWidths,
  setColWidths,
}: {
  columnKey: ColumnKey;
  colWidths: Record<ColumnKey, number>;
  setColWidths: React.Dispatch<React.SetStateAction<Record<ColumnKey, number>>>;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  return (
    <div
      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize select-none hover:bg-accent/40"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: colWidths[columnKey] };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const next = Math.max(100, drag.current.startWidth + (e.clientX - drag.current.startX));
        setColWidths((w) => ({ ...w, [columnKey]: next }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    />
  );
}

function SortableHeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  columnKey,
  colWidths,
  setColWidths,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  columnKey: ColumnKey;
  colWidths: Record<ColumnKey, number>;
  setColWidths: React.Dispatch<React.SetStateAction<Record<ColumnKey, number>>>;
  align?: "left" | "center";
}) {
  const active = sort?.key === sortKey;
  return (
    <div className={`relative flex items-center px-3 py-2 ${align === "center" ? "justify-center" : ""}`}>
      <button className="flex items-center gap-1 hover:text-text" onClick={() => onSort(sortKey)}>
        {label}
        <SortArrow active={active} dir={active ? sort!.dir : undefined} />
      </button>
      <ColumnResizeHandle columnKey={columnKey} colWidths={colWidths} setColWidths={setColWidths} />
    </div>
  );
}

export default function ProjectBoard({
  nodes,
  boards,
  currentBoardId,
  logEntries,
  dependencies,
}: {
  nodes: NodeT[];
  boards: BoardT[];
  currentBoardId: string;
  logEntries: LogEntryT[];
  dependencies: DependencyT[];
}) {
  const [view, setView] = useState<"table" | "kanban" | "timeline" | "log">("table");
  const [filters, setFilters] = useState({ owner: "", status: "", priority: "" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS);
  const [timelinePxPerDay, setTimelinePxPerDay] = useState(6);

  const cycleSort = (key: SortKey) =>
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });

  const gridTemplate = useMemo(
    () => COLUMN_ORDER.map((k) => `${colWidths[k]}px`).join(" ") + " 40px",
    [colWidths]
  );
  const tableMinWidth = useMemo(
    () => COLUMN_ORDER.reduce((sum, k) => sum + colWidths[k], 0) + 40,
    [colWidths]
  );

  const byParent = useMemo(() => {
    const map = new Map<string | null, NodeT[]>();
    for (const n of nodes) {
      const list = map.get(n.parentId) ?? [];
      list.push(n);
      map.set(n.parentId, list);
    }
    return map;
  }, [nodes]);

  const orderedChildren = useMemo(() => {
    if (!sort) return byParent;
    const dirMul = sort.dir === "asc" ? 1 : -1;
    const rank = (n: NodeT): string | number => {
      switch (sort.key) {
        case "name":
          return n.name.toLowerCase();
        case "owner":
          return n.owner.toLowerCase();
        case "status":
          return STATUS_ORDER[n.status];
        case "priority":
          return PRIORITY_ORDER[n.priority];
      }
    };
    const cmp = (a: NodeT, b: NodeT) => {
      const av = rank(a);
      const bv = rank(b);
      return av < bv ? -1 * dirMul : av > bv ? 1 * dirMul : 0;
    };
    const map = new Map<string | null, NodeT[]>();
    byParent.forEach((kids, parentId) => map.set(parentId, [...kids].sort(cmp)));
    return map;
  }, [byParent, sort]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const descendantCount = useMemo(() => {
    const counts = new Map<string, number>();
    const count = (id: string): number => {
      const kids = byParent.get(id) ?? [];
      const total = kids.reduce((sum, k) => sum + 1 + count(k.id), 0);
      counts.set(id, total);
      return total;
    };
    for (const root of byParent.get(null) ?? []) count(root.id);
    return counts;
  }, [byParent]);

  const owners = useMemo(
    () => Array.from(new Set(nodes.map((n) => n.owner).filter(Boolean))).sort(),
    [nodes]
  );

  // ---------- Group drag-reorder ----------
  const [, startReorder] = useTransition();
  const [groupOrder, setGroupOrder] = useState<string[] | null>(null);
  useEffect(() => setGroupOrder(null), [nodes]);
  const rootRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const groupDragRef = useRef<{ id: string; startY: number } | null>(null);
  const [groupDrag, setGroupDrag] = useState<{ id: string; deltaY: number } | null>(null);

  const beginGroupDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    groupDragRef.current = { id, startY: e.clientY };
    setGroupDrag({ id, deltaY: 0 });
  };
  const onGroupDragMove = (e: React.PointerEvent) => {
    if (!groupDragRef.current) return;
    setGroupDrag({ id: groupDragRef.current.id, deltaY: e.clientY - groupDragRef.current.startY });
  };
  const endGroupDrag = (e: React.PointerEvent, currentRootIds: string[]) => {
    const d = groupDragRef.current;
    groupDragRef.current = null;
    setGroupDrag(null);
    if (!d) return;
    const others = currentRootIds.filter((id) => id !== d.id);
    const dropY = e.clientY;
    let insertIdx = others.length;
    for (let i = 0; i < others.length; i++) {
      const el = rootRefs.current.get(others[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (dropY < rect.top + rect.height / 2) {
        insertIdx = i;
        break;
      }
    }
    const next = [...others];
    next.splice(insertIdx, 0, d.id);
    if (next.join() === currentRootIds.join()) return;
    const prevOrder = currentRootIds;
    setGroupOrder(next);
    startReorder(() => {
      reorderProjectGroups(currentBoardId, next).catch(() => setGroupOrder(prevOrder));
    });
  };

  // Keyboard alternative to the pointer-drag reorder above (grip is a real
  // button, focusable via Tab; Arrow Up/Down move it one slot at a time).
  const moveGroup = (id: string, currentRootIds: string[], direction: -1 | 1) => {
    const from = currentRootIds.indexOf(id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= currentRootIds.length) return;
    const next = [...currentRootIds];
    [next[from], next[to]] = [next[to], next[from]];
    const prevOrder = currentRootIds;
    setGroupOrder(next);
    startReorder(() => {
      reorderProjectGroups(currentBoardId, next).catch(() => setGroupOrder(prevOrder));
    });
  };

  const filterActive = !!(filters.owner || filters.status || filters.priority);

  const matches = (n: NodeT) =>
    (!filters.owner || n.owner === filters.owner) &&
    (!filters.status || n.status === filters.status) &&
    (!filters.priority || n.priority === filters.priority);

  // A node is visible if it matches, or any descendant matches (ancestors stay for context).
  const visible = useMemo(() => {
    const set = new Set<string>();
    const walk = (id: string): boolean => {
      const n = byId.get(id)!;
      const kids = byParent.get(id) ?? [];
      let any = matches(n);
      for (const k of kids) if (walk(k.id)) any = true;
      if (any) set.add(id);
      return any;
    };
    for (const root of byParent.get(null) ?? []) walk(root.id);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, byParent, filters]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const naturalRoots = (orderedChildren.get(null) ?? []).filter((r) => visible.has(r.id));
  const roots =
    groupOrder && sort === null
      ? (groupOrder.map((id) => byId.get(id)).filter(Boolean) as NodeT[]).filter((r) => visible.has(r.id))
      : naturalRoots;
  const dragReorderEnabled = sort === null && !filterActive;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <div className="mr-auto flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold">Project</h1>
            <p className="figure text-xs text-text-muted">
              {byParent.get(null)?.length ?? 0} projects · {nodes.length} items
            </p>
          </div>
          <EntitySwitcher
            label="Board"
            entities={boards}
            currentId={currentBoardId}
            paramName="board"
            basePath="/projects"
            actions={{ create: createBoard, rename: renameBoard, remove: deleteBoard }}
          />
        </div>
        <FiltersPopover filters={filters} setFilters={setFilters} owners={owners} />
        {view === "timeline" && (
          <label className="flex items-center gap-2 text-xs text-text-muted">
            Zoom
            <input
              type="range"
              min={2}
              max={16}
              step={1}
              value={timelinePxPerDay}
              onChange={(e) => setTimelinePxPerDay(Number(e.target.value))}
              aria-label="Timeline zoom"
            />
          </label>
        )}
        <div className="flex rounded-lg border border-border p-0.5">
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === "table" ? "bg-accent/10 text-accent" : "text-text-muted"
            }`}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === "kanban" ? "bg-accent/10 text-accent" : "text-text-muted"
            }`}
            onClick={() => setView("kanban")}
          >
            Kanban
          </button>
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === "timeline" ? "bg-accent/10 text-accent" : "text-text-muted"
            }`}
            onClick={() => setView("timeline")}
          >
            Timeline
          </button>
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === "log" ? "bg-accent/10 text-accent" : "text-text-muted"
            }`}
            onClick={() => setView("log")}
          >
            Log
          </button>
        </div>
        <button className="btn-primary" onClick={() => setCreatingRoot(true)}>
          New project
        </button>
      </header>

      {view === "table" ? (
        <div className="flex-1 overflow-x-auto overflow-y-auto px-6 py-5">
          <div style={{ minWidth: tableMinWidth }}>
            {creatingRoot && (
              <InlineCreate
                placeholder="Project name"
                onDone={() => setCreatingRoot(false)}
                parentId={null}
                boardId={currentBoardId}
              />
            )}
            {roots.length === 0 && !creatingRoot ? (
              <div className="mt-16 text-center text-sm text-text-muted">
                {filterActive
                  ? "No items match the current filters."
                  : "No projects yet. Create your first project to start the breakdown."}
              </div>
            ) : (
              <div className="space-y-4">
                <div
                  className="sticky top-0 z-10 grid divide-x divide-border items-center rounded-lg border border-border bg-bg text-[11px] font-semibold uppercase tracking-wider text-text-muted"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <SortableHeaderCell label="Item" sortKey="name" sort={sort} onSort={cycleSort} columnKey="item" colWidths={colWidths} setColWidths={setColWidths} />
                  <SortableHeaderCell label="Owner" sortKey="owner" sort={sort} onSort={cycleSort} columnKey="owner" colWidths={colWidths} setColWidths={setColWidths} />
                  <SortableHeaderCell label="Status" sortKey="status" sort={sort} onSort={cycleSort} columnKey="status" colWidths={colWidths} setColWidths={setColWidths} align="center" />
                  <SortableHeaderCell label="Priority" sortKey="priority" sort={sort} onSort={cycleSort} columnKey="priority" colWidths={colWidths} setColWidths={setColWidths} align="center" />
                  <div className="relative flex items-center px-3 py-2">
                    Progress
                    <ColumnResizeHandle columnKey="progress" colWidths={colWidths} setColWidths={setColWidths} />
                  </div>
                  <div className="relative flex items-center justify-center px-3 py-2">
                    Link
                    <ColumnResizeHandle columnKey="link" colWidths={colWidths} setColWidths={setColWidths} />
                  </div>
                  <div className="relative flex items-center justify-center px-3 py-2">
                    Files
                    <ColumnResizeHandle columnKey="attachments" colWidths={colWidths} setColWidths={setColWidths} />
                  </div>
                  <div className="relative flex items-center justify-end px-3 py-2">
                    Dates
                    <ColumnResizeHandle columnKey="dates" colWidths={colWidths} setColWidths={setColWidths} />
                  </div>
                  <span />
                </div>
                {roots.map((root) => {
                  const dragging = groupDrag?.id === root.id;
                  return (
                    <div
                      key={root.id}
                      ref={(el) => {
                        if (el) rootRefs.current.set(root.id, el);
                        else rootRefs.current.delete(root.id);
                      }}
                      className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
                      style={
                        dragging
                          ? { transform: `translateY(${groupDrag!.deltaY}px)`, opacity: 0.85, position: "relative", zIndex: 20 }
                          : undefined
                      }
                    >
                      <GroupHeader
                        node={root}
                        count={descendantCount.get(root.id) ?? 0}
                        byParent={orderedChildren}
                        visible={visible}
                        collapsed={collapsed}
                        toggle={toggle}
                        onSelect={setSelectedId}
                        selectedId={selectedId}
                        gridTemplate={gridTemplate}
                        dragEnabled={dragReorderEnabled}
                        onGripPointerDown={(e) => beginGroupDrag(e, root.id)}
                        onGripPointerMove={onGroupDragMove}
                        onGripPointerUp={(e) =>
                          endGroupDrag(
                            e,
                            roots.map((r) => r.id)
                          )
                        }
                        onGripKeyDown={(e) => {
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            moveGroup(
                              root.id,
                              roots.map((r) => r.id),
                              -1
                            );
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            moveGroup(
                              root.id,
                              roots.map((r) => r.id),
                              1
                            );
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard
          nodes={nodes.filter((n) => visible.has(n.id))}
          onSelect={setSelectedId}
          filterActive={filterActive}
        />
      ) : view === "timeline" ? (
        <TimelineView
          nodes={nodes}
          byParent={orderedChildren}
          visible={visible}
          dependencies={dependencies}
          pxPerDay={timelinePxPerDay}
          onSelect={setSelectedId}
        />
      ) : (
        <LogView nodes={nodes} logEntries={logEntries} />
      )}

      {selected && (
        <SidePanel
          key={selected.id}
          node={selected}
          allNodes={nodes}
          dependencies={dependencies}
          onClose={() => setSelectedId(null)}
          onDeleted={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function FiltersPopover({
  filters,
  setFilters,
  owners,
}: {
  filters: { owner: string; status: string; priority: string };
  setFilters: (f: { owner: string; status: string; priority: string }) => void;
  owners: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activeCount = [filters.owner, filters.status, filters.priority].filter(Boolean).length;

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        Filters
        {activeCount > 0 && (
          <span className="figure flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] text-white">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-64 space-y-3 rounded-xl border border-border bg-surface p-4 shadow-lg">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Owner</label>
            <select
              className="field"
              value={filters.owner}
              onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
            >
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Status</label>
            <select
              className="field"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Priority</label>
            <select
              className="field"
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
            >
              <option value="">All priorities</option>
              {Object.entries(PRIORITY_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          {activeCount > 0 && (
            <button
              className="btn-ghost w-full justify-center text-xs"
              onClick={() => setFilters({ owner: "", status: "", priority: "" })}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusSelect({ node }: { node: NodeT }) {
  const [pending, start] = useTransition();
  // Optimistic local value: the select must reflect the pick instantly, since
  // the server round-trip + revalidation can take a few seconds — without
  // this the control visibly snaps back to the old value before catching up.
  const [value, setValue] = useState(node.status);
  useEffect(() => setValue(node.status), [node.status]);

  return (
    <select
      aria-label="Status"
      value={value}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value as NodeT["status"];
        const prev = value;
        setValue(next);
        start(async () => {
          try {
            await updateNode(node.id, { status: next });
          } catch {
            setValue(prev);
          }
        });
      }}
      className={`w-full cursor-pointer appearance-none rounded-full border-none px-2 py-1 text-center text-[11px] font-semibold ${STATUS_META[value].bg} ${STATUS_META[value].text} hover:[appearance:auto] focus:[appearance:auto] focus:outline-none focus:ring-1 focus:ring-accent`}
    >
      {Object.entries(STATUS_META).map(([k, v]) => (
        <option key={k} value={k}>
          {v.label}
        </option>
      ))}
    </select>
  );
}

function PrioritySelect({ node }: { node: NodeT }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(node.priority);
  useEffect(() => setValue(node.priority), [node.priority]);

  return (
    <select
      aria-label="Priority"
      value={value}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value as NodeT["priority"];
        const prev = value;
        setValue(next);
        start(async () => {
          try {
            await updateNode(node.id, { priority: next });
          } catch {
            setValue(prev);
          }
        });
      }}
      className={`w-full cursor-pointer appearance-none rounded-full border-none px-2 py-1 text-center text-[11px] font-semibold ${PRIORITY_META[value].bg} ${PRIORITY_META[value].text} hover:[appearance:auto] focus:[appearance:auto] focus:outline-none focus:ring-1 focus:ring-accent`}
    >
      {Object.entries(PRIORITY_META).map(([k, v]) => (
        <option key={k} value={k}>
          {v.label}
        </option>
      ))}
    </select>
  );
}

function GroupHeader({
  node,
  count,
  byParent,
  visible,
  collapsed,
  toggle,
  onSelect,
  selectedId,
  gridTemplate,
  dragEnabled,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
  onGripKeyDown,
}: {
  node: NodeT;
  count: number;
  byParent: Map<string | null, NodeT[]>;
  visible: Set<string>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  gridTemplate: string;
  dragEnabled?: boolean;
  onGripPointerDown?: (e: React.PointerEvent) => void;
  onGripPointerMove?: (e: React.PointerEvent) => void;
  onGripPointerUp?: (e: React.PointerEvent) => void;
  onGripKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const kids = (byParent.get(node.id) ?? []).filter((k) => visible.has(k.id));
  const isCollapsed = collapsed.has(node.id);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div
        className="grid min-h-[44px] items-center border-l-[3px] border-l-accent bg-accent/10"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 items-center gap-2 px-3">
          {dragEnabled && (
            <button
              type="button"
              aria-label="Drag to reorder, or use Arrow Up/Down"
              title="Drag to reorder (or focus + Arrow Up/Down)"
              onPointerDown={onGripPointerDown}
              onPointerMove={onGripPointerMove}
              onPointerUp={onGripPointerUp}
              onKeyDown={onGripKeyDown}
              className="focus-ring shrink-0 cursor-grab select-none touch-none rounded text-sm text-text-muted"
            >
              ⠿
            </button>
          )}
          <button
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            onClick={() => toggle(node.id)}
            className={`focus-ring flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent transition-transform ${
              isCollapsed ? "" : "rotate-90"
            }`}
          >
            ▸
          </button>
          <button
            onClick={() => onSelect(node.id)}
            className="focus-ring min-w-0 flex-1 truncate rounded text-left text-[15px] font-semibold"
          >
            {node.name}
          </button>
          <span className="figure shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-white">{count}</span>
        </div>
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
        <div className="flex justify-center">
          <button
            title="Add child item"
            onClick={() => {
              setAdding(true);
              if (isCollapsed) toggle(node.id);
            }}
            className="focus-ring h-6 w-6 rounded-md border border-accent/30 text-sm text-accent hover:bg-surface"
          >
            +
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div>
          {adding && (
            <div className="py-1 pl-3 pr-3">
              <InlineCreate placeholder="Breakdown item name" parentId={node.id} onDone={() => setAdding(false)} />
            </div>
          )}
          {kids.map((k) => (
            <Row
              key={k.id}
              node={k}
              depth={1}
              byParent={byParent}
              visible={visible}
              collapsed={collapsed}
              toggle={toggle}
              onSelect={onSelect}
              selectedId={selectedId}
              gridTemplate={gridTemplate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  node,
  depth,
  byParent,
  visible,
  collapsed,
  toggle,
  onSelect,
  selectedId,
  gridTemplate,
}: {
  node: NodeT;
  depth: number;
  byParent: Map<string | null, NodeT[]>;
  visible: Set<string>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  gridTemplate: string;
}) {
  const kids = (byParent.get(node.id) ?? []).filter((k) => visible.has(k.id));
  const isCollapsed = collapsed.has(node.id);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div
        className={`group grid divide-x divide-border min-h-[44px] border-b border-border/70 last:border-b-0 ${
          selectedId === node.id ? "bg-accent/10" : "hover:bg-bg"
        }`}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 items-center gap-2 px-3">
          <button
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            onClick={() => toggle(node.id)}
            style={{ marginLeft: depth * 20 }}
            className={`focus-ring flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-transform ${
              kids.length === 0 && !adding ? "invisible" : ""
            } ${isCollapsed ? "" : "rotate-90"}`}
          >
            ▸
          </button>
          <button
            onClick={() => onSelect(node.id)}
            className="focus-ring min-w-0 flex-1 truncate rounded text-left text-sm"
          >
            {node.name}
          </button>
          {node.comments.length > 0 && (
            <span className="figure shrink-0 text-[11px] text-text-muted">💬{node.comments.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2 px-3">
          {node.owner ? (
            <>
              <span
                className="figure flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: ownerColor(node.owner) }}
              >
                {ownerInitials(node.owner)}
              </span>
              <span className="truncate text-xs text-text-muted">{node.owner}</span>
            </>
          ) : (
            <span className="text-xs text-text-muted">—</span>
          )}
        </div>
        <div className="flex items-center px-2">
          <StatusSelect node={node} />
        </div>
        <div className="flex items-center px-2">
          <PrioritySelect node={node} />
        </div>
        <div className="flex items-center gap-2 px-3">
          <ProgressBar value={node.progress} className="w-16" />
          <span className="figure text-xs text-text-muted">{node.progress}%</span>
        </div>
        <div className="flex items-center justify-center px-2">
          {node.link && (
            <a
              href={node.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={node.link}
              className="focus-ring text-text-muted hover:text-accent"
            >
              🔗
            </a>
          )}
        </div>
        <div className="flex items-center justify-center px-2">
          {node.attachments.length > 0 && (
            <span className="figure text-[11px] text-text-muted" title={`${node.attachments.length} attachment(s)`}>
              📎{node.attachments.length}
            </span>
          )}
        </div>
        <div className="figure flex items-center justify-end px-3 text-xs text-text-muted">
          {fmtDate(node.startDate)} → {fmtDate(node.endDate)}
        </div>
        <div className="flex items-center justify-center">
          <button
            title="Add child item"
            onClick={() => {
              setAdding(true);
              if (isCollapsed) toggle(node.id);
            }}
            className="focus-ring h-6 w-6 rounded-md border border-border text-sm text-text-muted opacity-0 hover:bg-surface hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            +
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div>
          {adding && (
            <div className="py-1 pr-3" style={{ paddingLeft: `${(depth + 1) * 20 + 12}px` }}>
              <InlineCreate
                placeholder="Breakdown item name"
                parentId={node.id}
                onDone={() => setAdding(false)}
              />
            </div>
          )}
          {kids.map((k) => (
            <Row
              key={k.id}
              node={k}
              depth={depth + 1}
              byParent={byParent}
              visible={visible}
              collapsed={collapsed}
              toggle={toggle}
              onSelect={onSelect}
              selectedId={selectedId}
              gridTemplate={gridTemplate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InlineCreate({
  parentId,
  placeholder,
  onDone,
  boardId,
}: {
  parentId: string | null;
  placeholder: string;
  onDone: () => void;
  boardId?: string;
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!name.trim()) return onDone();
    start(async () => {
      await createNode(parentId, name, boardId);
      onDone();
    });
  };

  return (
    <div className="mb-2 flex items-center gap-2">
      <input
        autoFocus
        className="field max-w-sm"
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        disabled={pending}
      />
      <button className="btn-primary" onClick={submit} disabled={pending}>
        {pending ? "Adding..." : "Add"}
      </button>
      <button className="btn-ghost" onClick={onDone} disabled={pending}>
        Cancel
      </button>
    </div>
  );
}

function SidePanel({
  node,
  allNodes,
  dependencies,
  onClose,
  onDeleted,
}: {
  node: NodeT;
  allNodes: NodeT[];
  dependencies: DependencyT[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    name: node.name,
    owner: node.owner,
    status: node.status,
    priority: node.priority,
    progress: node.progress,
    link: node.link,
    startDate: node.startDate ?? "",
    endDate: node.endDate ?? "",
    description: node.description,
  });
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const save = () =>
    start(async () => {
      await updateNode(node.id, {
        name: form.name,
        owner: form.owner,
        status: form.status,
        priority: form.priority,
        progress: form.progress,
        link: form.link,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        description: form.description,
      });
    });

  const pickFile = () => fileInput.current?.click();

  const onFileChosen = (file: File | undefined) => {
    if (!file) return;
    setUploadError("");
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await uploadAttachment(node.id, fd);
      if (res?.error) setUploadError(res.error);
    });
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeAttachment = (id: string) => start(() => deleteAttachment(id));

  const remove = () => {
    if (!confirm("Delete this item and everything nested under it?")) return;
    start(async () => {
      await deleteNode(node.id);
      onDeleted();
    });
  };

  const postComment = () => {
    if (!comment.trim()) return;
    start(async () => {
      await addComment(node.id, comment);
      setComment("");
    });
  };

  const [depError, setDepError] = useState("");
  const byNodeId = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  const predecessors = dependencies.filter((d) => d.successorId === node.id);
  const dependents = dependencies.filter((d) => d.predecessorId === node.id);
  const pickerOptions = flattenTree(allNodes).filter(
    (o) => o.id !== node.id && !predecessors.some((p) => p.predecessorId === o.id)
  );

  const addPredecessor = (predecessorId: string) => {
    if (!predecessorId) return;
    setDepError("");
    start(async () => {
      try {
        await addDependency(predecessorId, node.id);
      } catch (err) {
        setDepError(err instanceof Error ? err.message : "Failed to link.");
      }
    });
  };
  const removePredecessor = (id: string) => {
    setDepError("");
    start(() => removeDependency(id));
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Item details</h2>
        <button aria-label="Close panel" className="btn-ghost h-8 w-8 justify-center p-0" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Name</label>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Owner</label>
          <input
            className="field"
            placeholder="Person responsible"
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Status</label>
            <select
              className="field"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as NodeT["status"] })}
            >
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Priority</label>
            <select
              className="field"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as NodeT["priority"] })}
            >
              {Object.entries(PRIORITY_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Start</label>
            <input
              type="date"
              className="field font-mono tabular-nums"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">End</label>
            <input
              type="date"
              className="field font-mono tabular-nums"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">Progress</label>
            <span className="figure text-xs font-medium">{form.progress}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={form.progress}
            onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
            className="w-full accent-[var(--accent-hover)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Link</label>
          <input
            className="field"
            placeholder="https://..."
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Description</label>
          <textarea
            className="field min-h-24"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </button>
          <button className="btn-ghost text-danger" onClick={remove} disabled={pending}>
            Delete
          </button>
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Depends on (<span className="figure">{predecessors.length}</span>)
          </h3>
          {depError && <p className="mb-2 text-sm text-danger">{depError}</p>}
          <div className="mb-2 space-y-1.5">
            {predecessors.length === 0 && (
              <p className="text-sm text-text-muted">Not blocked by anything.</p>
            )}
            {predecessors.map((d) => {
              const item = byNodeId.get(d.predecessorId);
              return (
                <div key={d.id} className="flex items-center gap-2 rounded-lg bg-bg px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{item?.name ?? "Unknown item"}</span>
                  <button
                    aria-label={`Remove dependency on ${item?.name ?? "item"}`}
                    className="shrink-0 text-xs text-text-muted hover:text-danger"
                    onClick={() => removePredecessor(d.id)}
                    disabled={pending}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <select
            className="field"
            value=""
            disabled={pending || pickerOptions.length === 0}
            onChange={(e) => addPredecessor(e.target.value)}
          >
            <option value="">+ Add dependency…</option>
            {pickerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>

          {dependents.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Blocks (<span className="figure">{dependents.length}</span>)
              </h3>
              <div className="space-y-1.5">
                {dependents.map((d) => (
                  <div key={d.id} className="rounded-lg bg-bg px-3 py-2 text-sm text-text-muted">
                    {byNodeId.get(d.successorId)?.name ?? "Unknown item"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Attachments (<span className="figure">{node.attachments.length}</span>)
            </h3>
            <button className="text-xs font-medium text-accent hover:underline" onClick={pickFile} disabled={pending}>
              + Add file
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => onFileChosen(e.target.files?.[0])}
            />
          </div>
          {uploadError && <p className="mb-2 text-sm text-danger">{uploadError}</p>}
          <div className="space-y-2">
            {node.attachments.length === 0 && (
              <p className="text-sm text-text-muted">No files attached yet.</p>
            )}
            {node.attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-bg px-3 py-2">
                <span className="shrink-0">📎</span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-accent hover:underline"
                >
                  {a.name}
                </a>
                <span className="figure shrink-0 text-xs text-text-muted">{fmtSize(a.size)}</span>
                <button
                  aria-label="Remove attachment"
                  className="shrink-0 text-xs text-text-muted hover:text-accent"
                  onClick={() => removeAttachment(a.id)}
                  disabled={pending}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Comments (<span className="figure">{node.comments.length}</span>)
          </h3>
          <div className="space-y-3">
            {node.comments.length === 0 && (
              <p className="text-sm text-text-muted">No comments yet. Add the first note below.</p>
            )}
            {node.comments.map((c) => (
              <div key={c.id} className="border-t border-border bg-bg px-3 py-2">
                <p className="text-sm">{c.body}</p>
                <p className="figure mt-1 text-[11px] text-text-muted">
                  {c.author} · {new Date(c.createdAt).toLocaleString("en-GB")}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              className="field"
              placeholder="Write a comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && postComment()}
            />
            <button className="btn-ghost shrink-0" onClick={postComment} disabled={pending}>
              Post
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function KanbanBoard({
  nodes,
  onSelect,
  filterActive,
}: {
  nodes: NodeT[];
  onSelect: (id: string) => void;
  filterActive: boolean;
}) {
  const [, start] = useTransition();
  const [dragOverStatus, setDragOverStatus] = useState<NodeT["status"] | null>(null);
  // Optimistic status overrides: a dropped card must move to its new column
  // instantly, since the server round-trip + revalidation can take a few
  // seconds — without this the card would appear to snap back to its
  // original column until the page catches up.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, NodeT["status"]>>({});
  useEffect(() => setStatusOverrides({}), [nodes]);
  const statuses = Object.keys(STATUS_META) as NodeT["status"][];

  const byStatus = useMemo(() => {
    const map = new Map<NodeT["status"], NodeT[]>();
    for (const s of statuses) map.set(s, []);
    for (const n of nodes) map.get(statusOverrides[n.id] ?? n.status)?.push(n);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, statusOverrides]);

  const onDrop = (status: NodeT["status"], id: string) => {
    setDragOverStatus(null);
    setStatusOverrides((o) => ({ ...o, [id]: status }));
    start(async () => {
      try {
        await updateNode(id, { status });
      } catch {
        setStatusOverrides((o) => {
          const { [id]: _, ...rest } = o;
          return rest;
        });
      }
    });
  };

  if (nodes.length === 0) {
    return (
      <div className="mt-16 text-center text-sm text-text-muted">
        {filterActive ? "No items match the current filters." : "No items yet."}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-x-auto px-6 py-5">
      <div className="flex min-w-max gap-4">
        {statuses.map((status) => (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(status);
            }}
            onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/node-id");
              if (id) onDrop(status, id);
            }}
            className={`w-64 shrink-0 rounded-xl border bg-bg/60 p-2 ${
              dragOverStatus === status ? "border-accent" : "border-border"
            }`}
          >
            <div className="mb-2 flex items-center justify-between px-1.5 py-1">
              <span className={`badge ${STATUS_META[status].bg} ${STATUS_META[status].text}`}>
                {STATUS_META[status].label}
              </span>
              <span className="figure text-xs text-text-muted">{byStatus.get(status)?.length ?? 0}</span>
            </div>
            <div className="space-y-2">
              {byStatus.get(status)?.map((n) => (
                <button
                  key={n.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/node-id", n.id)}
                  onClick={() => onSelect(n.id)}
                  className="focus-ring block w-full cursor-grab rounded-lg border border-border bg-surface p-3 text-left shadow-sm active:cursor-grabbing"
                >
                  <p className="truncate text-sm font-medium">{n.name}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`badge ${PRIORITY_META[n.priority].bg} ${PRIORITY_META[n.priority].text}`}>
                      {PRIORITY_META[n.priority].label}
                    </span>
                    {n.owner && <span className="truncate text-xs text-text-muted">{n.owner}</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <ProgressBar value={n.progress} />
                    <span className="figure text-[11px] text-text-muted">{n.progress}%</span>
                  </div>
                </button>
              ))}
              {(byStatus.get(status)?.length ?? 0) === 0 && (
                <p className="px-1.5 py-2 text-xs text-text-muted">Drop items here</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TIMELINE_ROW_HEIGHT = 32;

type GanttRow = {
  id: string;
  name: string;
  depth: number;
  isGroup: boolean;
  status: NodeT["status"] | null;
  progress: number;
  start: Date | null;
  end: Date | null;
  openEnded: boolean;
};

// A node with only a start date (no end) would otherwise render no bar at
// all. Treat it as "open-ended": effective end is today (so the bar grows
// day by day while it's not Done) or a minimal 1-day sliver if that's not
// applicable yet — it always renders *something* rather than vanishing.
function effectiveLeafRange(
  node: NodeT,
  today: Date
): { start: Date | null; end: Date | null; openEnded: boolean } {
  const start = node.startDate ? new Date(node.startDate) : null;
  if (!start) return { start: null, end: node.endDate ? new Date(node.endDate) : null, openEnded: false };
  if (node.endDate) return { start, end: new Date(node.endDate), openEnded: false };
  const minEnd = new Date(start);
  minEnd.setUTCDate(minEnd.getUTCDate() + 1);
  const openEnded = node.status !== "DONE";
  const end = openEnded && today > minEnd ? today : minEnd;
  return { start, end, openEnded };
}

function dateExtent(
  id: string,
  byParent: Map<string | null, NodeT[]>,
  byId: Map<string, NodeT>,
  today: Date
): { start: Date | null; end: Date | null; openEnded: boolean } {
  const node = byId.get(id)!;
  const kids = byParent.get(id) ?? [];
  const own = effectiveLeafRange(node, today);
  let start = own.start;
  let end = own.end;
  let openEnded = own.openEnded;
  for (const k of kids) {
    const r = dateExtent(k.id, byParent, byId, today);
    if (r.start && (!start || r.start < start)) start = r.start;
    if (r.end && (!end || r.end > end)) end = r.end;
    if (r.openEnded) openEnded = true;
  }
  return { start, end, openEnded };
}

function TimelineView({
  nodes,
  byParent,
  visible,
  dependencies,
  pxPerDay,
  onSelect,
}: {
  nodes: NodeT[];
  byParent: Map<string | null, NodeT[]>;
  visible: Set<string>;
  dependencies: DependencyT[];
  pxPerDay: number;
  onSelect: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const today = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, []);

  const rows = useMemo(() => {
    const out: GanttRow[] = [];
    // `visible` already marks an ancestor as visible whenever any descendant
    // matches the active filters (see the `visible` useMemo above in
    // ProjectBoard), so pruning here the moment a node isn't in `visible` is
    // safe — it means neither that node nor anything under it matches.
    const visit = (id: string, depth: number) => {
      if (!visible.has(id)) return;
      const node = byId.get(id);
      if (!node) return;
      const kids = byParent.get(id) ?? [];
      const visibleKids = kids.filter((k) => visible.has(k.id));
      const isGroup = visibleKids.length > 0;
      const { start, end, openEnded } = dateExtent(id, byParent, byId, today);
      out.push({ id, name: node.name, depth, isGroup, status: isGroup ? null : node.status, progress: node.progress, start, end, openEnded });
      for (const k of visibleKids) visit(k.id, depth + 1);
    };
    for (const root of byParent.get(null) ?? []) visit(root.id, 0);
    return out;
  }, [byId, byParent, visible, today]);

  const { minDate, totalDays } = useMemo(() => {
    const dated = rows.filter((r) => r.start && r.end);
    if (dated.length === 0) {
      const end = new Date(today);
      end.setUTCDate(end.getUTCDate() + 60);
      return { minDate: today, totalDays: 60 };
    }
    let min = dated[0].start!;
    let max = dated[0].end!;
    for (const r of dated) {
      if (r.start! < min) min = r.start!;
      if (r.end! > max) max = r.end!;
    }
    min = new Date(min);
    min.setUTCDate(min.getUTCDate() - 7);
    max = new Date(max);
    max.setUTCDate(max.getUTCDate() + 14);
    const days = Math.max(30, Math.round((max.getTime() - min.getTime()) / 86400000));
    return { minDate: min, totalDays: days };
  }, [rows, today]);

  const dayOffset = (d: Date) => Math.round((d.getTime() - minDate.getTime()) / 86400000);

  const monthHeaders = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    const cursor = new Date(minDate);
    cursor.setUTCDate(1);
    const totalEnd = new Date(minDate);
    totalEnd.setUTCDate(totalEnd.getUTCDate() + totalDays);
    while (cursor < totalEnd) {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const left = Math.max(0, dayOffset(cursor)) * pxPerDay;
      const rightDay = Math.min(dayOffset(next), totalDays);
      const width = Math.max(0, rightDay * pxPerDay - left);
      out.push({
        label: cursor.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
        left,
        width,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDate, totalDays, pxPerDay]);

  const todayLeft = dayOffset(new Date()) * pxPerDay;
  const chartWidth = totalDays * pxPerDay;

  const barGeom = useMemo(() => {
    const map = new Map<string, { left: number; width: number; top: number; height: number }>();
    rows.forEach((r, i) => {
      if (!r.start || !r.end) return;
      const left = Math.max(0, dayOffset(r.start)) * pxPerDay;
      const right = Math.min(totalDays, dayOffset(r.end)) * pxPerDay;
      const width = Math.max(6, right - left);
      const top = i * TIMELINE_ROW_HEIGHT + (r.isGroup ? 11 : 5);
      const height = r.isGroup ? 10 : TIMELINE_ROW_HEIGHT - 10;
      map.set(r.id, { left, width, top, height });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, totalDays, minDate, pxPerDay]);

  const dependencyPaths = useMemo(() => {
    const out: string[] = [];
    for (const dep of dependencies) {
      const from = barGeom.get(dep.predecessorId);
      const to = barGeom.get(dep.successorId);
      if (!from || !to) continue;
      const x1 = from.left + from.width;
      const y1 = from.top + from.height / 2;
      const x2 = to.left;
      const y2 = to.top + to.height / 2;
      const midX = x1 + 10;
      out.push(`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
    }
    return out;
  }, [dependencies, barGeom]);

  const containerRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const connectDragRef = useRef<{ fromId: string } | null>(null);
  const [connectPreview, setConnectPreview] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [depError, setDepError] = useState("");
  const [, startDep] = useTransition();

  const relPoint = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const beginConnect = (e: React.PointerEvent, fromId: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    connectDragRef.current = { fromId };
    setConnectPreview({ fromId, ...relPoint(e) });
  };
  const onConnectMove = (e: React.PointerEvent) => {
    if (!connectDragRef.current) return;
    setConnectPreview({ fromId: connectDragRef.current.fromId, ...relPoint(e) });
  };
  const endConnect = (e: React.PointerEvent) => {
    const d = connectDragRef.current;
    connectDragRef.current = null;
    setConnectPreview(null);
    if (!d) return;
    let targetId: string | null = null;
    barRefs.current.forEach((el, id) => {
      if (id === d.fromId || targetId) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetId = id;
      }
    });
    if (!targetId) return;
    setDepError("");
    startDep(async () => {
      try {
        await addDependency(d.fromId, targetId!);
      } catch (err) {
        setDepError(err instanceof Error ? err.message : "Failed to link.");
      }
    });
  };

  if (rows.length === 0) {
    return <div className="mt-16 text-center text-sm text-text-muted">No projects yet.</div>;
  }

  return (
    <div className="flex-1 overflow-auto">
      {depError && <p className="px-6 pt-3 text-sm text-danger">{depError}</p>}
      <div className="flex" style={{ width: 280 + chartWidth }}>
        <div className="w-[280px] shrink-0">
          <div className="h-9 border-b border-border" />
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 border-b border-border/70"
              style={{ height: TIMELINE_ROW_HEIGHT, paddingLeft: 12 + r.depth * 18 }}
            >
              {!r.isGroup && (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    r.status ? STATUS_META[r.status].bg : "bg-text-muted"
                  }`}
                />
              )}
              <button
                onClick={() => onSelect(r.id)}
                className={`min-w-0 flex-1 truncate text-left hover:text-accent ${
                  r.isGroup ? "text-sm font-semibold" : "text-[13px]"
                }`}
              >
                {r.name}
              </button>
            </div>
          ))}
        </div>

        <div className="relative flex-1" style={{ width: chartWidth }}>
          <div className="sticky top-0 z-10 flex h-9 border-b border-border bg-surface">
            {monthHeaders.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 flex h-full items-center border-r border-border px-2 font-mono text-xs text-text-muted"
                style={{ left: m.left, width: m.width }}
              >
                {m.label}
              </div>
            ))}
          </div>
          <div ref={containerRef} className="relative" style={{ height: rows.length * TIMELINE_ROW_HEIGHT }}>
            <div className="pointer-events-none absolute inset-y-0 border-l border-accent/50" style={{ left: todayLeft }} />

            <svg
              className="pointer-events-none absolute inset-0 overflow-visible text-text-muted"
              width={chartWidth}
              height={rows.length * TIMELINE_ROW_HEIGHT}
            >
              <defs>
                <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0L10,5L0,10z" fill="currentColor" />
                </marker>
              </defs>
              {dependencyPaths.map((p, i) => (
                <path key={i} d={p} stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#dep-arrow)" />
              ))}
              {connectPreview &&
                barGeom.get(connectPreview.fromId) &&
                (() => {
                  const from = barGeom.get(connectPreview.fromId)!;
                  const x1 = from.left + from.width;
                  const y1 = from.top + from.height / 2;
                  return (
                    <path
                      d={`M ${x1} ${y1} L ${connectPreview.x} ${connectPreview.y}`}
                      stroke="currentColor"
                      className="text-accent"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      fill="none"
                      markerEnd="url(#dep-arrow)"
                    />
                  );
                })()}
            </svg>

            {rows.map((r) => {
              const geom = barGeom.get(r.id);
              if (!geom) return null;
              return (
                <div
                  key={r.id}
                  ref={(el) => {
                    if (el) barRefs.current.set(r.id, el);
                    else barRefs.current.delete(r.id);
                  }}
                  className="group absolute"
                  style={{ left: geom.left, top: geom.top, width: geom.width, height: geom.height }}
                >
                  <button
                    onClick={() => onSelect(r.id)}
                    title={r.openEnded ? `${r.name} (no end date set — shown through today)` : r.name}
                    className={`absolute inset-0 overflow-hidden text-left text-[11px] font-medium text-white ${
                      r.isGroup ? "rounded-full bg-slate-700" : r.status ? STATUS_META[r.status].bg : "bg-text-muted"
                    } ${!r.isGroup && r.openEnded ? "rounded-l-full" : !r.isGroup ? "rounded-full" : ""}`}
                    style={
                      r.openEnded
                        ? {
                            maskImage: "linear-gradient(to right, black 70%, transparent 100%)",
                            WebkitMaskImage: "linear-gradient(to right, black 70%, transparent 100%)",
                          }
                        : undefined
                    }
                  >
                    {!r.isGroup && (
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-black/25"
                        style={{ width: `${Math.max(0, Math.min(100, r.progress))}%` }}
                      />
                    )}
                    <span className="relative flex h-full items-center overflow-hidden text-ellipsis whitespace-nowrap px-2.5">
                      {r.name}
                    </span>
                  </button>
                  {!r.isGroup && (
                    <div
                      role="button"
                      aria-label={`Drag to link ${r.name} to another item`}
                      title="Drag to link a dependency"
                      onPointerDown={(e) => beginConnect(e, r.id)}
                      onPointerMove={onConnectMove}
                      onPointerUp={(e) => endConnect(e)}
                      className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-crosshair touch-none rounded-full border-2 border-surface bg-accent opacity-0 group-hover:opacity-100"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const LOG_STATUS_DEFAULTS = ["Completed", "In Progress", "Pending", "Blocker", "N/A"];
const LOG_STATUS_BADGE: Record<string, string> = {
  Completed: "bg-success text-black",
  "In Progress": "bg-info text-white",
  Pending: "bg-warning text-black",
  Blocker: "bg-danger text-white",
  "N/A": "bg-text-muted text-white",
};
function logStatusBadgeClass(status: string) {
  return LOG_STATUS_BADGE[status] ?? "border border-border bg-transparent text-text";
}

function nodeAncestorPath(nodeId: string, nodes: NodeT[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return "Unknown item";
  if (!node.parentId) return node.name;
  let root = node;
  while (root.parentId) {
    const parent = byId.get(root.parentId);
    if (!parent) break;
    root = parent;
  }
  return `${root.name} › ${node.name}`;
}

const LOG_GRID = "112px 190px minmax(220px,1.4fr) 120px 140px 140px minmax(180px,1.4fr) 40px";

type LogFormState = {
  date: string;
  nodeId: string;
  activity: string;
  owner: string;
  waitingOn: string;
  status: string;
  remarks: string;
};

function LogView({ nodes, logEntries }: { nodes: NodeT[]; logEntries: LogEntryT[] }) {
  const [, start] = useTransition();
  const [filterNodeId, setFilterNodeId] = useState("");
  const [error, setError] = useState("");
  const todayStr = new Date().toISOString().slice(0, 10);
  const emptyForm: LogFormState = { date: todayStr, nodeId: "", activity: "", owner: "", waitingOn: "", status: "", remarks: "" };
  const [addForm, setAddForm] = useState<LogFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LogFormState>(emptyForm);

  const pickerOptions = useMemo(() => flattenTree(nodes), [nodes]);
  const statusOptions = useMemo(() => {
    const set = new Set(LOG_STATUS_DEFAULTS);
    for (const l of logEntries) if (l.status) set.add(l.status);
    return Array.from(set);
  }, [logEntries]);

  const filtered = filterNodeId ? logEntries.filter((l) => l.nodeId === filterNodeId) : logEntries;

  const submitAdd = () => {
    if (!addForm.nodeId || !addForm.activity.trim()) {
      setError("Item and Activity are required.");
      return;
    }
    setError("");
    start(async () => {
      try {
        await createLogEntry(addForm.nodeId, {
          date: addForm.date,
          activity: addForm.activity,
          owner: addForm.owner,
          waitingOn: addForm.waitingOn,
          status: addForm.status,
          remarks: addForm.remarks,
        });
        setAddForm({ ...emptyForm, date: addForm.date, nodeId: addForm.nodeId });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add entry.");
      }
    });
  };

  const beginEdit = (entry: LogEntryT) => {
    setError("");
    setEditingId(entry.id);
    setEditForm({
      date: entry.date,
      nodeId: entry.nodeId,
      activity: entry.activity,
      owner: entry.owner,
      waitingOn: entry.waitingOn,
      status: entry.status,
      remarks: entry.remarks,
    });
  };

  const submitEdit = () => {
    if (!editingId) return;
    if (!editForm.nodeId || !editForm.activity.trim()) {
      setError("Item and Activity are required.");
      return;
    }
    setError("");
    const id = editingId;
    start(async () => {
      try {
        await updateLogEntry(id, editForm);
        setEditingId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save entry.");
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this log entry?")) return;
    start(() => deleteLogEntry(id));
  };

  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Filter by item</label>
        <select className="field w-64" value={filterNodeId} onChange={(e) => setFilterNodeId(e.target.value)}>
          <option value="">All items</option>
          {pickerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <datalist id="log-status-options">
        {statusOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div style={{ minWidth: 1180 }}>
        <div
          className="sticky top-0 z-10 grid divide-x divide-border items-center rounded-t-lg border border-border bg-bg text-[11px] font-semibold uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: LOG_GRID }}
        >
          <div className="px-3 py-2">Date</div>
          <div className="px-3 py-2">Item</div>
          <div className="px-3 py-2">Activity / Milestone</div>
          <div className="px-3 py-2">Owner</div>
          <div className="px-3 py-2">Waiting on</div>
          <div className="px-3 py-2">Status</div>
          <div className="px-3 py-2">Remarks</div>
          <span />
        </div>

        <div
          className="grid items-center gap-2 border-x border-b border-border bg-accent/5 p-2"
          style={{ gridTemplateColumns: LOG_GRID }}
        >
          <input
            type="date"
            className="field text-xs"
            value={addForm.date}
            onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
          />
          <select
            className="field text-xs"
            value={addForm.nodeId}
            onChange={(e) => setAddForm({ ...addForm, nodeId: e.target.value })}
          >
            <option value="">Pick item…</option>
            {pickerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            className="field text-xs"
            placeholder="Activity / milestone"
            value={addForm.activity}
            onChange={(e) => setAddForm({ ...addForm, activity: e.target.value })}
          />
          <input
            className="field text-xs"
            placeholder="Owner"
            value={addForm.owner}
            onChange={(e) => setAddForm({ ...addForm, owner: e.target.value })}
          />
          <input
            className="field text-xs"
            placeholder="Waiting on"
            value={addForm.waitingOn}
            onChange={(e) => setAddForm({ ...addForm, waitingOn: e.target.value })}
          />
          <input
            list="log-status-options"
            className="field text-xs"
            placeholder="Status"
            value={addForm.status}
            onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}
          />
          <input
            className="field text-xs"
            placeholder="Remarks"
            value={addForm.remarks}
            onChange={(e) => setAddForm({ ...addForm, remarks: e.target.value })}
          />
          <div className="flex justify-center">
            <button className="btn-primary px-2 py-1.5 text-xs" onClick={submitAdd}>
              Save
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-b-lg border-x border-b border-border bg-surface py-10 text-center text-sm text-text-muted">
            No log entries yet.
          </div>
        ) : (
          filtered.map((entry, idx) =>
            editingId === entry.id ? (
              <div
                key={entry.id}
                className={`grid items-center gap-2 border-x border-b border-border bg-accent/5 p-2 ${
                  idx === filtered.length - 1 ? "rounded-b-lg" : ""
                }`}
                style={{ gridTemplateColumns: LOG_GRID }}
              >
                <input
                  type="date"
                  className="field text-xs"
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                />
                <select
                  className="field text-xs"
                  value={editForm.nodeId}
                  onChange={(e) => setEditForm({ ...editForm, nodeId: e.target.value })}
                >
                  {pickerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  className="field text-xs"
                  value={editForm.activity}
                  onChange={(e) => setEditForm({ ...editForm, activity: e.target.value })}
                />
                <input
                  className="field text-xs"
                  value={editForm.owner}
                  onChange={(e) => setEditForm({ ...editForm, owner: e.target.value })}
                />
                <input
                  className="field text-xs"
                  value={editForm.waitingOn}
                  onChange={(e) => setEditForm({ ...editForm, waitingOn: e.target.value })}
                />
                <input
                  list="log-status-options"
                  className="field text-xs"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                />
                <input
                  className="field text-xs"
                  value={editForm.remarks}
                  onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                />
                <div className="flex justify-center gap-1.5">
                  <button aria-label="Save entry" className="text-text-muted hover:text-accent" onClick={submitEdit}>
                    ✓
                  </button>
                  <button
                    aria-label="Cancel edit"
                    className="text-text-muted hover:text-danger"
                    onClick={() => setEditingId(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={entry.id}
                className={`group grid cursor-pointer items-center border-x border-b border-border bg-surface hover:bg-bg ${
                  idx === filtered.length - 1 ? "rounded-b-lg" : ""
                }`}
                style={{ gridTemplateColumns: LOG_GRID }}
                onClick={() => beginEdit(entry)}
              >
                <div className="figure px-3 py-2 text-xs text-text-muted">{fmtDate(entry.date)}</div>
                <div className="truncate px-3 py-2 text-sm">{nodeAncestorPath(entry.nodeId, nodes)}</div>
                <div className="truncate px-3 py-2 text-sm">{entry.activity}</div>
                <div className="truncate px-3 py-2 text-sm text-text-muted">{entry.owner || "—"}</div>
                <div className="truncate px-3 py-2 text-sm text-text-muted">{entry.waitingOn || "—"}</div>
                <div className="px-3 py-2">
                  {entry.status ? (
                    <span className={`badge ${logStatusBadgeClass(entry.status)}`}>{entry.status}</span>
                  ) : (
                    <span className="text-sm text-text-muted">—</span>
                  )}
                </div>
                <div className="truncate px-3 py-2 text-sm text-text-muted">{entry.remarks || "—"}</div>
                <div
                  className="flex justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    aria-label="Delete entry"
                    className="text-xs text-text-muted hover:text-danger"
                    onClick={() => remove(entry.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
