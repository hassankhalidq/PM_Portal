"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  applyRoadmapTheme,
  commitLaneDrop,
  convertItemToMilestone,
  convertMilestoneToItem,
  createCategory,
  createItem,
  createMilestone,
  createRoadmap,
  deleteCategory,
  deleteItem,
  deleteMilestone,
  deleteRoadmap,
  moveCategory,
  renameRoadmap,
  updateCategory,
  updateItem,
  updateMilestone,
} from "@/lib/actions";
import EntitySwitcher from "@/components/EntitySwitcher";
import { ROADMAP_THEMES } from "@/lib/roadmapThemes";
import { formatDateRange, fmtLong, HoverCardContent, useHoverCard } from "./HoverCard";
import { useClosePopover, ConfirmDeleteButton } from "@/components/ui";
import { MILESTONE_META, MilestoneIcon, type MilestoneType } from "@/lib/milestoneIcons";
import { getSnapWeeks, SNAP_WEEKS_EVENT } from "@/lib/uiPrefs";

type RoadmapStage = "EXPLORING" | "PLANNED" | "COMMITTED";
type ItemT = {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  stage: RoadmapStage;
  categoryId: string;
  sortOrder: number;
};
type CategoryT = { id: string; name: string; color: string; items: ItemT[] };
type MilestoneT = {
  id: string;
  name: string;
  type: MilestoneType;
  date: string;
  description: string;
  categoryId: string;
  sortOrder: number;
};
type RoadmapT = { id: string; name: string; description: string; isDefault: boolean };
type LaneEntry =
  | { kind: "item"; sortOrder: number; entry: ItemT }
  | { kind: "milestone"; sortOrder: number; entry: MilestoneT };

const DAY = 86400000;
const HALF_DAY = DAY / 2;
const MAX_ZOOM_OUT_DAYS = 546; // 6 quarters (91 days each)
const ROW_HEIGHT = 38;
const ROW_TOP = 12;

function darken(hex: string, amt: number) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.round(parseInt(c.substring(0, 2), 16) * (1 - amt));
  const g = Math.round(parseInt(c.substring(2, 4), 16) * (1 - amt));
  const b = Math.round(parseInt(c.substring(4, 6), 16) * (1 - amt));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const SWATCHES = ["#4F46E5", "#0284C7", "#7C3AED", "#DB2777", "#D97706", "#475569"];

// Reuses the same semantic tokens as everywhere else in the app (accent =
// committed/confident, info = planned, warning = exploring/early) rather
// than introducing a parallel color system just for this one chip set.
const STAGE_META: Record<RoadmapStage, { label: string; dot: string; text: string }> = {
  EXPLORING: { label: "Exploring", dot: "bg-warning", text: "text-warning" },
  PLANNED: { label: "Planned", dot: "bg-info", text: "text-info" },
  COMMITTED: { label: "Committed", dot: "bg-accent", text: "text-accent" },
};
const STAGE_ORDER: RoadmapStage[] = ["EXPLORING", "PLANNED", "COMMITTED"];

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

