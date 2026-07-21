"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createCategory,
  createItem,
  createMilestone,
  deleteCategory,
  deleteItem,
  deleteMilestone,
  moveCategory,
  updateCategory,
  updateItem,
  updateMilestone,
} from "@/lib/actions";

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

const DAY = 86400000;
const MILESTONE_META: Record<MilestoneType, { label: string; color: string }> = {
  RELEASE: { label: "Release", color: "#E8A13C" },
  LAUNCH: { label: "Launch", color: "#0E7A5F" },
  DEADLINE: { label: "Deadline", color: "#DC2626" },
  CHECKPOINT: { label: "Checkpoint", color: "#2563EB" },
  DEPRECATION: { label: "Deprecation", color: "#64748B" },
};
const SWATCHES = ["#0E7A5F", "#2563EB", "#7C3AED", "#DB2777", "#E8A13C", "#475569"];

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

function MilestoneIcon({ type, size = 14 }: { type: MilestoneType; size?: number }) {
  const c = MILESTONE_META[type].color;
  const s = size;
  switch (type) {
    case "RELEASE":
      return (
        <svg width={s} height={s} viewBox="0 0 14 14" aria-hidden>
          <rect x="3.5" y="3.5" width="7" height="7" transform="rotate(45 7 7)" fill={c} />
        </svg>
      );
    case "LAUNCH":
      return (
        <svg width={s} height={s} viewBox="0 0 14 14" aria-hidden>
          <path d="M4 1v12" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4 2h7l-2 2.5L11 7H4z" fill={c} />
        </svg>
      );
    case "DEADLINE":
      return (
        <svg width={s} height={s} viewBox="0 0 14 14" aria-hidden>
          <rect x="2.5" y="2.5" width="9" height="9" rx="1" fill={c} />
        </svg>
      );
    case "CHECKPOINT":
      return (
        <svg width={s} height={s} viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="7" r="4.5" fill={c} />
        </svg>
      );
    case "DEPRECATION":
      return (
        <svg width={s} height={s} viewBox="0 0 14 14" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
  }
}

type Panel =
  | { kind: "item"; id: string }
  | { kind: "milestone"; id: string }
  | { kind: "new-item" }
  | { kind: "new-milestone" }
  | { kind: "lanes" }
  | null;

export default function RoadmapBoard({
  categories,
  milestones,
}: {
  categories: CategoryT[];
  milestones: MilestoneT[];
}) {
  const [pxPerDay, setPxPerDay] = useState(4);
  const [panel, setPanel] = useState<Panel>(null);
  // Optimistic date overrides while a drag round-trips to the server.
  const [overrides, setOverrides] = useState<Record<string, { start: number; end: number }>>({});
  useEffect(() => setOverrides({}), [categories, milestones]);

  const allItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);

  const today = useMemo(() => {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // "Now" window = current quarter + next quarter (monthly headers); beyond = "Later" (quarterly).
  const seam = useMemo(() => addMonths(startOfQuarter(today), 6), [today]);

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
    return [startOfQuarter(min), addMonths(startOfQuarter(max), 3)];
  }, [allItems, milestones, today]);

  const totalDays = Math.round((rangeEnd - rangeStart) / DAY);
  const width = totalDays * pxPerDay;
  const x = (t: number) => ((t - rangeStart) / DAY) * pxPerDay;

  const headerSegments = useMemo(() => {
    const segs: { label: string; from: number; to: number; zone: "now" | "later" }[] = [];
    let cursor = rangeStart;
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
  }, [rangeStart, rangeEnd, seam]);

  // ---- drag handling ----
  const drag = useRef<{
    id: string;
    kind: "item" | "milestone";
    startX: number;
    origStart: number;
    origEnd: number;
    moved: boolean;
  } | null>(null);
  const [, startTransition] = useTransition();

  const beginDrag = (
    e: React.PointerEvent,
    kind: "item" | "milestone",
    id: string,
    origStart: number,
    origEnd: number
  ) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { id, kind, startX: e.clientX, origStart, origEnd, moved: false };
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
    if (deltaDays !== 0) d.moved = true;
    setOverrides((o) => ({
      ...o,
      [d.id]: { start: d.origStart + deltaDays * DAY, end: d.origEnd + deltaDays * DAY },
    }));
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const deltaDays = Math.round((e.clientX - d.startX) / pxPerDay);
    if (!d.moved || deltaDays === 0) {
      setOverrides((o) => {
        const { [d.id]: _, ...rest } = o;
        return rest;
      });
      setPanel({ kind: d.kind, id: d.id });
      return;
    }
    const newStart = iso(d.origStart + deltaDays * DAY);
    const newEnd = iso(d.origEnd + deltaDays * DAY);
    startTransition(async () => {
      if (d.kind === "item") await updateItem(d.id, { startDate: newStart, endDate: newEnd });
      else await updateMilestone(d.id, { date: newStart });
    });
  };

  const itemDates = (i: ItemT) =>
    overrides[i.id] ?? { start: parse(i.startDate), end: parse(i.endDate) };
  const msDate = (m: MilestoneT) => overrides[m.id]?.start ?? parse(m.date);

  const selectedItem =
    panel?.kind === "item" ? allItems.find((i) => i.id === panel.id) ?? null : null;
  const selectedMs =
    panel?.kind === "milestone" ? milestones.find((m) => m.id === panel.id) ?? null : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-4">
        <div className="mr-auto">
          <h1 className="font-display text-xl font-600">Roadmap board</h1>
          <p className="text-xs text-muted">
            {categories.length} lanes · {allItems.length} items · {milestones.length} milestones
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Zoom
          <input
            type="range"
            min={2}
            max={12}
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

      <div className="flex-1 overflow-auto">
        <div className="min-w-max">
          {/* Header rail */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
            <div className="sticky left-0 z-30 w-44 shrink-0 border-r border-line bg-surface px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
              Timeline
            </div>
            <div className="relative h-9" style={{ width }}>
              {headerSegments.map((s) => (
                <div
                  key={s.from}
                  className={`absolute top-0 flex h-full items-center border-r border-line px-2 text-xs font-medium ${
                    s.zone === "now" ? "text-ink" : "bg-canvas text-muted"
                  }`}
                  style={{ left: x(s.from), width: x(s.to) - x(s.from) }}
                >
                  {s.label}
                </div>
              ))}
              <div
                className="absolute top-0 h-full border-l-2 border-dashed border-saffron"
                style={{ left: x(seam) }}
                title="Now / Later boundary"
              />
            </div>
          </div>

          {/* Milestone lane */}
          <div className="flex border-b border-line bg-saffron-soft/40">
            <div className="sticky left-0 z-10 flex w-44 shrink-0 items-center border-r border-line bg-surface px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Milestones
              </span>
            </div>
            <div className="relative h-12" style={{ width }}>
              <TodayLine x={x(today)} />
              {milestones.map((m) => (
                <button
                  key={m.id}
                  className="focus-ring absolute top-1/2 z-10 flex -translate-y-1/2 cursor-grab touch-none items-center gap-1 rounded-md px-1 py-0.5 hover:bg-surface active:cursor-grabbing"
                  style={{ left: x(msDate(m)) - 7 }}
                  onPointerDown={(e) => beginDrag(e, "milestone", m.id, msDate(m), msDate(m))}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  title={`${MILESTONE_META[m.type].label}: ${m.name}`}
                >
                  <MilestoneIcon type={m.type} />
                  <span className="max-w-40 truncate text-[11px] font-medium">{m.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Category swimlanes */}
          {categories.map((c) => (
            <div key={c.id} className="flex border-b border-line/70">
              <div
                className="sticky left-0 z-10 flex w-44 shrink-0 items-center gap-2 border-r border-line bg-surface px-4"
                style={{ minHeight: Math.max(56, c.items.length * 34 + 22) }}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} />
                <span className="truncate text-sm font-medium">{c.name}</span>
              </div>
              <div
                className="relative"
                style={{ width, minHeight: Math.max(56, c.items.length * 34 + 22) }}
              >
                <div
                  className="absolute inset-y-0 border-l-2 border-dashed border-saffron/60"
                  style={{ left: x(seam) }}
                />
                <TodayLine x={x(today)} />
                {c.items.map((i, idx) => {
                  const d = itemDates(i);
                  const left = x(d.start);
                  const w = Math.max(x(d.end + DAY) - left, 14);
                  return (
                    <button
                      key={i.id}
                      className="focus-ring absolute z-10 flex h-6 cursor-grab touch-none items-center overflow-hidden rounded-full px-2.5 text-left text-[11px] font-medium text-white shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
                      style={{ left, width: w, top: 12 + idx * 34, background: c.color }}
                      onPointerDown={(e) => beginDrag(e, "item", i.id, d.start, d.end)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      title={i.name}
                    >
                      <span className="truncate">{i.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {categories.length === 0 && (
            <div className="p-10 text-center text-sm text-muted">
              No lanes yet. Open Manage lanes to create your first category.
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <footer className="flex flex-wrap items-center gap-4 border-t border-line bg-surface px-6 py-2 text-[11px] text-muted">
        {(Object.keys(MILESTONE_META) as MilestoneType[]).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <MilestoneIcon type={t} size={12} /> {MILESTONE_META[t].label}
          </span>
        ))}
        <span className="ml-auto">Drag a bar or marker to reschedule · click to open details</span>
      </footer>

      {panel?.kind === "lanes" && (
        <PanelFrame title="Manage lanes" onClose={() => setPanel(null)}>
          <LaneManager categories={categories} />
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
          <MilestoneForm onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
      {selectedMs && (
        <PanelFrame key={selectedMs.id} title="Milestone" onClose={() => setPanel(null)}>
          <MilestoneForm milestone={selectedMs} onDone={() => setPanel(null)} />
        </PanelFrame>
      )}
    </div>
  );
}

function TodayLine({ x }: { x: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 border-l border-primary/50"
      style={{ left: x }}
      aria-hidden
    />
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
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-panel">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-display text-base font-600">{title}</h2>
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
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Name</label>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Lane</label>
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
        <button className="btn-primary" onClick={save} disabled={pending || !form.name.trim() || !form.categoryId}>
          {pending ? "Saving..." : item ? "Save changes" : "Add item"}
        </button>
        {item && (
          <button className="btn-ghost text-red-600" onClick={remove} disabled={pending}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function MilestoneForm({ milestone, onDone }: { milestone?: MilestoneT; onDone: () => void }) {
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
      else await createMilestone(form);
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
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Name</label>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Type</label>
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
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Date</label>
          <input
            type="date"
            className="field"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
        <MilestoneIcon type={form.type} /> Shown on the milestone lane as this marker.
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
        <button className="btn-primary" onClick={save} disabled={pending || !form.name.trim()}>
          {pending ? "Saving..." : milestone ? "Save changes" : "Add milestone"}
        </button>
        {milestone && (
          <button className="btn-ghost text-red-600" onClick={remove} disabled={pending}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function LaneManager({ categories }: { categories: CategoryT[] }) {
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="border-t border-line pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">New lane</h3>
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
                className={`focus-ring h-7 w-7 rounded-md ${color === s ? "ring-2 ring-ink ring-offset-1" : ""}`}
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
                await createCategory(name, color);
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
    <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
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
        className="btn-ghost h-7 w-7 justify-center p-0 text-red-600"
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
