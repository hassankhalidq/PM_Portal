"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useClosePopover } from "@/components/ui";
import { MilestoneIcon, type MilestoneType } from "@/lib/milestoneIcons";

type BoardStat = {
  id: string;
  name: string;
  description: string;
  totalProjects: number;
  totalItems: number;
  statusCounts: { NOT_STARTED: number; IN_PROGRESS: number; BLOCKED: number; DONE: number };
  avgProgress: number;
  overdueCount: number;
};
type RoadmapStat = {
  id: string;
  name: string;
  description: string;
  laneCount: number;
  itemCount: number;
  lanes: { name: string; color: string; count: number }[];
  milestones: { name: string; date: string; type: MilestoneType }[];
};
type NodeT = {
  id: string;
  name: string;
  owner: string;
  boardId: string;
  parentId: string | null;
  status: keyof BoardStat["statusCounts"];
  startDate: string | null;
};
type LogT = { date: string; activity: string; boardId: string };

const STATUS_BG: Record<keyof BoardStat["statusCounts"], string> = {
  NOT_STARTED: "bg-text-muted",
  IN_PROGRESS: "bg-info",
  BLOCKED: "bg-danger",
  DONE: "bg-success",
};
const STATUS_LABEL: Record<keyof BoardStat["statusCounts"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function useSelection(key: string, allIds: string[]) {
  const [selected, setSelected] = useState<string[]>(allIds);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(raw)) setSelected(raw.filter((id) => allIds.includes(id)));
    } catch {
      // ignore malformed storage
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };

  return { selected: hydrated ? selected : allIds, toggle };
}

function Chip({
  checked,
  label,
  title,
  onChange,
}: {
  checked: boolean;
  label: string;
  title: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
        checked ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-text"
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="cursor-pointer" />
      <span>{label}</span>
      <span
        title={title}
        className="flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-border text-[10px] font-semibold text-text-muted"
      >
        i
      </span>
    </label>
  );
}

