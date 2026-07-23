"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addComment,
  createBoard,
  createNode,
  deleteAttachment,
  deleteBoard,
  deleteNode,
  renameBoard,
  updateNode,
  uploadAttachment,
} from "@/lib/actions";
import EntitySwitcher from "@/components/EntitySwitcher";

type CommentT = { id: string; body: string; author: string; createdAt: string };
type AttachmentT = { id: string; name: string; url: string; size: number };
type BoardT = { id: string; name: string; isDefault: boolean };

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

const STATUS_META: Record<NodeT["status"], { label: string; bg: string; text: string }> = {
  NOT_STARTED: { label: "Not started", bg: "bg-text-muted/10", text: "text-text-muted" },
  IN_PROGRESS: { label: "In progress", bg: "bg-info/10", text: "text-info" },
  BLOCKED: { label: "Blocked", bg: "bg-danger/10", text: "text-danger" },
  DONE: { label: "Done", bg: "bg-success/10", text: "text-success" },
};

const PRIORITY_META: Record<NodeT["priority"], { label: string; bg: string; text: string }> = {
  LOW: { label: "Low", bg: "bg-info/10", text: "text-info" },
  MEDIUM: { label: "Medium", bg: "bg-warning/10", text: "text-warning" },
  HIGH: { label: "High", bg: "bg-danger/10", text: "text-danger" },
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
}: {
  nodes: NodeT[];
  boards: BoardT[];
  currentBoardId: string;
}) {
  const [view, setView] = useState<"table" | "kanban">("table");
  const [filters, setFilters] = useState({ owner: "", status: "", priority: "" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS);

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
  const roots = (orderedChildren.get(null) ?? []).filter((r) => visible.has(r.id));

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
                {roots.map((root) => (
                  <div key={root.id} className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
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
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <KanbanBoard
          nodes={nodes.filter((n) => visible.has(n.id))}
          onSelect={setSelectedId}
          filterActive={filterActive}
        />
      )}

      {selected && (
        <SidePanel
          key={selected.id}
          node={selected}
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
  onClose,
  onDeleted,
}: {
  node: NodeT;
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
