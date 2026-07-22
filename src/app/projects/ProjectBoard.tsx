"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addComment, createNode, deleteAttachment, deleteNode, updateNode, uploadAttachment } from "@/lib/actions";

type CommentT = { id: string; body: string; author: string; createdAt: string };
type AttachmentT = { id: string; name: string; url: string; size: number };

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

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line ${className}`}>
      <div
        className="h-full rounded-full bg-primary"
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

export default function ProjectBoard({ nodes }: { nodes: NodeT[] }) {
  const [view, setView] = useState<"table" | "kanban">("table");
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
    const rows: string[][] = [
      ["Item", "Depth", "Owner", "Status", "Priority", "Progress", "Link", "Start", "End"],
    ];
    const walk = (id: string, depth: number) => {
      if (!visible.has(id)) return;
      const n = byId.get(id)!;
      rows.push([
        `${"  ".repeat(depth)}${n.name}`,
        String(depth),
        n.owner,
        STATUS_META[n.status].label,
        PRIORITY_META[n.priority].label,
        `${n.progress}%`,
        n.link,
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
        <div className="flex rounded-lg border border-line p-0.5">
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === "table" ? "bg-primary-soft text-primary-deep" : "text-muted"
            }`}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === "kanban" ? "bg-primary-soft text-primary-deep" : "text-muted"
            }`}
            onClick={() => setView("kanban")}
          >
            Kanban
          </button>
        </div>
        <button className="btn-ghost" onClick={exportCsv}>
          Export CSV
        </button>
        <button className="btn-primary" onClick={() => setCreatingRoot(true)}>
          New project
        </button>
      </header>

      {view === "table" ? (
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
        <span className="hidden items-center gap-1.5 sm:flex">
          <ProgressBar value={node.progress} />
          <span className="w-8 text-right text-xs tabular-nums text-muted">{node.progress}%</span>
        </span>
        {node.link && (
          <a
            href={node.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={node.link}
            className="focus-ring shrink-0 text-muted hover:text-primary"
          >
            🔗
          </a>
        )}
        {node.attachments.length > 0 && (
          <span className="shrink-0 text-xs text-muted" title={`${node.attachments.length} attachment(s)`}>
            📎 {node.attachments.length}
          </span>
        )}
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
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">Progress</label>
            <span className="text-xs font-medium tabular-nums">{form.progress}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={form.progress}
            onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
            className="w-full accent-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Link</label>
          <input
            className="field"
            placeholder="https://..."
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
          />
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
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Attachments ({node.attachments.length})
            </h3>
            <button className="text-xs font-medium text-primary hover:underline" onClick={pickFile} disabled={pending}>
              + Add file
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => onFileChosen(e.target.files?.[0])}
            />
          </div>
          {uploadError && <p className="mb-2 text-sm text-red-600">{uploadError}</p>}
          <div className="space-y-2">
            {node.attachments.length === 0 && (
              <p className="text-sm text-muted">No files attached yet.</p>
            )}
            {node.attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
                <span className="shrink-0">📎</span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-primary hover:underline"
                >
                  {a.name}
                </a>
                <span className="shrink-0 text-xs text-muted">{fmtSize(a.size)}</span>
                <button
                  aria-label="Remove attachment"
                  className="shrink-0 text-xs text-muted hover:text-red-600"
                  onClick={() => removeAttachment(a.id)}
                  disabled={pending}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
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
  const statuses = Object.keys(STATUS_META) as NodeT["status"][];

  const byStatus = useMemo(() => {
    const map = new Map<NodeT["status"], NodeT[]>();
    for (const s of statuses) map.set(s, []);
    for (const n of nodes) map.get(n.status)?.push(n);
    return map;
  }, [nodes]);

  const onDrop = (status: NodeT["status"], id: string) => {
    setDragOverStatus(null);
    start(() => updateNode(id, { status }));
  };

  if (nodes.length === 0) {
    return (
      <div className="mt-16 text-center text-sm text-muted">
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
            className={`w-64 shrink-0 rounded-xl border bg-canvas/60 p-2 ${
              dragOverStatus === status ? "border-primary" : "border-line"
            }`}
          >
            <div className="mb-2 flex items-center justify-between px-1.5 py-1">
              <span className={`chip ${STATUS_META[status].cls}`}>{STATUS_META[status].label}</span>
              <span className="text-xs text-muted">{byStatus.get(status)?.length ?? 0}</span>
            </div>
            <div className="space-y-2">
              {byStatus.get(status)?.map((n) => (
                <button
                  key={n.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/node-id", n.id)}
                  onClick={() => onSelect(n.id)}
                  className="focus-ring block w-full cursor-grab rounded-lg border border-line bg-surface p-3 text-left shadow-card active:cursor-grabbing"
                >
                  <p className="truncate text-sm font-medium">{n.name}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`chip ${PRIORITY_META[n.priority].cls}`}>
                      {PRIORITY_META[n.priority].label}
                    </span>
                    {n.owner && <span className="truncate text-xs text-muted">{n.owner}</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <ProgressBar value={n.progress} />
                    <span className="text-[11px] tabular-nums text-muted">{n.progress}%</span>
                  </div>
                </button>
              ))}
              {(byStatus.get(status)?.length ?? 0) === 0 && (
                <p className="px-1.5 py-2 text-xs text-muted">Drop items here</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
