"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  KPIS_EVENT,
  ALERTS_EVENT,
  getShowKpis,
  getAlertsOn,
} from "@/lib/uiPrefs";
import {
  addComment,
  addDependency,
  createBoard,
  createLogEntry,
  createNode,
  createWeeklyStatus,
  deleteAttachment,
  deleteBoard,
  deleteLogEntry,
  deleteNode,
  deleteWeeklyStatus,
  removeDependency,
  renameBoard,
  reorderProjectGroups,
  updateLogEntry,
  updateNode,
  updateWeeklyStatus,
  uploadAttachment,
} from "@/lib/actions";
import EntitySwitcher from "@/components/EntitySwitcher";
import { useClosePopover, useFloatingPosition, ConfirmDeleteButton } from "@/components/ui";
import { ownerInitials, ownerColor } from "@/lib/avatar";

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
export type WeeklyStatusT = {
  id: string;
  weekStart: string;
  weekEnd: string;
  label: string;
  summary: string;
  issuesFound: number;
  issuesResolved: number;
  blockerTeams: { team: string; days: number }[];
  blockerDetails: { detail: string; team: string }[];
};

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
  blockReason: string;
  request: string;
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

const PRIORITY_META: Record<NodeT["priority"], { label: string; bg: string; text: string; labelColor: string }> = {
  LOW: { label: "Low", bg: "bg-info", text: "text-white", labelColor: "text-info" },
  MEDIUM: { label: "Medium", bg: "bg-warning", text: "text-black", labelColor: "text-warning" },
  HIGH: { label: "High", bg: "bg-danger", text: "text-white", labelColor: "text-danger" },
};

