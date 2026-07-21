"use client";

import { useMemo, useState, useTransition } from "react";
import { addComment, createNode, deleteNode, updateNode } from "@/lib/actions";

type CommentT = { id: string; body: string; author: string; createdAt: string };

export type NodeT = {
  id: string;
  name: string;
  owner: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  startDate: string | null;
  endDate: string | null;
  description: string;
  parentId: string | null;
  comments: CommentT[];
};

const STATUS_META: Record<NodeT["status"], { label: string; cls: string }> = {
  NOT_STARTED: { label: "Not started", cls: "bg-slate-100 text-slate-600" },
  IN_PROGRESS: { label: "In progress", cls: "bg-blue-100 text-blue-700" },
  BLOCKED: { label: "Blocked", cls: "bg-red-100 text-red-700" },
  DONE: { label: "Done", cls: "bg-primary-soft text-primary-deep" },
};

const PRIORITY_META: Record<NodeT["priority"], { label: string; cls: string }> = {
  LOW: { label: "Low", cls: "bg-slate-100 text-slate-500" },
  MEDIUM: { label: "Medium", cls: "bg-saffron-soft text-amber-700" },
  HIGH: { label: "High", cls: "bg-red-100 text-red-700" },
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export default function ProjectBoard({ nodes }: { nodes: NodeT[] }) {
  const [filters, setFilters] = useState({ owner: "", status: "", priority: "" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingRoot, setCreatingRoot] = useState(false);

  const byParent = useMemo(() => {
    const map = new Map<string | null, NodeT[]>();
    for (const n of nodes) {
      const list = map.get(n.parentId) ?? [];
      list.push(n);
      map.set(n.parentId, list);
    }
    return map;
  }, [nodes]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

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

  const exportCsv = () => {
    const rows: string[][] = [["Item", "Depth", "Owner", "Status", "Priority", "Start", "End"]];
    const walk = (id: string, depth: number) => {
      if (!visible.has(id)) return;
      const n = byId.get(id)!;
      rows.push([
        `${"  ".repeat(depth)}${n.name}`,
        String(depth),
        n.owner,
        STATUS_META[n.status].label,
        PRIORITY_META[n.priority].label,
        n.startDate ?? "",
        n.endDate ?? "",
      ]);
      for (const k of byParent.get(id) ?? []) walk(k.id, depth + 1);
    };
    for (const root of byParent.get(null) ?? []) walk(root.id, 0);
    const csv = rows
      .map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-board-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-4">
        <div className="mr-auto">
          <h1 className="font-display text-xl font-600">Project board</h1>
          <p className="text-xs text-muted">
            {byParent.get(null)?.length ?? 0} projects · {nodes.length} items
          </p>
        </div>
        <select
          aria-label="Filter by owner"
          className="field w-40"
          value={filters.owner}
          onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}
        >
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          className="field w-40"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          className="field w-40"
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
        >
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className="btn-ghost" onClick={exportCsv}>
          Export CSV
        </button>
        <button className="btn-primary" onClick={() => setCreatingRoot(true)}>
          New project
        </button>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        {creatingRoot && (
          <InlineCreate
            placeholder="Project name"
            onDone={() => setCreatingRoot(false)}
            parentId={null}
          />
        )}
        {(byParent.get(null) ?? []).filter((r) => visible.has(r.id)).length === 0 &&
        !creatingRoot ? (
          <div className="mt-16 text-center text-sm text-muted">
            {filterActive
              ? "No items match the current filters."
              : "No projects yet. Create your first project to start the breakdown."}
          </div>
        ) : (
          <div className="space-y-4">
            {(byParent.get(null) ?? [])
              .filter((r) => visible.has(r.id))
              .map((root) => (
                <div key={root.id} className="rounded-xl border border-line bg-surface shadow-card">
                  <Row
                    node={root}
                    depth={0}
                    byParent={byParent}
                    visible={visible}
                    collapsed={collapsed}
                    toggle={toggle}
                    onSelect={setSelectedId}
                    selectedId={selectedId}
                  />
                </div>
              ))}
          </div>
        )}
      </div>

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

function Row({
  node,
  depth,
  byParent,
  visible,
  collapsed,
  toggle,
  onSelect,
  selectedId,
}: {
  node: NodeT;
  depth: number;
  byParent: Map<string | null, NodeT[]>;
  visible: Set<string>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const kids = (byParent.get(node.id) ?? []).filter((k) => visible.has(k.id));
  const isCollapsed = collapsed.has(node.id);
  const [adding, setAdding] = useState(false);
  const isProject = depth === 0;

  return (
    <div>
      <div
        className={`group flex items-center gap-2 border-b border-line/70 px-3 py-2.5 last:border-b-0 ${
          selectedId === node.id ? "bg-primary-soft/60" : "hover:bg-canvas/70"
        } ${isProject ? "rounded-t-xl" : ""}`}
        style={{ paddingLeft: `${12 + depth * 24}px` }}
      >
        <button
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          onClick={() => toggle(node.id)}
          className={`focus-ring flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-transform ${
            kids.length === 0 && !adding ? "invisible" : ""
          } ${isCollapsed ? "" : "rotate-90"}`}
        >
          ▸
        </button>
        <button
          onClick={() => onSelect(node.id)}
          className={`focus-ring min-w-0 flex-1 truncate rounded text-left ${
            isProject ? "font-display text-[15px] font-600" : "text-sm"
          }`}
        >
          {node.name}
          {node.comments.length > 0 && (
            <span className="ml-2 text-xs text-muted">💬 {node.comments.length}</span>
          )}
        </button>
        <span className="hidden w-28 truncate text-xs text-muted md:block">{node.owner || "—"}</span>
        <span className={`chip w-24 justify-center ${STATUS_META[node.status].cls}`}>
          {STATUS_META[node.status].label}
        </span>
        <span className={`chip w-20 justify-center ${PRIORITY_META[node.priority].cls}`}>
          {PRIORITY_META[node.priority].label}
        </span>
        <span className="hidden w-36 text-right text-xs tabular-nums text-muted lg:block">
          {fmtDate(node.startDate)} → {fmtDate(node.endDate)}
        </span>
        <button
          title="Add child item"
          onClick={() => {
            setAdding(true);
            if (isCollapsed) toggle(node.id);
          }}
          className="focus-ring invisible h-6 w-6 shrink-0 rounded-md border border-line text-sm text-muted hover:bg-surface hover:text-primary group-hover:visible"
        >
          +
        </button>
      </div>
      {!isCollapsed && (
        <div>
          {adding && (
            <div style={{ paddingLeft: `${12 + (depth + 1) * 24}px` }} className="py-1 pr-3">
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
}: {
  parentId: string | null;
  placeholder: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!name.trim()) return onDone();
    start(async () => {
      await createNode(parentId, name);
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
    startDate: node.startDate ?? "",
    endDate: node.endDate ?? "",
    description: node.description,
  });
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      await updateNode(node.id, {
        name: form.name,
        owner: form.owner,
        status: form.status,
        priority: form.priority,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        description: form.description,
      });
    });

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
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-panel">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-display text-base font-600">Item details</h2>
        <button aria-label="Close panel" className="btn-ghost h-8 w-8 justify-center p-0" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Name</label>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Owner</label>
          <input
            className="field"
            placeholder="Person responsible"
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Status</label>
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Priority</label>
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Start</label>
            <input
              type="date"
              className="field"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">End</label>
            <input
              type="date"
              className="field"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Description</label>
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
          <button className="btn-ghost text-red-600" onClick={remove} disabled={pending}>
            Delete
          </button>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Comments ({node.comments.length})
          </h3>
          <div className="space-y-3">
            {node.comments.length === 0 && (
              <p className="text-sm text-muted">No comments yet. Add the first note below.</p>
            )}
            {node.comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-canvas px-3 py-2">
                <p className="text-sm">{c.body}</p>
                <p className="mt-1 text-[11px] text-muted">
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