// A milestone is a point date but renders as icon + truncated label (max-w-40
// = 160px cap), so lane packing needs to reserve real horizontal space for
// it. Measuring the actual text (rather than assuming the 160px worst case)
// keeps short-named milestones from over-reserving space and defeating the
// point of compact packing.
let milestoneMeasureCtx: CanvasRenderingContext2D | null | undefined;
const milestoneWidthCache = new Map<string, number>();
function measureMilestoneWidth(name: string): number {
  const cached = milestoneWidthCache.get(name);
  if (cached !== undefined) return cached;
  const FALLBACK = 200; // icon+padding+full 160px label cap; used if canvas unavailable (SSR pass)
  if (typeof document === "undefined") return FALLBACK;
  if (milestoneMeasureCtx === undefined) {
    milestoneMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  const CHROME = 36; // icon(16) + gap(4) + padding(12) + small buffer
  let labelWidth = 160;
  if (milestoneMeasureCtx) {
    milestoneMeasureCtx.font = "500 11px system-ui, -apple-system, sans-serif";
    labelWidth = Math.min(160, milestoneMeasureCtx.measureText(name).width);
  }
  const total = Math.ceil(labelWidth + CHROME);
  milestoneWidthCache.set(name, total);
  return total;
}

type Panel =
  | { kind: "item"; id: string }
  | { kind: "milestone"; id: string }
  | { kind: "new-item"; categoryId?: string }
  | { kind: "new-milestone"; categoryId?: string }
  | { kind: "lanes" }
  | null;

type ZoomBand = "quarterly" | "mixed" | "monthly" | "weekly";

type DragState =
  | { kind: "milestone"; id: string; startX: number; origDate: number; origCategoryId: string; origRow: number; moved: boolean }
  | {
      kind: "item-move";
      id: string;
      startX: number;
      origStart: number;
      origEnd: number;
      origCategoryId: string;
      origRow: number;
      moved: boolean;
    }
  | {
      kind: "item-resize-start" | "item-resize-end";
      id: string;
      startX: number;
      origStart: number;
      origEnd: number;
      origCategoryId: string;
      moved: boolean;
    };

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
  const [snapWeeks, setSnapWeeksState] = useState(false);
  useEffect(() => {
    setSnapWeeksState(getSnapWeeks());
    const onSnap = (e: Event) => setSnapWeeksState((e as CustomEvent<boolean>).detail);
    window.addEventListener(SNAP_WEEKS_EVENT, onSnap);
    return () => window.removeEventListener(SNAP_WEEKS_EVENT, onSnap);
  }, []);
  const snapDays = (raw: number) => (snapWeeks ? Math.round(raw / 7) * 7 : raw);
  const [panel, setPanel] = useState<Panel>(null);
  // Optimistic date overrides while a drag round-trips to the server.
  const [overrides, setOverrides] = useState<Record<string, { start: number; end: number }>>({});
  // Transient "this entry is being dragged to a specific row, possibly in a
  // different lane" preview (cleared once revalidated props land, mirroring
  // how `overrides` is cleared below). This is a pure rendering offset —
  // it never changes which lane's DOM subtree the dragged entry renders in
  // (see packedByLane below) — re-parenting mid-drag is what broke native
  // pointer capture last time this file's drag system was reworked.
  const [dragRowPreview, setDragRowPreview] = useState<{ id: string; categoryId: string; row: number } | null>(null);
  const drag = useRef<DragState | null>(null);
  // A revalidation from an EARLIER action can land while a NEW drag is
  // already in progress (categories/milestones props refresh mid-gesture).
  // Only clear state for entries that aren't the one currently being
  // dragged, so an in-flight drag's live override survives a same-time
  // revalidation instead of being silently wiped before endDrag reads it.
  useEffect(() => {
    const activeId = drag.current?.id;
    setOverrides((o) => (activeId && activeId in o ? { [activeId]: o[activeId] } : {}));
    setDragRowPreview((prev) => (prev && prev.id === activeId ? prev : null));
  }, [categories, milestones]);

  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<MilestoneType>>(new Set());
  const [stageFilter, setStageFilter] = useState<RoadmapStage | "all">("all");
  const [isDragging, setIsDragging] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [addMenu, setAddMenu] = useState<{ categoryId: string; top: number; left: number } | null>(null);
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

  const allMilestoneTypes = Object.keys(MILESTONE_META) as MilestoneType[];
  const allMilestonesHidden = hiddenTypes.size >= allMilestoneTypes.length;
  const toggleAllMilestones = () =>
    setHiddenTypes(allMilestonesHidden ? new Set() : new Set(allMilestoneTypes));

  const allItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);

  const today = useMemo(() => {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const zoomBand: ZoomBand =
    pxPerDay <= 5 ? "quarterly" : pxPerDay <= 8 ? "mixed" : pxPerDay <= 16 ? "monthly" : "weekly";

  // "Now" window = current quarter + next quarter (monthly headers); beyond = "Later" (quarterly). Mixed band only.
  const seam = useMemo(() => addMonths(startOfQuarter(today), 6), [today]);

  // Tracks the scrollable area's own width so the date range below can be
  // stretched to fill it — otherwise a short data range at a very zoomed-out
  // setting leaves visible dead space past the last column instead of using
  // the screen.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Lane DOM bounds, used to hit-test which lane a drag is currently
  // hovering over (for cross-lane free drag).
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const findHoveredLane = (clientY: number): string | null => {
    let hit: string | null = null;
    laneRefs.current.forEach((el, categoryId) => {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) hit = categoryId;
    });
    return hit;
  };
  // Cursor's row within a lane, absolute (not delta-accumulated) so it's
  // correct the instant a drag crosses into a differently-sized lane.
  // `otherEntryCount` = that lane's entries EXCLUDING the dragged one;
  // valid positions are [0, otherEntryCount] inclusive (otherEntryCount
  // itself means "new bottom row").
  const hoveredRow = (clientY: number, categoryId: string, otherEntryCount: number): number => {
    const el = laneRefs.current.get(categoryId);
    if (!el) return 0;
    const relY = clientY - el.getBoundingClientRect().top - ROW_TOP;
    return Math.max(0, Math.min(otherEntryCount, Math.round(relY / ROW_HEIGHT)));
  };
  // Pixel offset between two lanes' current DOM tops, purely for rendering
  // the drag preview inside a different lane's row band without ever
  // re-parenting the dragged entry's actual DOM node (see packedByLane).
  const previewTopOffset = (originCategoryId: string, hoveredCategoryId: string): number => {
    if (originCategoryId === hoveredCategoryId) return 0;
    const originEl = laneRefs.current.get(originCategoryId);
    const targetEl = laneRefs.current.get(hoveredCategoryId);
    if (!originEl || !targetEl) return 0;
    return targetEl.getBoundingClientRect().top - originEl.getBoundingClientRect().top;
  };
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Max zoom-out = 6 quarters visible at once, regardless of screen width —
  // derived from the measured container width rather than a fixed pxPerDay
  // floor, so a wider window doesn't let the loosest zoom show more than 18
  // months.
  const minPxPerDay = containerWidth > 0 ? Math.max(1, containerWidth / MAX_ZOOM_OUT_DAYS) : 2;
  useEffect(() => {
    if (containerWidth > 0) setPxPerDay((p) => Math.max(p, containerWidth / MAX_ZOOM_OUT_DAYS));
  }, [containerWidth]);

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

  const jumpToToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(today) - containerWidth / 6);
  };

  const panBy = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, el.scrollLeft + direction * containerWidth * 0.8);
  };

  const stepZoom = (direction: 1 | -1) =>
    setPxPerDay((p) => Math.max(minPxPerDay, Math.min(32, p + direction * 4)));

  // `drag` is a ref (not reactive) so it can't drive a render on its own —
  // this only works because `isDragging` (a real state flip) is what
  // triggers the re-render that reads it, at which point the ref already
  // holds the just-started drag's id.
  const dragHint = (() => {
    if (!isDragging || !drag.current) return null;
    const id = drag.current.id;
    const name = allItems.find((i) => i.id === id)?.name ?? milestones.find((m) => m.id === id)?.name;
    if (!name) return null;
    const verb = drag.current.kind === "milestone" || drag.current.kind === "item-move" ? "Moving" : "Resizing";
    return `${verb} ${name}`;
  })();

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

    if (zoomBand === "weekly") {
      // Align the first segment to the Monday on/before rangeStart so week
      // boundaries match the ISO-week convention used elsewhere in this app
      // (e.g. the Log view's week grouping), rather than raw 7-day chunks
      // from an arbitrary quarter-start.
      const d0 = new Date(cursor);
      const dow = d0.getUTCDay();
      cursor = cursor - ((dow === 0 ? 7 : dow) - 1) * DAY;
      while (cursor < rangeEnd) {
        const next = Math.min(cursor + 7 * DAY, rangeEnd);
        const d = new Date(cursor);
        segs.push({ label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, from: cursor, to: next, zone: "now" });
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
  const [, startTransition] = useTransition();

  const rowOf = (categoryId: string, id: string): number =>
    packedByLane.get(categoryId)?.packed.find((p) => p.entry.id === id)?.row ?? 0;

  const beginMilestoneDrag = (e: React.PointerEvent, id: string, origDate: number, categoryId: string) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "milestone", id, startX: e.clientX, origDate, origCategoryId: categoryId, origRow: rowOf(categoryId, id), moved: false };
    setIsDragging(true);
  };

  const beginItemMove = (e: React.PointerEvent, id: string, origStart: number, origEnd: number, categoryId: string) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = {
      kind: "item-move",
      id,
      startX: e.clientX,
      origStart,
      origEnd,
      origCategoryId: categoryId,
      origRow: rowOf(categoryId, id),
      moved: false,
    };
    setIsDragging(true);
  };

  const beginItemResize = (
    e: React.PointerEvent,
    edge: "start" | "end",
    id: string,
    origStart: number,
    origEnd: number,
    categoryId: string
  ) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = {
      kind: edge === "start" ? "item-resize-start" : "item-resize-end",
      id,
      startX: e.clientX,
      origStart,
      origEnd,
      origCategoryId: categoryId,
      moved: false,
    };
    setIsDragging(true);
  };

  // Shared by onDragMove (live preview) and endDrag (commit) so both agree
  // on exactly the same hovered lane/row and desired date range.
  const resolveDropTarget = (e: React.PointerEvent, d: Extract<DragState, { kind: "milestone" | "item-move" }>) => {
    const hoveredCategoryId = findHoveredLane(e.clientY) ?? d.origCategoryId;
    const restPacked = simulateLanePacking(laneEntriesExcluding(hoveredCategoryId, d.id)).packed;
    const targetRow = hoveredRow(e.clientY, hoveredCategoryId, restPacked.length);
    const deltaDays = snapDays(Math.round((e.clientX - d.startX) / pxPerDay));
    const desired =
      d.kind === "milestone"
        ? (() => {
            const date = d.origDate + deltaDays * DAY;
            const w = measureMilestoneWidth(milestones.find((m) => m.id === d.id)?.name ?? "");
            return { start: date, end: date + (w / pxPerDay) * DAY };
          })()
        : { start: d.origStart + deltaDays * DAY, end: d.origEnd + deltaDays * DAY };
    return { hoveredCategoryId, restPacked, targetRow, desired, deltaDays };
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;

    if (d.kind === "milestone" || d.kind === "item-move") {
      const { hoveredCategoryId, restPacked, targetRow, desired, deltaDays } = resolveDropTarget(e, d);
      const rowOrLaneChanged = hoveredCategoryId !== d.origCategoryId || targetRow !== d.origRow;
      // Only run conflict-avoidance date-shifting when the user has shown
      // deliberate row/lane intent — a plain horizontal drag that happens
      // to overlap its current row-mate keeps relying on packedByLane's own
      // greedy re-pack (which opens a new row automatically), matching the
      // already-shipped behavior for that case.
      const resolved = rowOrLaneChanged ? resolveRowConflict(restPacked, targetRow, desired) : desired;
      setOverrides((o) => ({ ...o, [d.id]: { start: resolved.start, end: d.kind === "milestone" ? resolved.start : resolved.end } }));
      if (rowOrLaneChanged) {
        setDragRowPreview((prev) =>
          prev && prev.id === d.id && prev.categoryId === hoveredCategoryId && prev.row === targetRow
            ? prev
            : { id: d.id, categoryId: hoveredCategoryId, row: targetRow }
        );
      } else if (dragRowPreview?.id === d.id) {
        setDragRowPreview(null);
      }
      if (deltaDays !== 0 || rowOrLaneChanged) d.moved = true;
      return;
    }
    if (d.kind === "item-resize-start") {
      const deltaDays = snapDays(Math.round((e.clientX - d.startX) / pxPerDay));
      if (deltaDays !== 0) d.moved = true;
      const newStart = Math.min(d.origStart + deltaDays * DAY, d.origEnd - DAY);
      setOverrides((o) => ({ ...o, [d.id]: { start: newStart, end: d.origEnd } }));
      return;
    }
    if (d.kind === "item-resize-end") {
      const deltaDays = snapDays(Math.round((e.clientX - d.startX) / pxPerDay));
      if (deltaDays !== 0) d.moved = true;
      const newEnd = Math.max(d.origEnd + deltaDays * DAY, d.origStart + DAY);
      setOverrides((o) => ({ ...o, [d.id]: { start: d.origStart, end: newEnd } }));
      return;
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setIsDragging(false);
    if (!d) return;

    if (d.kind === "milestone" || d.kind === "item-move") {
      const { hoveredCategoryId, restPacked, targetRow, desired, deltaDays } = resolveDropTarget(e, d);
      const rowOrLaneChanged = hoveredCategoryId !== d.origCategoryId || targetRow !== d.origRow;
      if (!d.moved || (deltaDays === 0 && !rowOrLaneChanged)) {
        setOverrides((o) => {
          const { [d.id]: _, ...rest } = o;
          return rest;
        });
        if (dragRowPreview?.id === d.id) setDragRowPreview(null);
        if (d.kind === "milestone") setPanel({ kind: "milestone", id: d.id });
        else setPanel({ kind: "item", id: d.id });
        return;
      }

      if (rowOrLaneChanged) {
        // Deliberate row/lane placement — commit via the full-lane renumber
        // transaction, inserting the dragged entry right after the last
        // rest-of-lane entry whose own row is <= the target (see plan's
        // accepted limitation: this can occasionally land one row earlier
        // than the literal drop pixel if an earlier gap independently fits,
        // never later, and never corrupts anyone else's placement).
        const resolved = resolveRowConflict(restPacked, targetRow, desired);
        let insertAfter = -1;
        restPacked.forEach((p, i) => {
          if (p.row <= targetRow) insertAfter = i;
        });
        const ordered = restPacked.map((p) => ({ id: p.entry.id, kind: p.kind }));
        ordered.splice(insertAfter + 1, 0, { id: d.id, kind: d.kind === "milestone" ? "milestone" : "item" });
        startTransition(async () => {
          try {
            await commitLaneDrop({
              categoryId: hoveredCategoryId,
              orderedEntries: ordered,
              draggedId: d.id,
              categoryChanged: hoveredCategoryId !== d.origCategoryId,
              ...(d.kind === "milestone"
                ? { milestoneDate: iso(resolved.start) }
                : { itemDates: { startDate: iso(resolved.start), endDate: iso(resolved.end) } }),
            });
          } catch {
            setOverrides((o) => {
              const { [d.id]: _, ...rest } = o;
              return rest;
            });
            setDragRowPreview(null);
          }
        });
        return;
      }

      // Pure horizontal drag — unchanged simple path, no row/lane commit.
      startTransition(async () => {
        try {
          if (d.kind === "milestone") {
            await updateMilestone(d.id, { date: iso(desired.start) });
          } else {
            await updateItem(d.id, { startDate: iso(desired.start), endDate: iso(desired.end) });
          }
        } catch {
          setOverrides((o) => {
            const { [d.id]: _, ...rest } = o;
            return rest;
          });
        }
      });
      return;
    }

    if (d.kind === "item-resize-start" || d.kind === "item-resize-end") {
      const deltaDays = snapDays(Math.round((e.clientX - d.startX) / pxPerDay));
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
      if (d.kind === "item-resize-start") {
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
  };

  const itemDates = (i: ItemT) =>
    overrides[i.id] ?? { start: parse(i.startDate), end: parse(i.endDate) };
  const msDate = (m: MilestoneT) => overrides[m.id]?.start ?? parse(m.date);

  // Effective packing interval for one entry — items use their real date
  // range (+DAY to match ItemBar's own inclusive rendering); milestones are
  // a point date but reserve pixel-derived width for their icon+label so
  // they don't visually collide with neighbors.
  const entryRange = (e: LaneEntry): { start: number; end: number } => {
    if (e.kind === "item") {
      const d = itemDates(e.entry);
      return { start: d.start, end: d.end + DAY };
    }
    const date = msDate(e.entry);
    const w = measureMilestoneWidth(e.entry.name);
    return { start: date, end: date + (w / pxPerDay) * DAY };
  };

  // Greedy interval packing, sorted by manual sortOrder (drag-controlled)
  // first, date only as a tiebreaker — so a user can influence which row an
  // entry lands in, while the row-fit check (not the sort) is what actually
  // guarantees no two overlapping entries ever share a row. Shared by the
  // live packedByLane below and the drop-time conflict simulation.
  const simulateLanePacking = (entries: LaneEntry[]): { packed: (LaneEntry & { row: number })[]; rowCount: number } => {
    const withRange = entries.map((e) => ({ e, ...entryRange(e) }));
    withRange.sort((a, b) => a.e.sortOrder - b.e.sortOrder || a.start - b.start || a.e.entry.id.localeCompare(b.e.entry.id));
    const rowEnds: number[] = [];
    const packed: (LaneEntry & { row: number })[] = [];
    for (const { e, start, end } of withRange) {
      let row = rowEnds.findIndex((endT) => endT + HALF_DAY <= start);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(end);
      } else {
        rowEnds[row] = end;
      }
      packed.push({ ...e, row });
    }
    return { packed, rowCount: rowEnds.length };
  };

  // A lane's entries excluding one (the entry currently being dragged), for
  // simulating "where would everyone ELSE land" during a drag.
  const laneEntriesExcluding = (categoryId: string, excludeId: string): LaneEntry[] => {
    const out: LaneEntry[] = [];
    for (const i of allItems) {
      if (stageFilter !== "all" && i.stage !== stageFilter) continue;
      if (i.id !== excludeId && i.categoryId === categoryId) out.push({ kind: "item", sortOrder: i.sortOrder, entry: i });
    }
    for (const m of milestones) {
      if (hiddenTypes.has(m.type) || m.id === excludeId || m.categoryId !== categoryId) continue;
      out.push({ kind: "milestone", sortOrder: m.sortOrder, entry: m });
    }
    return out;
  };

  const rangesOverlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    !(a.end + HALF_DAY <= b.start || b.end + HALF_DAY <= a.start);

  // Manually dropping an entry into a specific row can conflict with a
  // date-overlapping neighbor already there. Rather than reject the drop or
  // allow the overlap, shift the DRAGGED entry's own dates (preserving its
  // duration) by the minimum amount needed to clear it, in the direction
  // implied by where it was dropped relative to the conflicting neighbor.
  // Rowmates are pairwise non-overlapping (packing invariant) and sortable
  // along the timeline, so one monotonic sweep in that direction resolves
  // any cascade — bounded by the row's size, always terminates.
  const resolveRowConflict = (
    restPacked: (LaneEntry & { row: number })[],
    targetRow: number,
    desired: { start: number; end: number }
  ): { start: number; end: number } => {
    const duration = desired.end - desired.start;
    const mates = restPacked.filter((m) => m.row === targetRow).map((m) => entryRange(m));
    const firstConflict = mates.find((m) => rangesOverlap(desired, m));
    if (!firstConflict) return desired;

    const draggedMid = (desired.start + desired.end) / 2;
    const mateMid = (firstConflict.start + firstConflict.end) / 2;
    const pushRight = draggedMid >= mateMid;

    let start = desired.start;
    let end = desired.end;
    const ordered = [...mates].sort((a, b) => (pushRight ? a.start - b.start : b.start - a.start));
    for (const mate of ordered) {
      if (!rangesOverlap({ start, end }, mate)) continue;
      if (pushRight) {
        start = mate.end + DAY; // mate.end is already +DAY-inclusive (entryRange), so this clears the packer's own gap rule
        end = start + duration;
      } else {
        end = mate.start - DAY;
        start = end - duration;
      }
    }
    return { start, end };
  };

  // Items and milestones share one vertical stack per lane, packed
  // compactly: entries that don't overlap in time share a row instead of
  // each getting a dedicated one. Recomputes live during a drag since
  // itemDates/msDate already merge the live `overrides` (date).
  //
  // Deliberately keyed by the entry's STORED categoryId, not any live drag
  // state: re-parenting a dragged entry's DOM node into a different lane's
  // subtree mid-gesture makes React unmount+remount it, which silently
  // drops native pointer capture and kills all further move/up events for
  // that drag. The entry stays visually in its origin lane (only its
  // rendered x/row can move, via dragRowPreview + previewTopOffset at the
  // ItemBar/MilestoneMarker call sites) until the drop commits and fresh
  // server data naturally re-parents it on the next clean render.
  const packedByLane = useMemo(() => {
    const byCategory = new Map<string, LaneEntry[]>();
    const push = (cid: string, e: LaneEntry) => {
      const list = byCategory.get(cid) ?? [];
      list.push(e);
      byCategory.set(cid, list);
    };
    for (const i of allItems) {
      if (stageFilter !== "all" && i.stage !== stageFilter) continue; // filtered-out items free their row
      push(i.categoryId, { kind: "item", sortOrder: i.sortOrder, entry: i });
    }
    for (const m of milestones) {
      if (hiddenTypes.has(m.type)) continue; // hidden milestones free their row
      push(m.categoryId, { kind: "milestone", sortOrder: m.sortOrder, entry: m });
    }
    const map = new Map<string, { packed: (LaneEntry & { row: number })[]; rowCount: number }>();
    for (const c of categories) map.set(c.id, simulateLanePacking(byCategory.get(c.id) ?? []));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, milestones, overrides, pxPerDay, hiddenTypes, stageFilter]);

  const selectedItem =
    panel?.kind === "item" ? allItems.find((i) => i.id === panel.id) ?? null : null;
  const selectedMs =
    panel?.kind === "milestone" ? milestones.find((m) => m.id === panel.id) ?? null : null;

  const activeTheme = ROADMAP_THEMES[currentTheme] ?? ROADMAP_THEMES.indigo;

  type PaletteCommand = { id: string; label: string; run: () => void };
  const paletteCommands: PaletteCommand[] = [
    { id: "add-lane", label: "Add lane", run: () => setPanel({ kind: "lanes" }) },
    { id: "manage-lanes", label: "Manage lanes", run: () => setPanel({ kind: "lanes" }) },
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
  const paletteQueryLower = paletteQuery.trim().toLowerCase();
  const paletteItemResults = paletteQueryLower
    ? allItems.filter((i) => i.name.toLowerCase().includes(paletteQueryLower)).slice(0, 6)
    : [];
  const paletteMsResults = paletteQueryLower
    ? milestones.filter((m) => m.name.toLowerCase().includes(paletteQueryLower)).slice(0, 6)
    : [];
  const paletteCommandResults = paletteCommands.filter((c) => c.label.toLowerCase().includes(paletteQueryLower));
  const runPaletteCommand = (cmd: PaletteCommand) => {
    cmd.run();
    setPaletteOpen(false);
    setPaletteQuery("");
  };
  const pickPaletteItem = (id: string) => {
    setPanel({ kind: "item", id });
    setPaletteOpen(false);
    setPaletteQuery("");
  };
  const pickPaletteMilestone = (id: string) => {
    setPanel({ kind: "milestone", id });
    setPaletteOpen(false);
    setPaletteQuery("");
  };

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
        <div className="flex items-center gap-1.5">
          {(["all", ...STAGE_ORDER] as const).map((k) => {
            const on = stageFilter === k;
            return (
              <button
                key={k}
                onClick={() => setStageFilter(k)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  on ? "border-accent/30 bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text"
                }`}
              >
                {k === "all" ? "All stages" : STAGE_META[k].label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="btn-ghost text-xs text-text-muted"
          aria-label="Open command palette"
        >
          🔍 Search
          <span className="figure ml-1 rounded border border-border px-1 text-[10px] text-text-muted">⌘K</span>
        </button>
        <button
          type="button"
          onClick={toggleAllMilestones}
          className={`btn-ghost text-xs ${allMilestonesHidden ? "text-text-muted" : "text-accent"}`}
          title={allMilestonesHidden ? "Show all milestones" : "Hide all milestones"}
        >
          ◆ Milestones
        </button>
        <button className="btn-ghost" onClick={() => setPanel({ kind: "lanes" })}>
          Manage lanes
        </button>
        <button
          className="btn-ghost"
          onClick={() => setPanel({ kind: "new-milestone" })}
          disabled={categories.length === 0}
        >
          Add milestone
        </button>
        <ThemeMenu roadmapId={currentRoadmapId} currentTheme={currentTheme} />
        <button
          className="btn-primary"
          onClick={() => setPanel({ kind: "new-item" })}
          disabled={categories.length === 0}
        >
          Add item
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
              placeholder="Search items, milestones, or run a command…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (paletteItemResults[0]) pickPaletteItem(paletteItemResults[0].id);
                  else if (paletteMsResults[0]) pickPaletteMilestone(paletteMsResults[0].id);
                  else if (paletteCommandResults[0]) runPaletteCommand(paletteCommandResults[0]);
                }
              }}
            />
            <div className="max-h-96 overflow-y-auto p-1.5">
              {paletteItemResults.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Items</p>
                  {paletteItemResults.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => pickPaletteItem(i.id)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                    >
                      {i.name}
                    </button>
                  ))}
                </>
              )}
              {paletteMsResults.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Milestones
                  </p>
                  {paletteMsResults.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => pickPaletteMilestone(m.id)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                    >
                      {m.name}
                    </button>
                  ))}
                </>
              )}
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Commands</p>
              {paletteCommandResults.length === 0 && (
                <p className="px-2 py-2 text-sm text-text-muted">No matching commands.</p>
              )}
              {paletteCommandResults.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => runPaletteCommand(cmd)}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {addMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setAddMenu(null)}>
          <div
            className="animate-pop-in fixed w-44 rounded-lg border border-border bg-surface p-1 shadow-lg"
            style={{ top: addMenu.top, left: addMenu.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Add to lane</p>
            <button
              onClick={() => {
                setPanel({ kind: "new-item", categoryId: addMenu.categoryId });
                setAddMenu(null);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
            >
              Roadmap item
            </button>
            <button
              onClick={() => {
                setPanel({ kind: "new-milestone", categoryId: addMenu.categoryId });
                setAddMenu(null);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg"
            >
              Milestone
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border2 bg-bg px-3.5 py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => panBy(-1)}
                title="Pan back"
                aria-label="Pan back"
                className="btn-ghost h-7 w-7 justify-center p-0 text-text-muted"
              >
                ‹
              </button>
              <button type="button" onClick={jumpToToday} className="btn-ghost px-2.5 py-1 text-xs">
                Today
              </button>
              <button
                type="button"
                onClick={() => panBy(1)}
                title="Pan forward"
                aria-label="Pan forward"
                className="btn-ghost h-7 w-7 justify-center p-0 text-text-muted"
              >
                ›
              </button>
            </div>
            <div className="flex items-center gap-2">
              {dragHint && (
                <span className="figure rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                  {dragHint}
                </span>
              )}
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                disabled={pxPerDay <= minPxPerDay}
                title="Zoom out"
                aria-label="Zoom out"
                className="btn-ghost h-7 w-7 justify-center p-0 text-text-muted disabled:opacity-40"
              >
                −
              </button>
              <span className="figure w-16 text-center text-[10px] uppercase tracking-wide text-text-muted">
                {zoomBand}
              </span>
              <button
                type="button"
                onClick={() => stepZoom(1)}
                disabled={pxPerDay >= 32}
                title="Zoom in"
                aria-label="Zoom in"
                className="btn-ghost h-7 w-7 justify-center p-0 text-text-muted disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="roadmap-content animate-view-in overflow-auto"
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
              <span
                className="on-accent figure absolute -top-1 z-20 -translate-x-1/2 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ left: x(today) }}
              >
                Today
              </span>
            </div>
          </div>

          {/* Category swimlanes — items and milestones share one stack, packed compactly by date */}
          {categories.map((c, laneIdx) => {
            const { packed, rowCount } = packedByLane.get(c.id) ?? { packed: [], rowCount: 0 };
            // Lanes clip their own content by default so items can never visually
            // bleed into a neighboring lane (there's no `height` cap otherwise —
            // only `minHeight` — so anything positioned past a lane's own row
            // count would paint straight into the lane below/above it). The one
            // exception: while this lane's own item is being drag-previewed into
            // a *different* lane, `top` is deliberately computed outside this
            // box (see previewTopOffset above) so the preview can show in the
            // target lane's row without re-parenting the dragged DOM node —
            // clipping would hide that preview, so overflow opens up just then.
            const previewingIntoAnotherLane =
              isDragging &&
              !!dragRowPreview &&
              dragRowPreview.categoryId !== c.id &&
              packed.some((entry) => entry.entry.id === dragRowPreview.id);
            return (
              <div
                key={c.id}
                ref={(el) => {
                  if (el) laneRefs.current.set(c.id, el);
                  else laneRefs.current.delete(c.id);
                }}
                className={`flex border-b border-border/70 ${
                  laneIdx < categories.length - 1 ? "mb-3" : ""
                }`}
              >
                <LaneLabelCell
                  category={c}
                  minHeight={Math.max(64, rowCount * 38 + 22)}
                  hidden={hiddenCategories.has(c.id)}
                  onlyOne={categories.length === 1}
                  isFirst={laneIdx === 0}
                  isLast={laneIdx === categories.length - 1}
                  ring={isDragging && dragRowPreview?.categoryId === c.id}
                  onToggleVisibility={() => toggleCategory(c.id)}
                  onAddMenu={(r) => setAddMenu({ categoryId: c.id, top: r.bottom + 6, left: r.left })}
                />
                <div
                  className={`relative ${hiddenCategories.has(c.id) ? "opacity-25 pointer-events-none" : ""}`}
                  style={{
                    width,
                    minHeight: Math.max(56, rowCount * 38 + 22),
                    overflow: previewingIntoAnotherLane ? "visible" : "hidden",
                  }}
                >
                  <GridLines segments={headerSegments} x={x} />
                  {zoomBand === "mixed" && (
                    <div
                      className="absolute inset-y-0 border-l-2 border-dashed border-warning/60"
                      style={{ left: x(seam) }}
                    />
                  )}
                  <TodayLine x={x(today)} />
                  {packed.map((entry) => {
                    const top =
                      dragRowPreview?.id === entry.entry.id
                        ? ROW_TOP + dragRowPreview.row * ROW_HEIGHT + previewTopOffset(entry.entry.categoryId, dragRowPreview.categoryId)
                        : ROW_TOP + entry.row * ROW_HEIGHT;
                    return entry.kind === "item" ? (
                      <ItemBar
                        key={entry.entry.id}
                        item={entry.entry}
                        row={entry.row}
                        top={top}
                        color={c.color}
                        d={itemDates(entry.entry)}
                        x={x}
                        isDragging={isDragging}
                        onBeginMove={beginItemMove}
                        onBeginResize={beginItemResize}
                        onDragMove={onDragMove}
                        onEndDrag={endDrag}
                      />
                    ) : (
                      <MilestoneMarker
                        key={entry.entry.id}
                        milestone={entry.entry}
                        top={top}
                        date={msDate(entry.entry)}
                        x={x}
                        hidden={hiddenTypes.has(entry.entry.type)}
                        isDragging={isDragging}
                        onBeginDrag={beginMilestoneDrag}
                        onDragMove={onDragMove}
                        onEndDrag={endDrag}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {categories.length === 0 && (
            <div className="p-10 text-center text-sm text-text-muted">
              No lanes yet. Open Manage lanes to create your first category.
            </div>
          )}
        </div>
          </div>
        </div>

        <MilestoneListCard
          categories={categories}
          milestones={milestones}
          onSelect={(id) => setPanel({ kind: "milestone", id })}
        />
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
        <span className="h-3 w-px bg-border" aria-hidden />
        {STAGE_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${STAGE_META[s].dot}`} />
            {STAGE_META[s].label}
            <span className="figure text-text">{allItems.filter((i) => i.stage === s).length}</span>
          </span>
        ))}
        <span className="ml-auto">Drag a bar or marker to reschedule · click a lane to dim it · click to open details</span>
      </footer>

      {panel?.kind === "lanes" && (
        <PanelFrame title="Manage lanes" onClose={() => setPanel(null)}>
          <LaneManager categories={categories} roadmapId={currentRoadmapId} />
        </PanelFrame>
      )}
      {panel?.kind === "new-item" && (
        <PanelFrame title="Add roadmap item" onClose={() => setPanel(null)}>
          <ItemForm categories={categories} defaultCategoryId={panel.categoryId} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
      {selectedItem && (
        <PanelFrame key={selectedItem.id} title="Roadmap item" onClose={() => setPanel(null)}>
          <ItemForm categories={categories} item={selectedItem} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
      {panel?.kind === "new-milestone" && (
        <PanelFrame title="Add milestone" onClose={() => setPanel(null)}>
          <MilestoneForm
            categories={categories}
            defaultCategoryId={panel.categoryId}
            roadmapId={currentRoadmapId}
            onDone={() => setPanel(null)}
          />
        </PanelFrame>
      )}
      {selectedMs && (
        <PanelFrame key={selectedMs.id} title="Milestone" onClose={() => setPanel(null)}>
          <MilestoneForm categories={categories} milestone={selectedMs} roadmapId={currentRoadmapId} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
    </div>
  );
}

function ItemBar({
  item,
  row,
  top,
  color,
  d,
  x,
  isDragging,
  onBeginMove,
  onBeginResize,
  onDragMove,
  onEndDrag,
}: {
  item: ItemT;
  row: number;
  top: number;
  color: string;
  d: { start: number; end: number };
  x: (t: number) => number;
  isDragging: boolean;
  onBeginMove: (e: React.PointerEvent, id: string, origStart: number, origEnd: number, categoryId: string) => void;
  onBeginResize: (
    e: React.PointerEvent,
    edge: "start" | "end",
    id: string,
    origStart: number,
    origEnd: number,
    categoryId: string
  ) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onEndDrag: (e: React.PointerEvent) => void;
}) {
  const hover = useHoverCard(isDragging);
  const left = x(d.start);
  const w = Math.max(x(d.end + DAY) - left, 44);

  return (
    <div
      className="group absolute"
      style={{ left, width: w, top }}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <button
        className={`absolute top-0 z-10 h-[22px] w-full cursor-grab touch-none overflow-hidden rounded-md text-left text-[11px] font-medium text-white shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${
          item.stage === "EXPLORING" ? "border border-dashed border-white/60 opacity-75" : ""
        }`}
        style={{ background: row % 2 === 1 ? darken(color, 0.18) : color }}
        onPointerDown={(e) => onBeginMove(e, item.id, d.start, d.end, item.categoryId)}
        onPointerMove={onDragMove}
        onPointerUp={onEndDrag}
      >
        <div
          className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize"
          onPointerDown={(e) => onBeginResize(e, "start", item.id, d.start, d.end, item.categoryId)}
          onPointerMove={onDragMove}
          onPointerUp={onEndDrag}
        />
        <span className="block truncate px-2.5">{item.name}</span>
        <div
          className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize"
          onPointerDown={(e) => onBeginResize(e, "end", item.id, d.start, d.end, item.categoryId)}
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
  top,
  date,
  x,
  hidden,
  isDragging,
  onBeginDrag,
  onDragMove,
  onEndDrag,
}: {
  milestone: MilestoneT;
  top: number;
  date: number;
  x: (t: number) => number;
  hidden: boolean;
  isDragging: boolean;
  onBeginDrag: (e: React.PointerEvent, id: string, origDate: number, categoryId: string) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onEndDrag: (e: React.PointerEvent) => void;
}) {
  const hover = useHoverCard(isDragging);
  return (
    <div
      className={`group absolute z-10 ${hidden ? "pointer-events-none opacity-20" : ""}`}
      style={{ left: x(date), top }}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <button
        className="focus-ring absolute left-0 top-0 flex h-7 cursor-grab touch-none items-center gap-1 whitespace-nowrap rounded-full px-1.5 hover:bg-surface active:cursor-grabbing"
        onPointerDown={(e) => onBeginDrag(e, milestone.id, date, milestone.categoryId)}
        onPointerMove={onDragMove}
        onPointerUp={onEndDrag}
      >
        <MilestoneIcon type={milestone.type} />
        <span className="max-w-40 truncate text-[11px] font-medium">{milestone.name}</span>
      </button>
      {hover.visible && (
        <HoverCardContent
          title={`${MILESTONE_META[milestone.type].label}: ${milestone.name}`}
          dateRange={new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
          description={milestone.description}
        />
      )}
    </div>
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
    <>
      <div className="animate-overlay-in fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <aside className="animate-drawer-in fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button aria-label="Close panel" className="btn-ghost h-8 w-8 justify-center p-0" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  );
}

function ItemForm({
  categories,
  item,
  defaultCategoryId,
  onDone,
}: {
  categories: CategoryT[];
  item?: ItemT;
  defaultCategoryId?: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    categoryId: item?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    startDate: item?.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: item?.endDate ?? new Date(Date.now() + 13 * DAY).toISOString().slice(0, 10),
    stage: item?.stage ?? ("PLANNED" as RoadmapStage),
  });
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      if (item) await updateItem(item.id, form);
      else await createItem(form);
      onDone();
    });

  const remove = () => {
    if (!item) return;
    start(async () => {
      await deleteItem(item.id);
      onDone();
    });
  };

  const makeMilestone = () => {
    if (!item) return;
    start(async () => {
      await convertItemToMilestone(item.id);
      onDone();
    });
  };

  const nudgeStart = (days: number) =>
    setForm((f) => ({
      ...f,
      startDate: new Date(parse(f.startDate) + days * DAY).toISOString().slice(0, 10),
      endDate: new Date(parse(f.endDate) + days * DAY).toISOString().slice(0, 10),
    }));
  const nudgeDuration = (days: number) =>
    setForm((f) => {
      const minEnd = parse(f.startDate) + DAY;
      return { ...f, endDate: new Date(Math.max(minEnd, parse(f.endDate) + days * DAY)).toISOString().slice(0, 10) };
    });

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
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Stage</label>
        <div className="flex gap-1.5">
          {STAGE_ORDER.map((s) => {
            const on = form.stage === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setForm({ ...form, stage: s })}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  on ? `border-transparent bg-bg ${STAGE_META[s].text}` : "border-border text-text-muted"
                }`}
              >
                {STAGE_META[s].label}
              </button>
            );
          })}
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
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Adjust</span>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeStart(-7)}>
          ◀ 1w
        </button>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeStart(7)}>
          1w ▶
        </button>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeDuration(-7)}>
          − 1w
        </button>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeDuration(7)}>
          + 1w
        </button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Description</label>
        <textarea
          className="field min-h-24"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={save} disabled={pending || !form.name.trim() || !form.categoryId}>
          {pending ? "Saving..." : item ? "Save changes" : "Add item"}
        </button>
        {item && (
          <button className="btn-ghost" onClick={makeMilestone} disabled={pending}>
            Make milestone
          </button>
        )}
        {item && <ConfirmDeleteButton onConfirm={remove} disabled={pending} />}
      </div>
    </div>
  );
}

function MilestoneForm({
  categories,
  milestone,
  roadmapId,
  defaultCategoryId,
  onDone,
}: {
  categories: CategoryT[];
  milestone?: MilestoneT;
  roadmapId: string;
  defaultCategoryId?: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    categoryId: milestone?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? "",
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
    if (!milestone) return;
    start(async () => {
      await deleteMilestone(milestone.id);
      onDone();
    });
  };

  const makeItem = () => {
    if (!milestone) return;
    start(async () => {
      await convertMilestoneToItem(milestone.id);
      onDone();
    });
  };

  const nudgeDate = (days: number) =>
    setForm((f) => ({ ...f, date: new Date(parse(f.date) + days * DAY).toISOString().slice(0, 10) }));

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
        <MilestoneIcon type={form.type} /> Shown as this marker in its lane.
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Adjust</span>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeDate(-7)}>
          ◀ 1w
        </button>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeDate(-1)}>
          ◀ 1d
        </button>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeDate(1)}>
          1d ▶
        </button>
        <button type="button" className="figure rounded-md border border-border px-2 py-1 text-[11px]" onClick={() => nudgeDate(7)}>
          1w ▶
        </button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">Description</label>
        <textarea
          className="field min-h-24"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={save} disabled={pending || !form.name.trim() || !form.categoryId}>
          {pending ? "Saving..." : milestone ? "Save changes" : "Add milestone"}
        </button>
        {milestone && (
          <button className="btn-ghost" onClick={makeItem} disabled={pending}>
            Make item
          </button>
        )}
        {milestone && <ConfirmDeleteButton onConfirm={remove} disabled={pending} />}
      </div>
    </div>
  );
}

function LaneLabelCell({
  category,
  minHeight,
  hidden,
  onlyOne,
  isFirst,
  isLast,
  ring,
  onToggleVisibility,
  onAddMenu,
}: {
  category: CategoryT;
  minHeight: number;
  hidden: boolean;
  onlyOne: boolean;
  isFirst: boolean;
  isLast: boolean;
  ring: boolean;
  onToggleVisibility: () => void;
  onAddMenu: (rect: DOMRect) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [, start] = useTransition();

  const commitRename = () => {
    setRenaming(false);
    if (name.trim() && name !== category.name) start(() => updateCategory(category.id, { name: name.trim() }));
    else setName(category.name);
  };

  return (
    <div
      className={`sticky left-0 z-20 flex w-44 shrink-0 flex-col justify-center gap-1 border-r border-border px-3 py-2 hover:brightness-110 ${
        hidden ? "opacity-50" : ""
      } ${ring ? "ring-2 ring-inset ring-white" : ""}`}
      style={{ minHeight, background: category.color }}
    >
      <div className="flex items-center gap-1">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(category.name);
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-white/50 bg-black/20 px-1 py-0.5 text-sm font-medium text-white outline-none"
          />
        ) : (
          <button
            onClick={onToggleVisibility}
            title={hidden ? "Click to show this lane" : "Click to hide this lane"}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-white"
          >
            <span className={hidden ? "line-through" : ""}>{category.name}</span>
          </button>
        )}
        <button
          aria-label={`Rename ${category.name}`}
          title="Rename lane"
          onClick={() => setRenaming(true)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] text-white/70 hover:bg-white/20"
        >
          ✎
        </button>
        <button
          aria-label={`Add to ${category.name}`}
          title="Add item or milestone to this lane"
          onClick={(e) => onAddMenu(e.currentTarget.getBoundingClientRect())}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-white/80 hover:bg-white/20"
        >
          +
        </button>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          aria-label="Move lane up"
          title="Move lane up"
          disabled={isFirst}
          onClick={() => start(() => moveCategory(category.id, "up"))}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] text-white/70 hover:bg-white/20 disabled:opacity-30"
        >
          ▲
        </button>
        <button
          aria-label="Move lane down"
          title="Move lane down"
          disabled={isLast}
          onClick={() => start(() => moveCategory(category.id, "down"))}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] text-white/70 hover:bg-white/20 disabled:opacity-30"
        >
          ▼
        </button>
        <ConfirmDeleteButton
          variant="icon"
          label="✕"
          disabled={onlyOne}
          title={onlyOne ? "At least one lane must exist" : "Remove lane and its items"}
          ariaLabel={`Remove ${category.name}`}
          onConfirm={() => start(() => deleteCategory(category.id))}
        />
      </div>
    </div>
  );
}

function MilestoneListCard({
  categories,
  milestones,
  onSelect,
}: {
  categories: CategoryT[];
  milestones: MilestoneT[];
  onSelect: (id: string) => void;
}) {
  const laneById = new Map(categories.map((c) => [c.id, c]));
  const rollup = (Object.keys(MILESTONE_META) as MilestoneType[])
    .map((t) => ({ type: t, count: milestones.filter((m) => m.type === t).length }))
    .filter((r) => r.count > 0);
  const sorted = [...milestones].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border2 px-4 py-3">
        <span className="text-sm font-semibold">Milestones</span>
        <div className="flex flex-wrap items-center gap-3">
          {rollup.map((r) => (
            <span key={r.type} className="flex items-center gap-1.5 text-xs text-text-muted">
              <MilestoneIcon type={r.type} size={11} />
              {MILESTONE_META[r.type].label}
              <span className="figure text-text">{r.count}</span>
            </span>
          ))}
        </div>
      </div>
      {sorted.length === 0 && <p className="px-4 py-3 text-sm text-text-muted">No milestones yet.</p>}
      {sorted.map((m) => {
        const lane = laneById.get(m.categoryId);
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            className="flex w-full items-center gap-3 border-b border-border2 px-4 py-2.5 text-left last:border-b-0 hover:bg-bg"
          >
            <MilestoneIcon type={m.type} size={13} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
            {lane && (
              <span className="flex flex-none items-center gap-1.5 text-xs text-text-muted">
                <span className="h-1.5 w-1.5 rounded-sm" style={{ background: lane.color }} />
                {lane.name}
              </span>
            )}
            <span className="figure flex-none text-xs text-text-muted">{fmtLong(m.date)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThemeMenu({ roadmapId, currentTheme }: { roadmapId: string; currentTheme: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useClosePopover(open, () => setOpen(false), ref);

  const active = ROADMAP_THEMES[currentTheme] ?? ROADMAP_THEMES.indigo;

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}>
        <span className="h-3 w-3 rounded-full" style={{ background: active.accent }} />
        Theme <span className="text-text-muted">▾</span>
      </button>
      {open && (
        <div className="animate-pop-in absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-border bg-surface p-3 shadow-lg">
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
      )}
    </div>
  );
}

function LaneManager({
  categories,
  roadmapId,
}: {
  categories: CategoryT[];
  roadmapId: string;
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
      <ConfirmDeleteButton
        label="✕"
        variant="icon"
        disabled={onlyOne || pending}
        title={onlyOne ? "At least one lane must exist" : "Delete lane and its items"}
        onConfirm={() => {
          setError("");
          start(async () => {
            try {
              await deleteCategory(category.id);
            } catch {
              setError("At least one lane must exist.");
            }
          });
        }}
      />
    </div>
  );
}