const STATUS_ORDER: Record<NodeT["status"], number> = { NOT_STARTED: 0, IN_PROGRESS: 1, BLOCKED: 2, DONE: 3 };
const PRIORITY_ORDER: Record<NodeT["priority"], number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProgressBar({ value, className = "w-16" }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 shrink-0 overflow-hidden rounded-full bg-border ${className}`}>
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
  weeklyStatuses,
  canEdit = true,
}: {
  nodes: NodeT[];
  boards: BoardT[];
  currentBoardId: string;
  logEntries: LogEntryT[];
  dependencies: DependencyT[];
  weeklyStatuses: WeeklyStatusT[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedView = searchParams.get("saved");

  const [view, setView] = useState<"table" | "kanban" | "timeline" | "log" | "weekly">(() => {
    const v = searchParams.get("view");
    return v === "kanban" || v === "timeline" || v === "log" || v === "weekly" ? v : "table";
  });
  const [filters, setFilters] = useState({ owner: "", status: "", priority: "" });
  const [datesAtRiskOnly, setDatesAtRiskOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("item"));
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS);
  const [timelinePxPerDay, setTimelinePxPerDay] = useState(6);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [, startBulk] = useTransition();

  const [showKpis, setShowKpisState] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const paletteRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [alertsOn, setAlertsOnState] = useState(true);
  const [lastSeenNotifAt, setLastSeenNotifAt] = useState("");
  useClosePopover(paletteOpen, () => setPaletteOpen(false), paletteRef);
  useClosePopover(notifOpen, () => setNotifOpen(false), notifRef);

  useEffect(() => {
    setShowKpisState(getShowKpis());
    setAlertsOnState(getAlertsOn());
    setLastSeenNotifAt(localStorage.getItem("last-seen-notif-at") ?? "");
    const onKpis = (e: Event) => setShowKpisState((e as CustomEvent<boolean>).detail);
    const onAlerts = (e: Event) => setAlertsOnState((e as CustomEvent<boolean>).detail);
    window.addEventListener(KPIS_EVENT, onKpis);
    window.addEventListener(ALERTS_EVENT, onAlerts);
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(KPIS_EVENT, onKpis);
      window.removeEventListener(ALERTS_EVENT, onAlerts);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const toggleRowSelect = (id: string) =>
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkUpdate = (data: Parameters<typeof updateNode>[1]) => {
    const ids = Array.from(selectedRows);
    setSelectedRows(new Set());
    startBulk(async () => {
      await Promise.all(ids.map((id) => updateNode(id, data)));
      router.refresh();
    });
  };

  const cycleSort = (key: SortKey) =>
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });

  const gridTemplate = useMemo(
    () => "28px " + COLUMN_ORDER.map((k) => `${colWidths[k]}px`).join(" ") + " 40px",
    [colWidths]
  );
  const tableMinWidth = useMemo(
    () => COLUMN_ORDER.reduce((sum, k) => sum + colWidths[k], 0) + 68,
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
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

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
      reorderProjectGroups(next).catch(() => setGroupOrder(prevOrder));
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
      reorderProjectGroups(next).catch(() => setGroupOrder(prevOrder));
    });
  };

  const filterActive = !!(filters.owner || filters.status || filters.priority || savedView || datesAtRiskOnly);

  const matchesSaved = (n: NodeT) => {
    switch (savedView) {
      case "my-week":
        return n.status === "IN_PROGRESS";
      case "blocked":
        return n.status === "BLOCKED";
      case "no-dates":
        return !n.startDate && !n.endDate;
      case "high-priority":
        return n.priority === "HIGH";
      default:
        return true;
    }
  };

  const matches = (n: NodeT) =>
    (!filters.owner || n.owner === filters.owner) &&
    (!filters.status || n.status === filters.status) &&
    (!filters.priority || n.priority === filters.priority) &&
    (!datesAtRiskOnly || (!!n.startDate && new Date(n.startDate) < today && n.status !== "DONE")) &&
    matchesSaved(n);

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
  }, [byId, byParent, filters, savedView, datesAtRiskOnly]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectableIds = useMemo(
    () => nodes.filter((n) => n.parentId !== null && visible.has(n.id)).map((n) => n.id),
    [nodes, visible]
  );
  const allRowsSelected = selectedRows.size > 0 && selectableIds.every((id) => selectedRows.has(id));
  const toggleSelectAll = () => setSelectedRows(allRowsSelected ? new Set() : new Set(selectableIds));

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const naturalRoots = (orderedChildren.get(null) ?? []).filter((r) => visible.has(r.id));
  const roots =
    groupOrder && sort === null
      ? (groupOrder.map((id) => byId.get(id)).filter(Boolean) as NodeT[]).filter((r) => visible.has(r.id))
      : naturalRoots;
  const dragReorderEnabled = sort === null && !filterActive;

  const kpis = useMemo(() => {
    let onTrack = 0;
    let blocked = 0;
    let shipped = 0;
    let atRisk = 0;
    for (const n of nodes) {
      if (n.status === "IN_PROGRESS") onTrack++;
      if (n.status === "BLOCKED") blocked++;
      if (n.status === "DONE") shipped++;
      if (n.startDate && new Date(n.startDate) < today && n.status !== "DONE") atRisk++;
    }
    return { onTrack, blocked, shipped, atRisk };
  }, [nodes, today]);

  const clickKpi = (kind: "onTrack" | "blocked" | "shipped" | "atRisk") => {
    setView("table");
    if (kind === "atRisk") {
      setDatesAtRiskOnly(true);
      setFilters({ owner: "", status: "", priority: "" });
    } else {
      setDatesAtRiskOnly(false);
      setFilters({
        owner: "",
        status: kind === "onTrack" ? "IN_PROGRESS" : kind === "blocked" ? "BLOCKED" : "DONE",
        priority: "",
      });
    }
  };

  const nodesWithChildren = useMemo(
    () => nodes.filter((n) => (byParent.get(n.id)?.length ?? 0) > 0).map((n) => n.id),
    [nodes, byParent]
  );
  const anyCollapsed = collapsed.size > 0;
  const toggleExpandAll = () => setCollapsed(anyCollapsed ? new Set() : new Set(nodesWithChildren));

  type PaletteCommand = { id: string; label: string; hint?: string; run: () => void };
  const paletteCommands: PaletteCommand[] = [
    { id: "go-table", label: "Go to Table", hint: "1", run: () => setView("table") },
    { id: "go-kanban", label: "Go to Kanban", hint: "2", run: () => setView("kanban") },
    { id: "go-timeline", label: "Go to Timeline", hint: "3", run: () => setView("timeline") },
    { id: "go-log", label: "Go to Log", hint: "4", run: () => setView("log") },
    { id: "go-weekly", label: "Go to Weekly", hint: "5", run: () => setView("weekly") },
    {
      id: "dark-mode",
      label: "Toggle dark mode",
      hint: "D",
      run: () => {
        const el = document.documentElement;
        const next = !el.classList.contains("dark");
        el.classList.toggle("dark", next);
        localStorage.setItem("theme-preference", next ? "dark" : "light");
      },
    },
    {
      id: "show-blocked",
      label: "Show blocked items",
      run: () => {
        setView("table");
        setDatesAtRiskOnly(false);
        setFilters({ owner: "", status: "BLOCKED", priority: "" });
      },
    },
  ];
  const paletteQueryLower = paletteQuery.trim().toLowerCase();
  const paletteItemResults = paletteQueryLower
    ? nodes.filter((n) => n.name.toLowerCase().includes(paletteQueryLower)).slice(0, 6)
    : [];
  const paletteCommandResults = paletteCommands.filter((c) => c.label.toLowerCase().includes(paletteQueryLower));

  const runPaletteCommand = (cmd: PaletteCommand) => {
    cmd.run();
    setPaletteOpen(false);
    setPaletteQuery("");
  };
  const pickPaletteItem = (id: string) => {
    setSelectedId(id);
    setPaletteOpen(false);
    setPaletteQuery("");
  };

  const notifications = useMemo(() => {
    const fromLogs = logEntries.slice(0, 20).map((l) => ({
      id: `log-${l.id}`,
      text: `${l.nodeName} — ${l.activity}`,
      when: l.date,
      nodeId: l.nodeId,
    }));
    const fromComments = nodes.flatMap((n) =>
      n.comments.map((c) => ({
        id: `comment-${c.id}`,
        text: `${n.name} — ${c.body}`,
        when: c.createdAt,
        nodeId: n.id,
      }))
    );
    return [...fromLogs, ...fromComments]
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 8);
  }, [logEntries, nodes]);

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
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="btn-ghost text-xs text-text-muted"
          aria-label="Open command palette"
        >
          🔍 Search
          <span className="figure ml-1 rounded border border-border px-1 text-[10px] text-text-muted">⌘K</span>
        </button>
        <Link href={`/projects/readout?board=${currentBoardId}`} className="btn-ghost text-xs text-text-muted">
          Read-out
        </Link>
        {alertsOn && (
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => {
                setNotifOpen((o) => {
                  const next = !o;
                  if (next && notifications[0]?.when) {
                    localStorage.setItem("last-seen-notif-at", notifications[0].when);
                    setLastSeenNotifAt(notifications[0].when);
                  }
                  return next;
                });
              }}
              className="btn-ghost relative h-9 w-9 justify-center p-0 text-text-muted"
              aria-label="Notifications"
            >
              🔔
              {notifications[0]?.when && new Date(notifications[0].when).getTime() > new Date(lastSeenNotifAt || 0).getTime() && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
              )}
            </button>
            {notifOpen && (
              <div className="animate-pop-in absolute right-0 top-full z-30 mt-1 max-h-80 w-80 overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-lg">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  What changed
                </p>
                {notifications.length === 0 && (
                  <p className="px-2 py-2 text-sm text-text-muted">Nothing recent.</p>
                )}
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setSelectedId(n.nodeId);
                      setNotifOpen(false);
                    }}
                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-bg"
                    title={n.text}
                  >
                    {n.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {canEdit ? (
          <button className="btn-primary" onClick={() => setCreatingRoot(true)}>
            New project
          </button>
        ) : (
          <span className="rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text-muted">
            View only
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-2">
        <div className="mr-auto flex items-center gap-1">
          {(
            [
              ["table", "Table"],
              ["kanban", "Kanban"],
              ["timeline", "Timeline"],
              ["log", "Log"],
              ["weekly", "Weekly"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`px-2.5 py-1.5 text-xs font-medium ${
                view === key ? "font-semibold text-accent" : "text-text-muted hover:text-text"
              }`}
              style={view === key ? { boxShadow: "inset 0 -2px 0 rgb(var(--accent-rgb))" } : undefined}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost text-xs text-text-muted" onClick={toggleExpandAll}>
          {anyCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>

      {showKpis && (
        <div className="grid grid-cols-4 gap-3 border-b border-border bg-surface px-6 py-3">
          <button
            type="button"
            onClick={() => clickKpi("onTrack")}
            className="focus-ring rounded-lg border border-border bg-bg px-3 py-2 text-left hover:border-accent/40"
          >
            <p className="figure text-lg font-semibold text-info">{kpis.onTrack}</p>
            <p className="text-[11px] uppercase tracking-wider text-text-muted">On track</p>
          </button>
          <button
            type="button"
            onClick={() => clickKpi("blocked")}
            className="focus-ring rounded-lg border border-border bg-bg px-3 py-2 text-left hover:border-accent/40"
          >
            <p className="figure text-lg font-semibold text-danger">{kpis.blocked}</p>
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Blocked</p>
          </button>
          <button
            type="button"
            onClick={() => clickKpi("shipped")}
            className="focus-ring rounded-lg border border-border bg-bg px-3 py-2 text-left hover:border-accent/40"
          >
            <p className="figure text-lg font-semibold text-success">{kpis.shipped}</p>
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Shipped</p>
          </button>
          <button
            type="button"
            onClick={() => clickKpi("atRisk")}
            className="focus-ring rounded-lg border border-border bg-bg px-3 py-2 text-left hover:border-accent/40"
          >
            <p className="figure text-lg font-semibold text-warning">{kpis.atRisk}</p>
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Dates at risk</p>
          </button>
        </div>
      )}

      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24 animate-overlay-in">
          <div
            ref={paletteRef}
            className="animate-palette-in w-full max-w-lg rounded-xl border border-border bg-surface shadow-lg"
          >
            <input
              autoFocus
              className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
              placeholder="Search items or run a command…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (paletteItemResults[0]) pickPaletteItem(paletteItemResults[0].id);
                  else if (paletteCommandResults[0]) runPaletteCommand(paletteCommandResults[0]);
                }
              }}
            />
            <div className="max-h-96 overflow-y-auto p-1.5">
              {paletteItemResults.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Items
                  </p>
                  {paletteItemResults.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => pickPaletteItem(n.id)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                    >
                      {n.name}
                    </button>
                  ))}
                </>
              )}
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Commands
              </p>
              {paletteCommandResults.length === 0 && (
                <p className="px-2 py-2 text-sm text-text-muted">No matching commands.</p>
              )}
              {paletteCommandResults.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => runPaletteCommand(cmd)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                >
                  <span>{cmd.label}</span>
                  {cmd.hint && (
                    <span className="figure rounded border border-border px-1 text-[10px] text-text-muted">
                      {cmd.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === "table" ? (
        <div className="animate-view-in relative flex-1 overflow-x-auto overflow-y-auto px-6 py-5">
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
                  <div className="flex items-center justify-center px-1">
                    {selectableIds.length > 0 && (
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={allRowsSelected}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 accent-[var(--accent-hover)]"
                      />
                    )}
                  </div>
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
                        byId={byId}
                        today={today}
                        visible={visible}
                        collapsed={collapsed}
                        toggle={toggle}
                        onSelect={setSelectedId}
                        selectedId={selectedId}
                        gridTemplate={gridTemplate}
                        selectedRows={selectedRows}
                        onToggleSelect={toggleRowSelect}
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
          {selectedRows.size > 0 && (
            <div className="animate-pop-in fixed inset-x-0 bottom-6 z-30 flex justify-center">
              <div className="flex items-center gap-1 rounded-xl border border-border bg-surface px-2 py-1.5 shadow-lg">
                <span className="figure px-2 text-xs text-text-muted">{selectedRows.size} selected</span>
                <button className="btn-ghost text-xs" onClick={() => bulkUpdate({ status: "DONE" })}>
                  Mark done
                </button>
                <button className="btn-ghost text-xs" onClick={() => bulkUpdate({ priority: "HIGH" })}>
                  Set high
                </button>
                <button className="btn-ghost text-xs text-danger" onClick={() => bulkUpdate({ status: "BLOCKED" })}>
                  Block
                </button>
                <button className="btn-ghost text-xs" onClick={() => setSelectedRows(new Set())}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard
          nodes={nodes.filter((n) => visible.has(n.id))}
          byParent={orderedChildren}
          byId={byId}
          today={today}
          collapsed={collapsed}
          toggle={toggle}
          onSelect={setSelectedId}
          filterActive={filterActive}
        />
      ) : view === "timeline" ? (
        <TimelineBoard
          nodes={nodes.filter((n) => visible.has(n.id))}
          byParent={orderedChildren}
          byId={byId}
          today={today}
          dependencies={dependencies}
          pxPerDay={timelinePxPerDay}
          onSelect={setSelectedId}
          collapsed={collapsed}
          toggle={toggle}
          filterActive={filterActive}
        />
      ) : view === "log" ? (
        <LogView nodes={nodes} logEntries={logEntries} />
      ) : (
        <WeeklyStatusView boardId={currentBoardId} weeklyStatuses={weeklyStatuses} />
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, style } = useFloatingPosition(open, triggerRef);
  useClosePopover(open, () => setOpen(false), menuRef);

  const activeCount = [filters.owner, filters.status, filters.priority].filter(Boolean).length;

  return (
    <>
      <button ref={triggerRef} className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        Filters
        {activeCount > 0 && (
          <span className="on-accent figure flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px]">
            {activeCount}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="z-30 w-64 space-y-3 rounded-xl border border-border bg-surface p-4 shadow-lg"
          >
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
          </div>,
          document.body
        )}
    </>
  );
}

// Dot + plain-text status control — replaces the former native `<select>`
// pill. Same optimistic-update-with-rollback behavior, just a custom
// absolute-positioned menu of colored-dot options instead of a native
// dropdown, matching the redesign's "no colored pills" language.
function StatusChip({ node }: { node: NodeT }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(node.status);
  useEffect(() => setValue(node.status), [node.status]);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, style } = useFloatingPosition(open, triggerRef);
  useClosePopover(open, () => setOpen(false), menuRef);

  const pick = (next: NodeT["status"]) => {
    setOpen(false);
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        await updateNode(node.id, { status: next });
        router.refresh();
      } catch {
        setValue(prev);
      }
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Status"
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="focus-ring flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-text-muted hover:bg-surface3"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[value].bg}`} />
        <span className="truncate">{STATUS_META[value].label}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="animate-pop-in z-20 w-36 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {(Object.keys(STATUS_META) as NodeT["status"][]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface2"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[k].bg}`} />
                {STATUS_META[k].label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// Small mono-uppercase colored label — priority's equivalent of StatusChip
// (no dot, matching the redesign's "priority is a small mono label" language).
function PriorityChip({ node }: { node: NodeT }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(node.priority);
  useEffect(() => setValue(node.priority), [node.priority]);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, style } = useFloatingPosition(open, triggerRef);
  useClosePopover(open, () => setOpen(false), menuRef);

  const pick = (next: NodeT["priority"]) => {
    setOpen(false);
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        await updateNode(node.id, { priority: next });
        router.refresh();
      } catch {
        setValue(prev);
      }
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Priority"
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`focus-ring rounded-md px-1.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider hover:bg-surface3 ${PRIORITY_META[value].labelColor}`}
      >
        {PRIORITY_META[value].label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="animate-pop-in z-20 w-28 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {(Object.keys(PRIORITY_META) as NodeT["priority"][]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                className={`block w-full rounded-md px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wider hover:bg-surface2 ${PRIORITY_META[k].labelColor}`}
              >
                {PRIORITY_META[k].label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function GroupHeader({
  node,
  count,
  byParent,
  byId,
  today,
  visible,
  collapsed,
  toggle,
  onSelect,
  selectedId,
  gridTemplate,
  selectedRows,
  onToggleSelect,
  dragEnabled,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
  onGripKeyDown,
}: {
  node: NodeT;
  count: number;
  byParent: Map<string | null, NodeT[]>;
  byId: Map<string, NodeT>;
  today: Date;
  visible: Set<string>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  gridTemplate: string;
  selectedRows: Set<string>;
  onToggleSelect: (id: string) => void;
  dragEnabled?: boolean;
  onGripPointerDown?: (e: React.PointerEvent) => void;
  onGripPointerMove?: (e: React.PointerEvent) => void;
  onGripPointerUp?: (e: React.PointerEvent) => void;
  onGripKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const kids = (byParent.get(node.id) ?? []).filter((k) => visible.has(k.id));
  const isCollapsed = collapsed.has(node.id);
  const [adding, setAdding] = useState(false);
  // "Overall project date" — the earliest start / latest end across this
  // project and all its descendants, not just the root's own (often unset)
  // date fields, so the summary stays meaningful even when the project
  // itself has no dates but its breakdown items do.
  const extent = dateExtent(node.id, byParent, byId, today);
  const extentStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  return (
    <div>
      <div
        className="grid items-center border-l-[3px] border-l-accent bg-accent/10"
        style={{ gridTemplateColumns: gridTemplate, minHeight: "calc(20px + var(--rowpad) * 2)" }}
      >
        <span />
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
          <div className="min-w-0 flex-1">
            <button
              onClick={() => onSelect(node.id)}
              className="focus-ring block w-full truncate rounded text-left text-[15px] font-semibold"
            >
              {node.name}
            </button>
            {node.description && (
              <p className="truncate text-xs text-text-muted" title={node.description}>
                {node.description}
              </p>
            )}
          </div>
          <span className="on-accent figure shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px]">{count}</span>
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
          <StatusChip node={node} />
        </div>
        <div className="flex items-center px-2">
          <PriorityChip node={node} />
        </div>
        <div className="flex items-center gap-2 px-3" title="Rolled up from this project's items">
          <ProgressBar value={progressRollup(node, byParent)} className="w-16" />
          <span className="figure text-xs text-text-muted">{progressRollup(node, byParent)}%</span>
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
        <div className="figure flex items-center justify-end px-3 text-xs text-text-muted" title="Earliest start → latest end across this project and its breakdown items">
          {fmtDate(extentStr(extent.start))} → {fmtDate(extentStr(extent.end))}
        </div>
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
              selectedRows={selectedRows}
              onToggleSelect={onToggleSelect}
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
  selectedRows,
  onToggleSelect,
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
  selectedRows: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const kids = (byParent.get(node.id) ?? []).filter((k) => visible.has(k.id));
  const isCollapsed = collapsed.has(node.id);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div
        className={`group grid divide-x divide-border border-b border-border/70 last:border-b-0 ${
          selectedId === node.id ? "bg-accent/10" : "hover:bg-bg"
        }`}
        style={{ gridTemplateColumns: gridTemplate, minHeight: "calc(20px + var(--rowpad) * 2)" }}
      >
        <div className="flex items-center justify-center px-1">
          <input
            type="checkbox"
            aria-label={`Select ${node.name}`}
            checked={selectedRows.has(node.id)}
            onChange={() => onToggleSelect(node.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 accent-[var(--accent-hover)]"
          />
        </div>
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
          <StatusChip node={node} />
        </div>
        <div className="flex items-center px-2">
          <PriorityChip node={node} />
        </div>
        <div
          className="flex items-center gap-2 px-3"
          title={(byParent.get(node.id)?.length ?? 0) > 0 ? "Rolled up from this item's children" : undefined}
        >
          <ProgressBar value={progressRollup(node, byParent)} className="w-16" />
          <span className="figure text-xs text-text-muted">{progressRollup(node, byParent)}%</span>
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
              selectedRows={selectedRows}
              onToggleSelect={onToggleSelect}
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
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!name.trim()) return onDone();
    start(async () => {
      await createNode(parentId, name, boardId);
      router.refresh();
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
  const router = useRouter();
  const [form, setForm] = useState({
    name: node.name,
    owner: node.owner,
    progress: node.progress,
    link: node.link,
    startDate: node.startDate ?? "",
    endDate: node.endDate ?? "",
    description: node.description,
    blockReason: node.blockReason,
    request: node.request,
  });
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // A node with children shows/edits a rolled-up progress, not its own raw
  // field (see progressRollup) — building byParent from allNodes here rather
  // than threading the board's own map down through every intermediate
  // component just for this one read-only case.
  const byParent = useMemo(() => {
    const m = new Map<string | null, NodeT[]>();
    for (const n of allNodes) {
      const list = m.get(n.parentId) ?? [];
      list.push(n);
      m.set(n.parentId, list);
    }
    return m;
  }, [allNodes]);
  const hasChildren = (byParent.get(node.id)?.length ?? 0) > 0;
  const rollupProgress = hasChildren ? progressRollup(node, byParent) : form.progress;

  const save = () =>
    start(async () => {
      await updateNode(node.id, {
        name: form.name,
        owner: form.owner,
        ...(hasChildren ? {} : { progress: form.progress }),
        link: form.link,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        description: form.description,
        blockReason: form.blockReason,
        request: form.request,
      });
      router.refresh();
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
      router.refresh();
    });
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeAttachment = (id: string) =>
    start(async () => {
      await deleteAttachment(id);
      router.refresh();
    });

  const remove = () => {
    start(async () => {
      await deleteNode(node.id);
      router.refresh();
      onDeleted();
    });
  };

  const postComment = () => {
    if (!comment.trim()) return;
    start(async () => {
      await addComment(node.id, comment);
      setComment("");
      router.refresh();
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
        router.refresh();
      } catch (err) {
        setDepError(err instanceof Error ? err.message : "Failed to link.");
      }
    });
  };
  const removePredecessor = (id: string) => {
    setDepError("");
    start(async () => {
      await removeDependency(id);
      router.refresh();
    });
  };

  return (
    <>
      <div className="animate-overlay-in fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <aside className="animate-drawer-in fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg">
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
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
            Request reference
          </label>
          <input
            className="field figure"
            placeholder="e.g. REQ-1042"
            value={form.request}
            onChange={(e) => setForm({ ...form, request: e.target.value })}
          />
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
            <StatusChip node={node} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Priority</label>
            <PriorityChip node={node} />
          </div>
        </div>
        {node.status === "BLOCKED" && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-danger">
              Blocked reason
            </label>
            <textarea
              className="field min-h-16 border-danger/30 bg-surface"
              placeholder="What's blocking this item?"
              value={form.blockReason}
              onChange={(e) => setForm({ ...form, blockReason: e.target.value })}
            />
          </div>
        )}
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
            <span className="figure text-xs font-medium">{rollupProgress}%</span>
          </div>
          {hasChildren ? (
            <>
              <ProgressBar value={rollupProgress} className="w-full" />
              <p className="mt-1 text-xs text-text-muted">
                Rolled up from this project&rsquo;s items — not directly editable.
              </p>
            </>
          ) : (
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.progress}
              onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
              className="w-full accent-[var(--accent-hover)]"
            />
          )}
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
          <ConfirmDeleteButton onConfirm={remove} disabled={pending} />
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
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
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
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
          <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
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
    </>
  );
}

// Kanban has no natural nesting (unlike Table's tree rows), so "collapse
// hides children, project summary stays visible" is mirrored by grouping
// cards into one collapsible section per top-level project — each with its
// own always-visible summary header and its own scoped status-column board
// underneath, rather than one board sharing status columns across every
// project.
function KanbanBoard({
  nodes,
  byParent,
  byId,
  today,
  collapsed,
  toggle,
  onSelect,
  filterActive,
}: {
  nodes: NodeT[];
  byParent: Map<string | null, NodeT[]>;
  byId: Map<string, NodeT>;
  today: Date;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  filterActive: boolean;
}) {
  const rootOf = (id: string): string => {
    let cur = byId.get(id);
    while (cur?.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? id;
  };

  const byRoot = useMemo(() => {
    const map = new Map<string, NodeT[]>();
    for (const n of nodes) {
      const r = rootOf(n.id);
      if (r === n.id) continue; // the root itself gets the section header, not a card
      const list = map.get(r) ?? [];
      list.push(n);
      map.set(r, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, byId]);

  const roots = (byParent.get(null) ?? []).filter((r) => byRoot.has(r.id) || nodes.some((n) => n.id === r.id));

  if (nodes.length === 0) {
    return (
      <div className="mt-16 text-center text-sm text-text-muted">
        {filterActive ? "No items match the current filters." : "No items yet."}
      </div>
    );
  }

  return (
    <div className="animate-view-in flex-1 space-y-4 overflow-y-auto px-6 py-5">
      {roots.map((root) => (
        <KanbanProjectSection
          key={root.id}
          root={root}
          items={byRoot.get(root.id) ?? []}
          byParent={byParent}
          byId={byId}
          today={today}
          isCollapsed={collapsed.has(root.id)}
          toggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// Shared summary header for one project's collapsible section — reused by
// both Kanban and Timeline so a project reads identically (name, priority,
// progress, date extent, collapse caret) no matter which view it's in.
function ProjectSectionHeader({
  root,
  count,
  extent,
  progress,
  isCollapsed,
  toggle,
  onSelect,
}: {
  root: NodeT;
  count: number;
  extent: { start: Date | null; end: Date | null };
  progress: number;
  isCollapsed: boolean;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const extentStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-accent/10 px-4 py-3">
      <button
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        onClick={() => toggle(root.id)}
        className={`focus-ring flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent transition-transform ${
          isCollapsed ? "" : "rotate-90"
        }`}
      >
        ▸
      </button>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onSelect(root.id)}
          className="focus-ring block truncate rounded text-left text-[15px] font-semibold"
        >
          {root.name}
        </button>
        {root.description && (
          <p className="truncate text-xs text-text-muted" title={root.description}>
            {root.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="w-32">
          <StatusChip node={root} />
        </div>
        <div className="w-28">
          <PriorityChip node={root} />
        </div>
        <div className="flex items-center gap-1.5" title="Rolled up from this project's items">
          <ProgressBar value={progress} className="w-16" />
          <span className="figure text-xs text-text-muted">{progress}%</span>
        </div>
        <span
          className="figure text-xs text-text-muted"
          title="Earliest start → latest end across this project and its breakdown items"
        >
          {fmtDate(extentStr(extent.start))} → {fmtDate(extentStr(extent.end))}
        </span>
        <span className="on-accent figure shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px]">{count}</span>
      </div>
    </div>
  );
}

function KanbanProjectSection({
  root,
  items,
  byParent,
  byId,
  today,
  isCollapsed,
  toggle,
  onSelect,
}: {
  root: NodeT;
  items: NodeT[];
  byParent: Map<string | null, NodeT[]>;
  byId: Map<string, NodeT>;
  today: Date;
  isCollapsed: boolean;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [dragOverStatus, setDragOverStatus] = useState<NodeT["status"] | null>(null);
  // Optimistic status overrides: a dropped card must move to its new column
  // instantly, since the server round-trip + revalidation can take a few
  // seconds — without this the card would appear to snap back to its
  // original column until the page catches up.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, NodeT["status"]>>({});
  useEffect(() => setStatusOverrides({}), [items]);
  const statuses = Object.keys(STATUS_META) as NodeT["status"][];

  const byStatus = useMemo(() => {
    const map = new Map<NodeT["status"], NodeT[]>();
    for (const s of statuses) map.set(s, []);
    for (const n of items) map.get(statusOverrides[n.id] ?? n.status)?.push(n);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, statusOverrides]);

  const onDrop = (status: NodeT["status"], id: string) => {
    setDragOverStatus(null);
    setStatusOverrides((o) => ({ ...o, [id]: status }));
    start(async () => {
      try {
        await updateNode(id, { status });
        router.refresh();
      } catch {
        setStatusOverrides((o) => {
          const { [id]: _, ...rest } = o;
          return rest;
        });
      }
    });
  };

  const extent = dateExtent(root.id, byParent, byId, today);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <ProjectSectionHeader
        root={root}
        count={items.length}
        extent={extent}
        progress={progressRollup(root, byParent)}
        isCollapsed={isCollapsed}
        toggle={toggle}
        onSelect={onSelect}
      />
      {!isCollapsed && (
        <div className="overflow-x-auto px-4 py-4">
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
                        <ProgressBar value={progressRollup(n, byParent)} />
                        <span className="figure text-[11px] text-text-muted">{progressRollup(n, byParent)}%</span>
                      </div>
                      {n.status === "BLOCKED" && n.blockReason && (
                        <p className="mt-2 rounded-md bg-danger/10 p-1.5 text-xs text-danger">{n.blockReason}</p>
                      )}
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
      )}
    </div>
  );
}

const TIMELINE_ROW_HEIGHT = 34;
const TIMELINE_BAR_HEIGHT = 21;

// Soft/tinted fills for Gantt bars specifically — the reference's Timeline
// uses pastel status fills with matching-tone text and border, distinct from
// the solid saturated STATUS_META used for the Table/Kanban status pills.
const TIMELINE_BAR_META: Record<NodeT["status"], { bg: string; border: string; text: string }> = {
  NOT_STARTED: { bg: "bg-text-muted/10", border: "border-text-muted/30", text: "text-text-muted" },
  IN_PROGRESS: { bg: "bg-info/10", border: "border-info/30", text: "text-info" },
  BLOCKED: { bg: "bg-danger/10", border: "border-danger/30", text: "text-danger" },
  DONE: { bg: "bg-success/10", border: "border-success/30", text: "text-success" },
};

function fmtGanttDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

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

// A node with children shows the average of its own children's (recursively
// rolled-up) progress rather than its own stored field — that field is only
// ever meaningful, and only ever edited, for leaves. Takes the node itself
// (not just an id) since byParent's arrays already hold full NodeT objects,
// so no separate byId map is needed to walk back down.
function progressRollup(node: NodeT, byParent: Map<string | null, NodeT[]>): number {
  const kids = byParent.get(node.id) ?? [];
  if (kids.length === 0) return node.progress;
  const sum = kids.reduce((acc, k) => acc + progressRollup(k, byParent), 0);
  return Math.round(sum / kids.length);
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

// Timeline has no natural nesting either, so it's grouped into one
// collapsible section per top-level project — same shared `ProjectSectionHeader`
// as Kanban, with each project's own scoped Gantt chart underneath instead
// of one chart sharing a time axis across every project.
function TimelineBoard({
  nodes,
  byParent,
  byId,
  today,
  dependencies,
  pxPerDay,
  onSelect,
  collapsed,
  toggle,
  filterActive,
}: {
  nodes: NodeT[];
  byParent: Map<string | null, NodeT[]>;
  byId: Map<string, NodeT>;
  today: Date;
  dependencies: DependencyT[];
  pxPerDay: number;
  onSelect: (id: string) => void;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  filterActive: boolean;
}) {
  const rootOf = (id: string): string => {
    let cur = byId.get(id);
    while (cur?.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? id;
  };

  const byRoot = useMemo(() => {
    const map = new Map<string, NodeT[]>();
    for (const n of nodes) {
      const r = rootOf(n.id);
      if (r === n.id) continue;
      const list = map.get(r) ?? [];
      list.push(n);
      map.set(r, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, byId]);

  const roots = (byParent.get(null) ?? []).filter((r) => byRoot.has(r.id) || nodes.some((n) => n.id === r.id));

  if (nodes.length === 0) {
    return (
      <div className="mt-16 text-center text-sm text-text-muted">
        {filterActive ? "No items match the current filters." : "No projects yet."}
      </div>
    );
  }

  return (
    <div className="animate-view-in flex-1 space-y-[14px] overflow-y-auto px-6 pb-10 pt-[18px]">
      {roots.map((root) => (
        <TimelineProjectSection
          key={root.id}
          root={root}
          items={byRoot.get(root.id) ?? []}
          byParent={byParent}
          byId={byId}
          today={today}
          dependencies={dependencies}
          pxPerDay={pxPerDay}
          onSelect={onSelect}
          isCollapsed={collapsed.has(root.id)}
          toggle={toggle}
        />
      ))}
    </div>
  );
}

function TimelineProjectSection({
  root,
  items,
  byParent,
  byId,
  today,
  dependencies,
  pxPerDay,
  onSelect,
  isCollapsed,
  toggle,
}: {
  root: NodeT;
  items: NodeT[];
  byParent: Map<string | null, NodeT[]>;
  byId: Map<string, NodeT>;
  today: Date;
  dependencies: DependencyT[];
  pxPerDay: number;
  onSelect: (id: string) => void;
  isCollapsed: boolean;
  toggle: (id: string) => void;
}) {
  const extent = dateExtent(root.id, byParent, byId, today);

  const rows = useMemo(() => {
    const out: GanttRow[] = [];
    const itemIds = new Set(items.map((n) => n.id));
    const visit = (id: string, depth: number) => {
      const node = byId.get(id);
      if (!node) return;
      const kids = (byParent.get(id) ?? []).filter((k) => itemIds.has(k.id));
      const isGroup = kids.length > 0;
      const { start, end, openEnded } = dateExtent(id, byParent, byId, today);
      out.push({
        id,
        name: node.name,
        depth,
        isGroup,
        status: isGroup ? null : node.status,
        progress: isGroup ? progressRollup(node, byParent) : node.progress,
        start,
        end,
        openEnded,
      });
      for (const k of kids) visit(k.id, depth + 1);
    };
    const directChildren = (byParent.get(root.id) ?? []).filter((k) => itemIds.has(k.id));
    for (const c of directChildren) visit(c.id, 0);
    return out;
  }, [items, byId, byParent, today, root.id]);

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
      const width = Math.max(34, right - left);
      const top = i * TIMELINE_ROW_HEIGHT + Math.round((TIMELINE_ROW_HEIGHT - TIMELINE_BAR_HEIGHT) / 2);
      const height = TIMELINE_BAR_HEIGHT;
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
  const router = useRouter();

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
        router.refresh();
      } catch (err) {
        setDepError(err instanceof Error ? err.message : "Failed to link.");
      }
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <ProjectSectionHeader
        root={root}
        count={items.length}
        extent={extent}
        progress={progressRollup(root, byParent)}
        isCollapsed={isCollapsed}
        toggle={toggle}
        onSelect={onSelect}
      />
      {!isCollapsed && rows.length === 0 && (
        <p className="px-4 py-4 text-sm text-text-muted">No dated items in this project yet.</p>
      )}
      {!isCollapsed && rows.length > 0 && (
        <div className="overflow-auto">
          {depError && <p className="px-4 pt-3 text-sm text-danger">{depError}</p>}
          <div className="flex" style={{ width: 210 + chartWidth }}>
            <div className="w-[210px] shrink-0">
              <div className="flex h-8 items-center border-b border-border px-3.5 font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">
                Item
              </div>
              {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 hover:bg-bg"
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
          <div className="sticky top-0 z-10 flex h-8 border-b border-border bg-surface">
            {monthHeaders.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 flex h-full items-center justify-center border-l border-border font-mono text-[9.5px] tracking-[0.08em] text-text-muted"
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
                    className={`absolute inset-0 overflow-hidden rounded-[7px] border text-left text-[11px] font-medium ${
                      r.isGroup
                        ? "border-border bg-surface2 text-text"
                        : r.status
                          ? `${TIMELINE_BAR_META[r.status].bg} ${TIMELINE_BAR_META[r.status].border} ${TIMELINE_BAR_META[r.status].text}`
                          : "border-text-muted/30 bg-text-muted/10 text-text-muted"
                    }`}
                    style={
                      r.openEnded
                        ? {
                            maskImage: "linear-gradient(to right, black 70%, transparent 100%)",
                            WebkitMaskImage: "linear-gradient(to right, black 70%, transparent 100%)",
                          }
                        : undefined
                    }
                  >
                    <span className="relative flex h-full items-center overflow-hidden text-ellipsis whitespace-nowrap px-2.5">
                      {r.start && (r.openEnded ? `${fmtGanttDate(r.start)} → open` : r.end ? `${fmtGanttDate(r.start)} → ${fmtGanttDate(r.end)}` : fmtGanttDate(r.start))}
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
      )}
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

function mondayOfWeek(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((day === 0 ? -6 : 1) - day));
  return d;
}
function fmtWeekRange(monday: Date) {
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const start = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const end = sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${start} – ${end}`;
}

