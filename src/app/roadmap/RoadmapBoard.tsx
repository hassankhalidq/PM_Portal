"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  applyRoadmapTheme,
  createCategory,
  createItem,
  createMilestone,
  createRoadmap,
  deleteCategory,
  deleteItem,
  deleteMilestone,
  deleteRoadmap,
  moveCategory,
  reorderItems,
  renameRoadmap,
  updateCategory,
  updateItem,
  updateMilestone,
} from "@/lib/actions";
import EntitySwitcher from "@/components/EntitySwitcher";
import { ROADMAP_THEMES } from "@/lib/roadmapThemes";
import { formatDateRange, HoverCardContent, useHoverCard } from "./HoverCard";

type ItemT = {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  categoryId: string;
};
type CategoryT = { id: string; name: string; color: string; items: ItemT[] };
type MilestoneType = "RELEASE" | "LAUNCH" | "DEADLINE" | "CHECKPOINT" | "DEPRECATION";
type MilestoneT = {
  id: string;
  name: string;
  type: MilestoneType;
  date: string;
  description: string;
};
type RoadmapT = { id: string; name: string; description: string; isDefault: boolean };

const DAY = 86400000;

function darken(hex: string, amt: number) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.round(parseInt(c.substring(0, 2), 16) * (1 - amt));
  const g = Math.round(parseInt(c.substring(2, 4), 16) * (1 - amt));
  const b = Math.round(parseInt(c.substring(4, 6), 16) * (1 - amt));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const MILESTONE_META: Record<MilestoneType, { label: string; color: string }> = {
  RELEASE: { label: "Release", color: "#D97706" },
  LAUNCH: { label: "Launch", color: "#16A34A" },
  DEADLINE: { label: "Deadline", color: "#DC2626" },
  CHECKPOINT: { label: "Checkpoint", color: "#2563EB" },
  DEPRECATION: { label: "Deprecation", color: "#71717A" },
};
const SWATCHES = ["#4F46E5", "#0284C7", "#7C3AED", "#DB2777", "#D97706", "#475569"];

const parse = (s: string) => Date.parse(s + "T00:00:00Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfQuarter = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
};
const addMonths = (t: number, m: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MilestoneGlyph({ type, c }: { type: MilestoneType; c: string }) {
  switch (type) {
    case "RELEASE":
      return <rect x="8.5" y="8.5" width="7" height="7" transform="rotate(45 12 12)" fill={c} />;
    case "LAUNCH":
      return (
        <>
          <path d="M9 5.5v13" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M9 6.5h7l-2.3 3L16 12.5H9z" fill={c} />
        </>
      );
    case "DEADLINE":
      return <rect x="7.5" y="7.5" width="9" height="9" rx="1" fill={c} />;
    case "CHECKPOINT":
      return <circle cx="12" cy="12" r="4.5" fill={c} />;
    case "DEPRECATION":
      return <path d="M8 8l8 8M16 8l-8 8" stroke={c} strokeWidth="2" strokeLinecap="round" />;
  }
}

function MilestoneIcon({ type, size = 16 }: { type: MilestoneType; size?: number }) {
  const c = MILESTONE_META[type].color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill={c} fillOpacity="0.12" />
      <MilestoneGlyph type={type} c={c} />
    </svg>
  );
}

type Panel =
  | { kind: "item"; id: string }
  | { kind: "milestone"; id: string }
  | { kind: "new-item" }
  | { kind: "new-milestone" }
  | { kind: "lanes" }
  | null;

type ZoomBand = "quarterly" | "mixed" | "monthly" | "daily";

type DragState =
  | { kind: "milestone"; id: string; startX: number; origDate: number; moved: boolean }
  | {
      kind: "item-move" | "item-resize-start" | "item-resize-end";
      id: string;
      startX: number;
      origStart: number;
      origEnd: number;
      moved: boolean;
    }
  | { kind: "item-reorder"; id: string; categoryId: string; startY: number; origIndex: number; moved: boolean };

