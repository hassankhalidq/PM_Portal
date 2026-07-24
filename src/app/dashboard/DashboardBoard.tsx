"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  milestones: { name: string; date: string; color: string }[];
};

const STATUS_BG: Record<keyof BoardStat["statusCounts"], string> = {
  NOT_STARTED: "bg-text-muted",
  IN_PROGRESS: "bg-info",
  BLOCKED: "bg-danger",
  DONE: "bg-success",
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

export default function DashboardBoard({ boards, roadmaps }: { boards: BoardStat[]; roadmaps: RoadmapStat[] }) {
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

  return (
    <div className="h-screen overflow-auto">
      <header className="border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-0.5 text-xs text-text-muted">Pick the boards and roadmaps you want summarized here.</p>
      </header>

      <div className="flex flex-wrap gap-6 p-6">
        <div className="min-w-[420px] flex-1">
          <h2 className="mb-2 text-sm font-semibold">Projects</h2>
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
                    <p className="text-xs text-text-muted">
                      Avg progress: <span className="figure font-semibold text-text">{b.avgProgress}%</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-[420px] flex-1">
          <h2 className="mb-2 text-sm font-semibold">Product</h2>
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
                  <p className="figure mb-3 mt-0.5 text-xs text-text-muted">
                    {r.laneCount} lanes · {r.itemCount} items
                  </p>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Upcoming milestones
                  </p>
                  {r.milestones.length === 0 ? (
                    <p className="text-sm text-text-muted">No upcoming milestones</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {r.milestones.map((m, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="11" fill={m.color} fillOpacity="0.15" />
                          </svg>
                          <span className="flex-1 text-sm">{m.name}</span>
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
    </div>
  );
}