export default function DashboardBoard({
  boards,
  roadmaps,
  nodes,
  logs,
}: {
  boards: BoardStat[];
  roadmaps: RoadmapStat[];
  nodes: NodeT[];
  logs: LogT[];
}) {
  const router = useRouter();
  const boardSel = useSelection(
    "dashboard-selected-boards",
    boards.map((b) => b.id)
  );
  const roadmapSel = useSelection(
    "dashboard-selected-roadmaps",
    roadmaps.map((r) => r.id)
  );

  const selectedBoards = boards.filter((b) => boardSel.selected.includes(b.id));
  const selectedRoadmaps = roadmaps.filter((r) => roadmapSel.selected.includes(r.id));
  const selectedBoardIds = new Set(selectedBoards.map((b) => b.id));
  const boardName = (id: string) => boards.find((b) => b.id === id)?.name ?? "";

  const scopedNodes = nodes.filter((n) => selectedBoardIds.has(n.boardId));
  type AttentionRow = { tag: string; tagClass: string; name: string; meta: string; href: string };
  const attention: AttentionRow[] = [];
  scopedNodes
    .filter((n) => n.status === "BLOCKED")
    .forEach((n) =>
      attention.push({
        tag: "Blocked",
        tagClass: "bg-danger/10 text-danger",
        name: n.name,
        meta: boardName(n.boardId),
        href: `/projects?board=${n.boardId}&view=table&item=${n.id}`,
      })
    );
  scopedNodes
    .filter((n) => n.parentId === null && !n.owner)
    .forEach((n) =>
      attention.push({
        tag: "No owner",
        tagClass: "bg-warning/10 text-warning",
        name: n.name,
        meta: "unassigned",
        href: `/projects?board=${n.boardId}&view=table&item=${n.id}`,
      })
    );
  scopedNodes
    .filter((n) => !n.startDate && n.status !== "DONE")
    .slice(0, 2)
    .forEach((n) =>
      attention.push({
        tag: "No dates",
        tagClass: "bg-surface3 text-text-muted",
        name: n.name,
        meta: boardName(n.boardId),
        href: `/projects?board=${n.boardId}&view=table&item=${n.id}`,
      })
    );
  const attentionRows = attention.slice(0, 8);

  const scopedLogs = logs.filter((l) => selectedBoardIds.has(l.boardId)).slice(0, 6);
  const logBoardId = selectedBoards.find((b) => logs.some((l) => l.boardId === b.id))?.id;
  const openLogHref = logBoardId ? `/projects?board=${logBoardId}&view=log` : "/projects?view=log";

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const paletteRef = useRef<HTMLDivElement>(null);
  useClosePopover(paletteOpen, () => setPaletteOpen(false), paletteRef);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  type PaletteCommand = { id: string; label: string; run: () => void };
  const paletteCommands: PaletteCommand[] = [
    { id: "go-project", label: "Go to Project", run: () => router.push("/projects") },
    { id: "go-product", label: "Go to Product", run: () => router.push("/roadmap") },
    {
      id: "dark-mode",
      label: "Toggle dark mode",
      run: () => {
        const el = document.documentElement;
        const next = !el.classList.contains("dark");
        el.classList.toggle("dark", next);
        localStorage.setItem("theme-preference", next ? "dark" : "light");
      },
    },
  ];
  const q = paletteQuery.trim().toLowerCase();
  const boardResults = q ? boards.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const roadmapResults = q ? roadmaps.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const commandResults = paletteCommands.filter((c) => c.label.toLowerCase().includes(q));
  const closePalette = () => {
    setPaletteOpen(false);
    setPaletteQuery("");
  };

  return (
    <div className="animate-view-in h-screen overflow-auto">
      <header className="flex items-start justify-between gap-4 border-b border-border bg-surface px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="mt-0.5 text-xs text-text-muted">Pick the boards and roadmaps you want summarized here.</p>
        </div>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="btn-ghost shrink-0 text-xs text-text-muted"
          aria-label="Open command palette"
        >
          🔍 Search
          <span className="figure ml-1 rounded border border-border px-1 text-[10px] text-text-muted">⌘K</span>
        </button>
      </header>

      {paletteOpen && (
        <div className="animate-overlay-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
          <div
            ref={paletteRef}
            className="animate-palette-in w-full max-w-lg rounded-xl border border-border bg-surface shadow-lg"
          >
            <input
              autoFocus
              className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
              placeholder="Search boards, roadmaps, or run a command…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (boardResults[0]) {
                    router.push(`/projects?board=${boardResults[0].id}`);
                    closePalette();
                  } else if (roadmapResults[0]) {
                    router.push(`/roadmap?roadmap=${roadmapResults[0].id}`);
                    closePalette();
                  } else if (commandResults[0]) {
                    commandResults[0].run();
                    closePalette();
                  }
                }
              }}
            />
            <div className="max-h-96 overflow-y-auto p-1.5">
              {boardResults.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Boards</p>
                  {boardResults.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        router.push(`/projects?board=${b.id}`);
                        closePalette();
                      }}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                    >
                      {b.name}
                    </button>
                  ))}
                </>
              )}
              {roadmapResults.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Roadmaps</p>
                  {roadmapResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        router.push(`/roadmap?roadmap=${r.id}`);
                        closePalette();
                      }}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                    >
                      {r.name}
                    </button>
                  ))}
                </>
              )}
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Commands</p>
              {commandResults.length === 0 && <p className="px-2 py-2 text-sm text-text-muted">No matching commands.</p>}
              {commandResults.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => {
                    cmd.run();
                    closePalette();
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-6 p-6">
        <div className="min-w-[420px] flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Projects</h2>
            <span className="figure text-[10.5px] text-text-muted">
              {selectedBoards.length} of {boards.length} selected
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {boards.map((b) => (
              <Chip
                key={b.id}
                checked={boardSel.selected.includes(b.id)}
                label={b.name}
                title={b.description || "No description set."}
                onChange={() => boardSel.toggle(b.id)}
              />
            ))}
          </div>
          {selectedBoards.length === 0 ? (
            <p className="text-sm text-text-muted">Select one or more boards above to see their summary.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedBoards.map((b) => {
                const total = Object.values(b.statusCounts).reduce((a, v) => a + v, 0);
                return (
                  <div key={b.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <Link href={`/projects?board=${b.id}`} className="text-[15px] font-semibold text-accent hover:underline">
                        {b.name}
                      </Link>
                      {b.overdueCount > 0 && (
                        <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">
                          {b.overdueCount} overdue
                        </span>
                      )}
                    </div>
                    <p className="figure mb-2.5 text-xs text-text-muted">
                      {b.totalProjects} projects · {b.totalItems} items
                    </p>
                    <div className="mb-2 flex h-2 w-full overflow-hidden rounded-full bg-border">
                      {(Object.keys(b.statusCounts) as (keyof BoardStat["statusCounts"])[]).map((k) => (
                        <div
                          key={k}
                          className={STATUS_BG[k]}
                          style={{ width: total ? `${(b.statusCounts[k] / total) * 100}%` : 0 }}
                        />
                      ))}
                    </div>
                    <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1">
                      {(Object.keys(b.statusCounts) as (keyof BoardStat["statusCounts"])[]).map((k) => (
                        <span key={k} className="inline-flex items-center gap-1.5 text-[11.5px] text-text-muted">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_BG[k]}`} />
                          {STATUS_LABEL[k]}
                          <span className="figure text-text">{b.statusCounts[k]}</span>
                        </span>
                      ))}
                    </div>
                    <p className="border-t border-border2 pt-2 text-xs text-text-muted">
                      Avg progress: <span className="figure font-semibold text-text">{b.avgProgress}%</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-[420px] flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Product</h2>
            <span className="figure text-[10.5px] text-text-muted">
              {selectedRoadmaps.length} of {roadmaps.length} selected
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {roadmaps.map((r) => (
              <Chip
                key={r.id}
                checked={roadmapSel.selected.includes(r.id)}
                label={r.name}
                title={r.description || "No description set."}
                onChange={() => roadmapSel.toggle(r.id)}
              />
            ))}
          </div>
          {selectedRoadmaps.length === 0 ? (
            <p className="text-sm text-text-muted">Select one or more roadmaps above to see their summary.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedRoadmaps.map((r) => (
                <div key={r.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                  <Link href={`/roadmap?roadmap=${r.id}`} className="text-[15px] font-semibold text-accent hover:underline">
                    {r.name}
                  </Link>
                  <p className="figure mb-2.5 mt-0.5 text-xs text-text-muted">
                    {r.laneCount} lanes · {r.itemCount} items
                  </p>
                  {r.lanes.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {r.lanes.map((ln, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 rounded-full bg-surface3 px-2.5 py-1 text-[11.5px] text-text"
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: ln.color }} />
                          {ln.name}
                          <span className="figure text-text-muted">{ln.count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mb-1.5 border-t border-border2 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Upcoming milestones
                  </p>
                  {r.milestones.length === 0 ? (
                    <p className="text-sm text-text-muted">No upcoming milestones</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {r.milestones.map((m, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <MilestoneIcon type={m.type} size={14} />
                          <span className="flex-1 truncate text-sm">{m.name}</span>
                          <span className="figure text-xs text-text-muted">{fmtDate(m.date)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-6 px-6 pb-6">
        <div className="min-w-[420px] flex-1 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center gap-2 border-b border-border2 px-4 py-3">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            <span className="text-[13.5px] font-semibold">Needs attention</span>
            <span className="figure text-[10.5px] text-text-muted">{attentionRows.length}</span>
          </div>
          {attentionRows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-text-muted">Nothing needs attention.</p>
          ) : (
            attentionRows.map((a, idx) => (
              <Link
                key={idx}
                href={a.href}
                className="flex items-center gap-2.5 border-b border-border2 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-bg"
              >
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${a.tagClass}`}>
                  {a.tag}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{a.name}</span>
                <span className="figure shrink-0 text-[10.5px] text-text-muted">{a.meta}</span>
              </Link>
            ))
          )}
        </div>

        <div className="min-w-[420px] flex-1 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border2 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="text-[13.5px] font-semibold">Latest activity</span>
            </div>
            <Link href={openLogHref} className="text-[11.5px] text-accent hover:underline">
              Open log
            </Link>
          </div>
          {scopedLogs.length === 0 ? (
            <p className="px-4 py-5 text-sm text-text-muted">No recent activity.</p>
          ) : (
            scopedLogs.map((l, idx) => (
              <div key={idx} className="flex gap-2.5 border-b border-border2 px-4 py-2.5 last:border-b-0">
                <span className="figure w-16 shrink-0 text-[10.5px] text-accent">{fmtDate(l.date)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-muted">{l.activity}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