export default function RoadmapBoard({
  roadmaps,
  currentRoadmapId,
  currentTheme,
  categories,
  milestones,
}: {
  roadmaps: RoadmapT[];
  currentRoadmapId: string;
  currentTheme: string;
  categories: CategoryT[];
  milestones: MilestoneT[];
}) {
  const [pxPerDay, setPxPerDay] = useState(4);
  const [panel, setPanel] = useState<Panel>(null);
  // Optimistic date overrides while a drag round-trips to the server.
  const [overrides, setOverrides] = useState<Record<string, { start: number; end: number }>>({});
  useEffect(() => setOverrides({}), [categories, milestones]);

  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<MilestoneType>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [reorderDrag, setReorderDrag] = useState<{ id: string; deltaY: number } | null>(null);

  const toggleCategory = (id: string) =>
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleType = (t: MilestoneType) =>
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const allItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);

  const today = useMemo(() => {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const zoomBand: ZoomBand =
    pxPerDay <= 5 ? "quarterly" : pxPerDay <= 8 ? "mixed" : pxPerDay <= 16 ? "monthly" : "daily";

  // "Now" window = current quarter + next quarter (monthly headers); beyond = "Later" (quarterly). Mixed band only.
  const seam = useMemo(() => addMonths(startOfQuarter(today), 6), [today]);

  // Tracks the scrollable area's own width so the date range below can be
  // stretched to fill it — otherwise a short data range at a very zoomed-out
  // setting leaves visible dead space past the last column instead of using
  // the screen.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [rangeStart, rangeEnd] = useMemo(() => {
    let min = startOfQuarter(today);
    let max = addMonths(startOfQuarter(today), 12);
    for (const i of allItems) {
      min = Math.min(min, parse(i.startDate));
      max = Math.max(max, parse(i.endDate));
    }
    for (const m of milestones) {
      min = Math.min(min, parse(m.date));
      max = Math.max(max, parse(m.date));
    }
    const start = startOfQuarter(min);
    let end = addMonths(startOfQuarter(max), 3);
    if (containerWidth > 0) {
      const neededDays = Math.ceil(containerWidth / pxPerDay);
      const currentDays = Math.round((end - start) / DAY);
      if (currentDays < neededDays) {
        end = addMonths(startOfQuarter(start + neededDays * DAY), 3);
      }
    }
    return [start, end];
  }, [allItems, milestones, today, containerWidth, pxPerDay]);

  const totalDays = Math.round((rangeEnd - rangeStart) / DAY);
  const width = totalDays * pxPerDay;
  const x = (t: number) => ((t - rangeStart) / DAY) * pxPerDay;

  const headerSegments = useMemo(() => {
    const segs: { label: string; from: number; to: number; zone: "now" | "later" }[] = [];
    let cursor = rangeStart;

    if (zoomBand === "quarterly") {
      while (cursor < rangeEnd) {
        const qStart = startOfQuarter(cursor);
        const next = Math.min(addMonths(qStart, 3), rangeEnd);
        const d = new Date(qStart);
        segs.push({ label: `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`, from: cursor, to: next, zone: "later" });
        cursor = next;
      }
      return segs;
    }

    if (zoomBand === "monthly") {
      while (cursor < rangeEnd) {
        const next = Math.min(addMonths(cursor, 1), rangeEnd);
        const d = new Date(cursor);
        segs.push({ label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, from: cursor, to: next, zone: "now" });
        cursor = next;
      }
      return segs;
    }

    if (zoomBand === "daily") {
      while (cursor < rangeEnd) {
        const next = Math.min(cursor + DAY, rangeEnd);
        const d = new Date(cursor);
        const dayNum = d.getUTCDate();
        const label = dayNum === 1 ? `${MONTHS[d.getUTCMonth()]} 1` : String(dayNum);
        segs.push({ label, from: cursor, to: next, zone: "now" });
        cursor = next;
      }
      return segs;
    }

    // "mixed" band — existing now/later behavior.
    while (cursor < rangeEnd) {
      if (cursor < seam) {
        const next = Math.min(addMonths(cursor, 1), rangeEnd);
        const d = new Date(cursor);
        segs.push({
          label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
          from: cursor,
          to: next,
          zone: "now",
        });
        cursor = next;
      } else {
        const qStart = startOfQuarter(cursor);
        const next = Math.min(addMonths(qStart, 3), rangeEnd);
        const d = new Date(qStart);
        segs.push({
          label: `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`,
          from: cursor,
          to: next,
          zone: "later",
        });
        cursor = next;
      }
    }
    return segs;
  }, [rangeStart, rangeEnd, seam, zoomBand]);

  // ---- drag handling ----
  const drag = useRef<DragState | null>(null);
  const [, startTransition] = useTransition();

  const beginMilestoneDrag = (e: React.PointerEvent, id: string, origDate: number) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "milestone", id, startX: e.clientX, origDate, moved: false };
    setIsDragging(true);
  };

  const beginItemMove = (e: React.PointerEvent, id: string, origStart: number, origEnd: number) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "item-move", id, startX: e.clientX, origStart, origEnd, moved: false };
    setIsDragging(true);
  };

  const beginItemResize = (
    e: React.PointerEvent,
    edge: "start" | "end",
    id: string,
    origStart: number,
    origEnd: number
  ) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: edge === "start" ? "item-resize-start" : "item-resize-end", id, startX: e.clientX, origStart, origEnd, moved: false };
    setIsDragging(true);
  };

  const beginReorder = (e: React.PointerEvent, id: string, categoryId: string, index: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "item-reorder", id, categoryId, startY: e.clientY, origIndex: index, moved: false };
    setIsDragging(true);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;

    if (d.kind === "milestone") {
      const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
      if (deltaDays !== 0) d.moved = true;
      setOverrides((o) => ({ ...o, [d.id]: { start: d.origDate + deltaDays * DAY, end: d.origDate + deltaDays * DAY } }));
      return;
    }
    if (d.kind === "item-move") {
      const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
      if (deltaDays !== 0) d.moved = true;
      setOverrides((o) => ({ ...o, [d.id]: { start: d.origStart + deltaDays * DAY, end: d.origEnd + deltaDays * DAY } }));
      return;
    }
    if (d.kind === "item-resize-start") {
      const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
      if (deltaDays !== 0) d.moved = true;
      const newStart = Math.min(d.origStart + deltaDays * DAY, d.origEnd - DAY);
      setOverrides((o) => ({ ...o, [d.id]: { start: newStart, end: d.origEnd } }));
      return;
    }
    if (d.kind === "item-resize-end") {
      const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
      if (deltaDays !== 0) d.moved = true;
      const newEnd = Math.max(d.origEnd + deltaDays * DAY, d.origStart + DAY);
      setOverrides((o) => ({ ...o, [d.id]: { start: d.origStart, end: newEnd } }));
      return;
    }
    if (d.kind === "item-reorder") {
      const deltaY = e.clientY - d.startY;
      if (Math.abs(deltaY) > 2) d.moved = true;
      setReorderDrag({ id: d.id, deltaY });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setIsDragging(false);
    if (!d) return;

    if (d.kind === "milestone") {
      const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
      if (!d.moved || deltaDays === 0) {
        setOverrides((o) => {
          const { [d.id]: _, ...rest } = o;
          return rest;
        });
        setPanel({ kind: "milestone", id: d.id });
        return;
      }
      const newDate = iso(d.origDate + deltaDays * DAY);
      startTransition(async () => {
        try {
          await updateMilestone(d.id, { date: newDate });
        } catch {
          setOverrides((o) => {
            const { [d.id]: _, ...rest } = o;
            return rest;
          });
        }
      });
      return;
    }

    if (d.kind === "item-move" || d.kind === "item-resize-start" || d.kind === "item-resize-end") {
      const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
      if (!d.moved || deltaDays === 0) {
        setOverrides((o) => {
          const { [d.id]: _, ...rest } = o;
          return rest;
        });
        setPanel({ kind: "item", id: d.id });
        return;
      }
      let newStart = d.origStart;
      let newEnd = d.origEnd;
      if (d.kind === "item-move") {
        newStart += deltaDays * DAY;
        newEnd += deltaDays * DAY;
      } else if (d.kind === "item-resize-start") {
        newStart = Math.min(d.origStart + deltaDays * DAY, d.origEnd - DAY);
      } else {
        newEnd = Math.max(d.origEnd + deltaDays * DAY, d.origStart + DAY);
      }
      startTransition(async () => {
        try {
          await updateItem(d.id, { startDate: iso(newStart), endDate: iso(newEnd) });
        } catch {
          setOverrides((o) => {
            const { [d.id]: _, ...rest } = o;
            return rest;
          });
        }
      });
      return;
    }

    if (d.kind === "item-reorder") {
      setReorderDrag(null);
      if (!d.moved) {
        setPanel({ kind: "item", id: d.id });
        return;
      }
      const category = categories.find((c) => c.id === d.categoryId);
      if (!category) return;
      const deltaY = e.clientY - d.startY;
      const rawIndex = d.origIndex + Math.round(deltaY / 38);
      const clamped = Math.max(0, Math.min(category.items.length - 1, rawIndex));
      if (clamped !== d.origIndex) {
        const reordered = [...category.items];
        const [moved] = reordered.splice(d.origIndex, 1);
        reordered.splice(clamped, 0, moved);
        // No local optimistic order state to revert here (the transient
        // drag offset above is already cleared) — the list simply stays in
        // its last-known-good order if this fails, matching current data.
        startTransition(() => reorderItems(d.categoryId, reordered.map((i) => i.id)).catch(() => {}));
      }
    }
  };

  const itemDates = (i: ItemT) =>
    overrides[i.id] ?? { start: parse(i.startDate), end: parse(i.endDate) };
  const msDate = (m: MilestoneT) => overrides[m.id]?.start ?? parse(m.date);

  const selectedItem =
    panel?.kind === "item" ? allItems.find((i) => i.id === panel.id) ?? null : null;
  const selectedMs =
    panel?.kind === "milestone" ? milestones.find((m) => m.id === panel.id) ?? null : null;

  const activeTheme = ROADMAP_THEMES[currentTheme] ?? ROADMAP_THEMES.indigo;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <div className="mr-auto flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold">Product</h1>
            <p className="figure text-xs text-text-muted">
              {categories.length} lanes · {allItems.length} items · {milestones.length} milestones
            </p>
          </div>
          <EntitySwitcher
            label="Roadmap"
            entities={roadmaps}
            currentId={currentRoadmapId}
            paramName="roadmap"
            basePath="/roadmap"
            actions={{ create: createRoadmap, rename: renameRoadmap, remove: deleteRoadmap }}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Zoom
          <input
            type="range"
            min={2}
            max={32}
            step={1}
            value={pxPerDay}
            onChange={(e) => setPxPerDay(Number(e.target.value))}
            aria-label="Timeline zoom"
          />
        </label>
        <button className="btn-ghost" onClick={() => setPanel({ kind: "lanes" })}>
          Manage lanes
        </button>
        <button className="btn-ghost" onClick={() => setPanel({ kind: "new-milestone" })}>
          Add milestone
        </button>
        <button
          className="btn-primary"
          onClick={() => setPanel({ kind: "new-item" })}
          disabled={categories.length === 0}
        >
          Add item
        </button>
      </header>

      <div
        ref={scrollRef}
        className="roadmap-content flex-1 overflow-auto"
        style={{ ["--roadmap-tint" as string]: activeTheme.bgTint }}
      >
        <div className="min-w-full w-max">
          {/* Header rail */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-surface">
            <div className="sticky left-0 z-30 w-44 shrink-0 border-r border-border bg-surface px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Timeline
            </div>
            <div className="relative h-9" style={{ width }}>
              {headerSegments.map((s) => (
                <div
                  key={s.from}
                  className={`figure absolute top-0 flex h-full items-center border-r border-border px-2 text-xs font-medium ${
                    s.zone === "now" ? "text-text" : "bg-bg text-text-muted"
                  }`}
                  style={{ left: x(s.from), width: x(s.to) - x(s.from) }}
                >
                  {s.label}
                </div>
              ))}
              {zoomBand === "mixed" && (
                <div
                  className="absolute top-0 h-full border-l-2 border-dashed border-warning"
                  style={{ left: x(seam) }}
                  title="Now / Later boundary"
                />
              )}
            </div>
          </div>

          {/* Milestone lane */}
          <div className="flex border-b border-border bg-warning/5">
            <div className="sticky left-0 z-10 flex w-44 shrink-0 items-center border-r border-border bg-surface px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
                Milestones
              </span>
            </div>
            <div className="relative h-12" style={{ width }}>
              <GridLines segments={headerSegments} x={x} />
              <TodayLine x={x(today)} />
              <span
                className="on-accent figure absolute -top-1 z-20 -translate-x-1/2 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ left: x(today) }}
              >
                Today
              </span>
              {milestones.map((m) => (
                <MilestoneMarker
                  key={m.id}
                  milestone={m}
                  date={msDate(m)}
                  x={x}
                  hidden={hiddenTypes.has(m.type)}
                  isDragging={isDragging}
                  onBeginDrag={beginMilestoneDrag}
                  onDragMove={onDragMove}
                  onEndDrag={endDrag}
                />
              ))}
            </div>
          </div>

          {/* Category swimlanes */}
          {categories.map((c, laneIdx) => (
            <div
              key={c.id}
              className={`flex border-b border-border/70 ${
                laneIdx < categories.length - 1 ? "mb-3" : ""
              }`}
            >
              <button
                onClick={() => toggleCategory(c.id)}
                title={hiddenCategories.has(c.id) ? "Click to show this lane" : "Click to hide this lane"}
                className={`sticky left-0 z-10 flex w-44 shrink-0 items-center gap-2 border-r border-border bg-surface px-4 text-left hover:bg-bg ${
                  hiddenCategories.has(c.id) ? "opacity-50" : ""
                }`}
                style={{ minHeight: Math.max(56, c.items.length * 38 + 22) }}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} />
                <span
                  className={`truncate text-sm font-medium ${hiddenCategories.has(c.id) ? "line-through" : ""}`}
                >
                  {c.name}
                </span>
              </button>
              <div
                className={`relative ${hiddenCategories.has(c.id) ? "opacity-25 pointer-events-none" : ""}`}
                style={{ width, minHeight: Math.max(56, c.items.length * 38 + 22) }}
              >
                <GridLines segments={headerSegments} x={x} />
                {zoomBand === "mixed" && (
                  <div
                    className="absolute inset-y-0 border-l-2 border-dashed border-warning/60"
                    style={{ left: x(seam) }}
                  />
                )}
                <TodayLine x={x(today)} />
                {c.items.map((i, idx) => (
                  <ItemBar
                    key={i.id}
                    item={i}
                    idx={idx}
                    color={c.color}
                    d={itemDates(i)}
                    x={x}
                    isDragging={isDragging}
                    dragY={reorderDrag?.id === i.id ? reorderDrag.deltaY : 0}
                    onBeginMove={beginItemMove}
                    onBeginResize={beginItemResize}
                    onBeginReorder={beginReorder}
                    onDragMove={onDragMove}
                    onEndDrag={endDrag}
                  />
                ))}
              </div>
            </div>
          ))}

          {categories.length === 0 && (
            <div className="p-10 text-center text-sm text-text-muted">
              No lanes yet. Open Manage lanes to create your first category.
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <footer className="flex flex-wrap items-center gap-4 border-t border-border bg-surface px-6 py-2 text-[11px] text-text-muted">
        {(Object.keys(MILESTONE_META) as MilestoneType[]).map((t) => (
          <button
            key={t}
            onClick={() => toggleType(t)}
            title="Click to show/hide this milestone type"
            className={`flex items-center gap-1 ${hiddenTypes.has(t) ? "opacity-40 line-through" : ""}`}
          >
            <MilestoneIcon type={t} size={12} /> {MILESTONE_META[t].label}
          </button>
        ))}
        <span className="ml-auto">Drag a bar or marker to reschedule · click a lane to dim it · click to open details</span>
      </footer>

      {panel?.kind === "lanes" && (
        <PanelFrame title="Manage lanes" onClose={() => setPanel(null)}>
          <LaneManager categories={categories} roadmapId={currentRoadmapId} currentTheme={currentTheme} />
        </PanelFrame>
      )}
      {panel?.kind === "new-item" && (
        <PanelFrame title="Add roadmap item" onClose={() => setPanel(null)}>
          <ItemForm categories={categories} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
      {selectedItem && (
        <PanelFrame key={selectedItem.id} title="Roadmap item" onClose={() => setPanel(null)}>
          <ItemForm categories={categories} item={selectedItem} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
      {panel?.kind === "new-milestone" && (
        <PanelFrame title="Add milestone" onClose={() => setPanel(null)}>
          <MilestoneForm roadmapId={currentRoadmapId} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
      {selectedMs && (
        <PanelFrame key={selectedMs.id} title="Milestone" onClose={() => setPanel(null)}>
          <MilestoneForm milestone={selectedMs} roadmapId={currentRoadmapId} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
    </div>
  );
}

function ItemBar({
  item,
  idx,
  color,
  d,
  x,
  isDragging,
  dragY,
  onBeginMove,
  onBeginResize,
  onBeginReorder,
  onDragMove,
  onEndDrag,
}: {
  item: ItemT;
  idx: number;
  color: string;
  d: { start: number; end: number };
  x: (t: number) => number;
  isDragging: boolean;
  dragY: number;
  onBeginMove: (e: React.PointerEvent, id: string, origStart: number, origEnd: number) => void;
  onBeginResize: (e: React.PointerEvent, edge: "start" | "end", id: string, origStart: number, origEnd: number) => void;
  onBeginReorder: (e: React.PointerEvent, id: string, categoryId: string, index: number) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onEndDrag: (e: React.PointerEvent) => void;
}) {
  const hover = useHoverCard(isDragging);
  const left = x(d.start);
  const w = Math.max(x(d.end + DAY) - left, 14);

  return (
    <div
      className="group absolute"
      style={{ left: left - 14, width: w + 14, top: 12 + idx * 38 + dragY }}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <div
        className="absolute left-0 top-0 flex h-7 w-3.5 cursor-grab touch-none items-center justify-center text-text-muted opacity-0 group-hover:opacity-60 active:cursor-grabbing"
        onPointerDown={(e) => onBeginReorder(e, item.id, item.categoryId, idx)}
        onPointerMove={onDragMove}
        onPointerUp={onEndDrag}
      >
        ⠿
      </div>
      <button
        className="absolute top-0 z-10 h-7 cursor-grab touch-none overflow-hidden rounded-full text-left text-[11px] font-medium text-white shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
        style={{ left: 14, width: w, background: idx % 2 === 1 ? darken(color, 0.18) : color }}
        onPointerDown={(e) => onBeginMove(e, item.id, d.start, d.end)}
        onPointerMove={onDragMove}
        onPointerUp={onEndDrag}
      >
        <div
          className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize"
          onPointerDown={(e) => onBeginResize(e, "start", item.id, d.start, d.end)}
          onPointerMove={onDragMove}
          onPointerUp={onEndDrag}
        />
        <span className="block truncate px-2.5">{item.name}</span>
        <div
          className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize"
          onPointerDown={(e) => onBeginResize(e, "end", item.id, d.start, d.end)}
          onPointerMove={onDragMove}
          onPointerUp={onEndDrag}
        />
      </button>
      {hover.visible && (
        <HoverCardContent
          title={item.name}
          dateRange={formatDateRange(iso(d.start), iso(d.end))}
          description={item.description}
        />
      )}
    </div>
  );
}

function MilestoneMarker({
  milestone,
  date,
  x,
  hidden,
  isDragging,
  onBeginDrag,
  onDragMove,
  onEndDrag,
}: {
  milestone: MilestoneT;
  date: number;
  x: (t: number) => number;
  hidden: boolean;
  isDragging: boolean;
  onBeginDrag: (e: React.PointerEvent, id: string, origDate: number) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onEndDrag: (e: React.PointerEvent) => void;
}) {
  const hover = useHoverCard(isDragging);
  return (
    <button
      className={`focus-ring absolute top-1/2 z-10 flex -translate-y-1/2 cursor-grab touch-none items-center gap-1 rounded-md px-1 py-0.5 hover:bg-surface active:cursor-grabbing ${
        hidden ? "pointer-events-none opacity-20" : ""
      }`}
      style={{ left: x(date) - 7 }}
      onPointerDown={(e) => onBeginDrag(e, milestone.id, date)}
      onPointerMove={onDragMove}
      onPointerUp={onEndDrag}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <MilestoneIcon type={milestone.type} />
      <span className="max-w-40 truncate text-[11px] font-medium">{milestone.name}</span>
      {hover.visible && (
        <HoverCardContent
          title={`${MILESTONE_META[milestone.type].label}: ${milestone.name}`}
          dateRange={new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
          description={milestone.description}
        />
      )}
    </button>
  );
}

function TodayLine({ x }: { x: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 border-l border-accent/50"
      style={{ left: x }}
      aria-hidden
    />
  );
}

// Persistent vertical month/quarter gridlines, reusing the header's own
// segment boundaries. Rendered per-row (milestone lane + each swimlane) to
// match this file's existing pattern of duplicating TodayLine/the seam line
// per row, rather than restructuring the layout into one global overlay.
function GridLines({ segments, x }: { segments: { from: number }[]; x: (t: number) => number }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 right-0" aria-hidden>
      {segments.slice(1).map((s) => (
        <div key={s.from} className="absolute inset-y-0 border-l border-border/60" style={{ left: x(s.from) }} />
      ))}
    </div>
  );
}

function PanelFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <button aria-label="Close panel" className="btn-ghost h-8 w-8 justify-center p-0" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}

function ItemForm({
  categories,
  item,
  onDone,
}: {
  categories: CategoryT[];
  item?: ItemT;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    categoryId: item?.categoryId ?? categories[0]?.id ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    startDate: item?.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: item?.endDate ?? new Date(Date.now() + 13 * DAY).toISOString().slice(0, 10),
  });
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      if (item) await updateItem(item.id, form);
      else await createItem(form);
      onDone();
    });

  const remove = () => {
    if (!item || !confirm("Delete this roadmap item?")) return;
    start(async () => {
      await deleteItem(item.id);
      onDone();
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Name</label>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Lane</label>
        <select
          className="field"
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
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
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Description</label>
        <textarea
          className="field min-h-24"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={pending || !form.name.trim() || !form.categoryId}>
          {pending ? "Saving..." : item ? "Save changes" : "Add item"}
        </button>
        {item && (
          <button className="btn-ghost text-danger" onClick={remove} disabled={pending}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function MilestoneForm({
  milestone,
  roadmapId,
  onDone,
}: {
  milestone?: MilestoneT;
  roadmapId: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: milestone?.name ?? "",
    type: milestone?.type ?? ("RELEASE" as MilestoneType),
    date: milestone?.date ?? new Date().toISOString().slice(0, 10),
    description: milestone?.description ?? "",
  });
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      if (milestone) await updateMilestone(milestone.id, form);
      else await createMilestone({ ...form, roadmapId });
      onDone();
    });

  const remove = () => {
    if (!milestone || !confirm("Delete this milestone?")) return;
    start(async () => {
      await deleteMilestone(milestone.id);
      onDone();
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Name</label>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Type</label>
          <select
            className="field"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as MilestoneType })}
          >
            {(Object.keys(MILESTONE_META) as MilestoneType[]).map((t) => (
              <option key={t} value={t}>
                {MILESTONE_META[t].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Date</label>
          <input
            type="date"
            className="field font-mono tabular-nums"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-bg px-3 py-2 text-xs text-text-muted">
        <MilestoneIcon type={form.type} /> Shown on the milestone lane as this marker.
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
        <button className="btn-primary" onClick={save} disabled={pending || !form.name.trim()}>
          {pending ? "Saving..." : milestone ? "Save changes" : "Add milestone"}
        </button>
        {milestone && (
          <button className="btn-ghost text-danger" onClick={remove} disabled={pending}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ThemePicker({ roadmapId, currentTheme }: { roadmapId: string; currentTheme: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Theme</h3>
      <div className="flex flex-wrap gap-2">
        {Object.entries(ROADMAP_THEMES).map(([key, t]) => (
          <button
            key={key}
            title={t.label}
            aria-label={`Apply ${t.label} theme`}
            disabled={pending}
            className={`h-8 w-8 rounded-full ring-offset-2 ${currentTheme === key ? "ring-2 ring-accent" : ""}`}
            style={{ background: t.accent }}
            onClick={() => start(() => applyRoadmapTheme(roadmapId, key))}
          />
        ))}
      </div>
    </div>
  );
}

function LaneManager({
  categories,
  roadmapId,
  currentTheme,
}: {
  categories: CategoryT[];
  roadmapId: string;
  currentTheme: string;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {categories.map((c, idx) => (
          <LaneRow
            key={c.id}
            category={c}
            first={idx === 0}
            last={idx === categories.length - 1}
            onlyOne={categories.length === 1}
            setError={setError}
          />
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">New lane</h3>
        <div className="space-y-3">
          <input
            className="field"
            placeholder="Lane name (e.g. Integrations)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                aria-label={`Use color ${s}`}
                className={`focus-ring h-7 w-7 rounded-md ${color === s ? "ring-2 ring-text ring-offset-1" : ""}`}
                style={{ background: s }}
                onClick={() => setColor(s)}
              />
            ))}
          </div>
          <button
            className="btn-primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                await createCategory(name, color, roadmapId);
                setName("");
              })
            }
          >
            {pending ? "Adding..." : "Add lane"}
          </button>
        </div>
      </div>
      <ThemePicker roadmapId={roadmapId} currentTheme={currentTheme} />
    </div>
  );
}

function LaneRow({
  category,
  first,
  last,
  onlyOne,
  setError,
}: {
  category: CategoryT;
  first: boolean;
  last: boolean;
  onlyOne: boolean;
  setError: (s: string) => void;
}) {
  const [name, setName] = useState(category.name);
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <input
        aria-label="Lane color"
        type="color"
        value={category.color}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        onChange={(e) => start(() => updateCategory(category.id, { color: e.target.value }))}
      />
      <input
        className="field border-transparent px-2 py-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== category.name)
            start(() => updateCategory(category.id, { name }));
        }}
      />
      <button
        className="btn-ghost h-7 w-7 justify-center p-0"
        disabled={first || pending}
        aria-label="Move lane up"
        onClick={() => start(() => moveCategory(category.id, "up"))}
      >
        ↑
      </button>
      <button
        className="btn-ghost h-7 w-7 justify-center p-0"
        disabled={last || pending}
        aria-label="Move lane down"
        onClick={() => start(() => moveCategory(category.id, "down"))}
      >
        ↓
      </button>
      <button
        className="btn-ghost h-7 w-7 justify-center p-0 text-danger"
        disabled={onlyOne || pending}
        aria-label="Delete lane"
        title={onlyOne ? "At least one lane must exist" : "Delete lane and its items"}
        onClick={() => {
          if (!confirm(`Delete lane "${category.name}" and all its items?`)) return;
          setError("");
          start(async () => {
            try {
              await deleteCategory(category.id);
            } catch {
              setError("At least one lane must exist.");
            }
          });
        }}
      >
        ✕
      </button>
    </div>
  );
}