type LogRow =
  | { kind: "separator"; key: string; weekLabel: string; monthLabel: string | null }
  | { kind: "entry"; entry: LogEntryT };

function groupLogRows(entries: LogEntryT[]): LogRow[] {
  const out: LogRow[] = [];
  let lastWeekKey = "";
  let lastMonthKey = "";
  for (const entry of entries) {
    const monday = mondayOfWeek(entry.date);
    const weekKey = monday.toISOString().slice(0, 10);
    if (weekKey !== lastWeekKey) {
      const monthKey = `${monday.getUTCFullYear()}-${monday.getUTCMonth()}`;
      const isNewMonth = monthKey !== lastMonthKey;
      out.push({
        kind: "separator",
        key: weekKey,
        weekLabel: fmtWeekRange(monday),
        monthLabel: isNewMonth
          ? monday.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
          : null,
      });
      lastWeekKey = weekKey;
      lastMonthKey = monthKey;
    }
    out.push({ kind: "entry", entry });
  }
  return out;
}

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
  const router = useRouter();
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
  const rows = useMemo(() => groupLogRows(filtered), [filtered]);

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
        router.refresh();
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
        router.refresh();
        setEditingId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save entry.");
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this log entry?")) return;
    start(async () => {
      await deleteLogEntry(id);
      router.refresh();
    });
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
          className="grid items-center gap-2 border-x border-b border-border bg-accent/5 px-3 py-2"
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
          rows.map((row, idx) =>
            row.kind === "separator" ? (
              <div
                key={`sep-${row.key}`}
                className={`flex items-center gap-2 border-x border-b border-border px-3 py-1.5 ${
                  row.monthLabel ? "bg-accent/10" : "bg-bg"
                }`}
              >
                {row.monthLabel && (
                  <span className="text-xs font-bold uppercase tracking-wider text-accent">{row.monthLabel}</span>
                )}
                <span className="figure text-[11px] font-medium text-text-muted">Week of {row.weekLabel}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : editingId === row.entry.id ? (
              <div
                key={row.entry.id}
                className={`grid items-center gap-2 border-x border-b border-border bg-accent/5 px-3 py-2 ${
                  idx === rows.length - 1 ? "rounded-b-lg" : ""
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
                key={row.entry.id}
                className={`group grid cursor-pointer items-center border-x border-b border-border bg-surface hover:bg-bg ${
                  idx === rows.length - 1 ? "rounded-b-lg" : ""
                }`}
                style={{ gridTemplateColumns: LOG_GRID }}
                onClick={() => beginEdit(row.entry)}
              >
                <div className="figure px-3 py-2 text-xs text-text-muted">{fmtDate(row.entry.date)}</div>
                <div className="truncate px-3 py-2 text-sm">{nodeAncestorPath(row.entry.nodeId, nodes)}</div>
                <div className="truncate px-3 py-2 text-sm">{row.entry.activity}</div>
                <div className="truncate px-3 py-2 text-sm text-text-muted">{row.entry.owner || "—"}</div>
                <div className="truncate px-3 py-2 text-sm text-text-muted">{row.entry.waitingOn || "—"}</div>
                <div className="px-3 py-2">
                  {row.entry.status ? (
                    <span className={`badge ${logStatusBadgeClass(row.entry.status)}`}>{row.entry.status}</span>
                  ) : (
                    <span className="text-sm text-text-muted">—</span>
                  )}
                </div>
                <div className="truncate px-3 py-2 text-sm text-text-muted">{row.entry.remarks || "—"}</div>
                <div
                  className="flex justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    aria-label="Delete entry"
                    className="text-xs text-text-muted hover:text-danger"
                    onClick={() => remove(row.entry.id)}
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

// ---------- Weekly status ----------
type WeeklyFormState = {
  weekStart: string;
  weekEnd: string;
  label: string;
  summary: string;
  issuesFound: number;
  issuesResolved: number;
  blockerTeams: { team: string; days: number }[];
  blockerDetails: { detail: string; team: string }[];
};

const EMPTY_WEEKLY_FORM: WeeklyFormState = {
  weekStart: "",
  weekEnd: "",
  label: "",
  summary: "",
  issuesFound: 0,
  issuesResolved: 0,
  blockerTeams: [],
  blockerDetails: [],
};

function fmtWeeklyRange(start: string, end: string) {
  const s = new Date(start + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const e = new Date(end + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${s} – ${e}`;
}

function WeeklyStatusView({ boardId, weeklyStatuses }: { boardId: string; weeklyStatuses: WeeklyStatusT[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WeeklyFormState>(EMPTY_WEEKLY_FORM);

  const beginCreate = () => {
    setError("");
    const latest = weeklyStatuses[0];
    let weekStart: string;
    if (latest) {
      const d = new Date(latest.weekEnd + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      weekStart = d.toISOString().slice(0, 10);
    } else {
      weekStart = new Date().toISOString().slice(0, 10);
    }
    const endD = new Date(weekStart + "T00:00:00Z");
    endD.setUTCDate(endD.getUTCDate() + 6);
    setForm({ ...EMPTY_WEEKLY_FORM, weekStart, weekEnd: endD.toISOString().slice(0, 10) });
    setEditingId(null);
    setCreating(true);
  };

  const beginEdit = (w: WeeklyStatusT) => {
    setError("");
    setForm({
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      label: w.label,
      summary: w.summary,
      issuesFound: w.issuesFound,
      issuesResolved: w.issuesResolved,
      blockerTeams: w.blockerTeams.map((t) => ({ ...t })),
      blockerDetails: w.blockerDetails.map((d) => ({ ...d })),
    });
    setCreating(false);
    setEditingId(w.id);
  };

  const cancel = () => {
    setCreating(false);
    setEditingId(null);
    setError("");
  };

  const addTeam = () => setForm((f) => ({ ...f, blockerTeams: [...f.blockerTeams, { team: "", days: 0 }] }));
  const updateTeam = (idx: number, patch: Partial<{ team: string; days: number }>) =>
    setForm((f) => ({ ...f, blockerTeams: f.blockerTeams.map((t, i) => (i === idx ? { ...t, ...patch } : t)) }));
  const removeTeam = (idx: number) =>
    setForm((f) => ({ ...f, blockerTeams: f.blockerTeams.filter((_, i) => i !== idx) }));

  const addDetail = () => setForm((f) => ({ ...f, blockerDetails: [...f.blockerDetails, { detail: "", team: "" }] }));
  const updateDetail = (idx: number, patch: Partial<{ detail: string; team: string }>) =>
    setForm((f) => ({ ...f, blockerDetails: f.blockerDetails.map((d, i) => (i === idx ? { ...d, ...patch } : d)) }));
  const removeDetail = (idx: number) =>
    setForm((f) => ({ ...f, blockerDetails: f.blockerDetails.filter((_, i) => i !== idx) }));

  const submit = () => {
    if (!form.weekStart || !form.weekEnd) {
      setError("Week start and end are required.");
      return;
    }
    if (form.weekEnd < form.weekStart) {
      setError("Week end must be on or after week start.");
      return;
    }
    setError("");
    start(async () => {
      try {
        if (creating) {
          await createWeeklyStatus(boardId, form);
          setCreating(false);
        } else if (editingId) {
          await updateWeeklyStatus(editingId, form);
          setEditingId(null);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save weekly status.");
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this week's status?")) return;
    start(async () => {
      await deleteWeeklyStatus(id);
      router.refresh();
    });
  };

  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      <div className="mb-4 flex items-center justify-between" style={{ maxWidth: 720 }}>
        <p className="text-xs text-text-muted">
          {weeklyStatuses.length} week{weeklyStatuses.length === 1 ? "" : "s"} tracked
        </p>
        <button className="btn-primary" onClick={beginCreate}>
          + Add week
        </button>
      </div>

      {error && (
        <p className="mb-3 text-sm text-danger" style={{ maxWidth: 720 }}>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4" style={{ maxWidth: 720 }}>
        {creating && (
          <WeeklyStatusCard
            form={form}
            setForm={setForm}
            addTeam={addTeam}
            updateTeam={updateTeam}
            removeTeam={removeTeam}
            addDetail={addDetail}
            updateDetail={updateDetail}
            removeDetail={removeDetail}
            onSave={submit}
            onCancel={cancel}
          />
        )}

        {weeklyStatuses.length === 0 && !creating && (
          <p className="mt-16 text-center text-sm text-text-muted">
            No weekly status entries yet. Click &ldquo;Add week&rdquo; to start tracking.
          </p>
        )}

        {weeklyStatuses.map((w) =>
          editingId === w.id ? (
            <WeeklyStatusCard
              key={w.id}
              form={form}
              setForm={setForm}
              addTeam={addTeam}
              updateTeam={updateTeam}
              removeTeam={removeTeam}
              addDetail={addDetail}
              updateDetail={updateDetail}
              removeDetail={removeDetail}
              onSave={submit}
              onCancel={cancel}
            />
          ) : (
            <WeeklyStatusReadCard key={w.id} data={w} onEdit={() => beginEdit(w)} onDelete={() => remove(w.id)} />
          )
        )}
      </div>
    </div>
  );
}

function WeeklyStatusReadCard({
  data,
  onEdit,
  onDelete,
}: {
  data: WeeklyStatusT;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between bg-accent px-4 py-2">
        <span className="on-accent text-xs font-bold uppercase tracking-wider">Weekly Status</span>
        <button
          aria-label="Delete week"
          className="on-accent text-xs opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ✕
        </button>
      </div>
      <div className="cursor-pointer" onClick={onEdit}>
        <div className="flex flex-wrap items-baseline gap-2 border-b border-border bg-accent/10 px-4 py-2">
          <span className="figure text-sm font-medium">Week of: {fmtWeeklyRange(data.weekStart, data.weekEnd)}</span>
          {data.label && <span className="text-xs text-text-muted">({data.label})</span>}
        </div>

        <div className="border-b border-border px-4 py-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Summary</p>
          <p className="whitespace-pre-wrap text-sm">{data.summary || "—"}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-border px-4 py-3">
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-danger">Issues found</p>
            <p className="figure text-2xl font-bold text-danger">{data.issuesFound}</p>
          </div>
          <div className="rounded-lg border border-success/30 bg-success/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-success">Issues resolved</p>
            <p className="figure text-2xl font-bold text-success">{data.issuesResolved}</p>
          </div>
        </div>

        <div className="border-b border-border px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Blockers by team (days)
          </p>
          {data.blockerTeams.length === 0 ? (
            <p className="text-sm text-text-muted">—</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.blockerTeams.map((t, i) => (
                <span key={i} className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm">
                  {t.team} <span className="figure text-text-muted">· {t.days}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Blocker details</p>
          {data.blockerDetails.length === 0 ? (
            <p className="text-sm text-text-muted">—</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[32px_1fr_140px] divide-x divide-border bg-bg text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                <div className="px-2 py-1.5">#</div>
                <div className="px-2 py-1.5">Detail</div>
                <div className="px-2 py-1.5">Team</div>
              </div>
              {data.blockerDetails.map((d, i) => (
                <div key={i} className="grid grid-cols-[32px_1fr_140px] divide-x divide-border border-t border-border">
                  <div className="figure px-2 py-1.5 text-xs text-text-muted">{i + 1}</div>
                  <div className="px-2 py-1.5 text-sm">{d.detail}</div>
                  <div className="px-2 py-1.5 text-sm text-text-muted">{d.team || "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WeeklyStatusCard({
  form,
  setForm,
  addTeam,
  updateTeam,
  removeTeam,
  addDetail,
  updateDetail,
  removeDetail,
  onSave,
  onCancel,
}: {
  form: WeeklyFormState;
  setForm: React.Dispatch<React.SetStateAction<WeeklyFormState>>;
  addTeam: () => void;
  updateTeam: (idx: number, patch: Partial<{ team: string; days: number }>) => void;
  removeTeam: (idx: number) => void;
  addDetail: () => void;
  updateDetail: (idx: number, patch: Partial<{ detail: string; team: string }>) => void;
  removeDetail: (idx: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-accent bg-surface shadow-sm">
      <div className="bg-accent px-4 py-2">
        <span className="on-accent text-xs font-bold uppercase tracking-wider">Weekly Status</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/10 px-4 py-2">
        <span className="text-xs font-medium text-text-muted">Week of:</span>
        <input
          type="date"
          className="field"
          style={{ width: 150 }}
          value={form.weekStart}
          onChange={(e) => setForm((f) => ({ ...f, weekStart: e.target.value }))}
        />
        <span className="text-xs text-text-muted">–</span>
        <input
          type="date"
          className="field"
          style={{ width: 150 }}
          value={form.weekEnd}
          onChange={(e) => setForm((f) => ({ ...f, weekEnd: e.target.value }))}
        />
        <input
          className="field flex-1"
          placeholder="Optional note, e.g. lead-in before Week 1"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        />
      </div>

      <div className="border-b border-border px-4 py-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Summary</p>
        <textarea
          className="field min-h-[72px]"
          value={form.summary}
          onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-border px-4 py-3">
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-danger">Issues found</p>
          <input
            type="number"
            min={0}
            className="field"
            value={form.issuesFound}
            onChange={(e) => setForm((f) => ({ ...f, issuesFound: Number(e.target.value) }))}
          />
        </div>
        <div className="rounded-lg border border-success/30 bg-success/10 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-success">Issues resolved</p>
          <input
            type="number"
            min={0}
            className="field"
            value={form.issuesResolved}
            onChange={(e) => setForm((f) => ({ ...f, issuesResolved: Number(e.target.value) }))}
          />
        </div>
      </div>

      <div className="border-b border-border px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Blockers by team (days)
        </p>
        <div className="flex flex-col gap-1.5">
          {form.blockerTeams.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="flex-1">
                <input
                  className="field"
                  placeholder="Team name"
                  value={t.team}
                  onChange={(e) => updateTeam(i, { team: e.target.value })}
                />
              </div>
              <div style={{ width: 80 }}>
                <input
                  type="number"
                  min={0}
                  className="field"
                  value={t.days}
                  onChange={(e) => updateTeam(i, { days: Number(e.target.value) })}
                />
              </div>
              <button aria-label="Remove team" className="text-text-muted hover:text-danger" onClick={() => removeTeam(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="btn-ghost mt-2 px-2.5 py-1 text-xs" onClick={addTeam}>
          + Add team
        </button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Blocker details</p>
        <div className="flex flex-col gap-1.5">
          {form.blockerDetails.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="flex-1">
                <input
                  className="field"
                  placeholder="Detail"
                  value={d.detail}
                  onChange={(e) => updateDetail(i, { detail: e.target.value })}
                />
              </div>
              <div style={{ width: 144 }}>
                <input
                  className="field"
                  placeholder="Team"
                  value={d.team}
                  onChange={(e) => updateDetail(i, { team: e.target.value })}
                />
              </div>
              <button
                aria-label="Remove detail"
                className="text-text-muted hover:text-danger"
                onClick={() => removeDetail(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="btn-ghost mt-2 px-2.5 py-1 text-xs" onClick={addDetail}>
          + Add detail row
        </button>
      </div>

      <div className="flex justify-end gap-2 px-4 py-3">
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  );
}
