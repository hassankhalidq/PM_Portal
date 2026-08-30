"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClosePopover, useFloatingPosition } from "@/components/ui";
import { ownerColor, ownerInitials } from "@/lib/avatar";

export type ReadoutNodeT = {
  id: string;
  name: string;
  owner: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  progress: number;
  startDate: string | null;
  endDate: string | null;
  blockReason: string;
  parentId: string | null;
  updatedAt: string;
};

const STATUS_META: Record<ReadoutNodeT["status"], { label: string; color: string }> = {
  NOT_STARTED: { label: "Not started", color: "bg-text-muted" },
  IN_PROGRESS: { label: "In progress", color: "bg-info" },
  BLOCKED: { label: "Blocked", color: "bg-danger" },
  DONE: { label: "Done", color: "bg-success" },
};

type SectionKey = "kpis" | "progress" | "blocked" | "shipped" | "atRisk";
const SECTION_LABELS: Record<SectionKey, string> = {
  kpis: "KPI tiles",
  progress: "Progress by project",
  blocked: "Blocked",
  shipped: "Shipped this week",
  atRisk: "Dates at risk",
};
const SECTIONS_KEY = "readout-sections";
const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  kpis: true,
  progress: true,
  blocked: true,
  shipped: true,
  atRisk: true,
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function relativeTime(iso: string, now: Date) {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function ReadoutBoard({
  nodes,
  boardId,
  boardName,
}: {
  nodes: ReadoutNodeT[];
  boardId: string;
  boardName: string;
}) {
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeTriggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef: customizeRef, style: customizeStyle } = useFloatingPosition(customizeOpen, customizeTriggerRef);
  useClosePopover(customizeOpen, () => setCustomizeOpen(false), customizeRef);

  useEffect(() => {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return;
    try {
      setSections({ ...DEFAULT_SECTIONS, ...JSON.parse(raw) });
    } catch {
      // ignore malformed stored value, keep defaults
    }
  }, []);

  const toggleSection = (key: SectionKey) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

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

  const roots = useMemo(() => nodes.filter((n) => n.parentId === null), [nodes]);
  const blockedNodes = useMemo(() => nodes.filter((n) => n.status === "BLOCKED"), [nodes]);
  const atRiskNodes = useMemo(
    () => nodes.filter((n) => n.startDate && new Date(n.startDate) < today && n.status !== "DONE"),
    [nodes, today]
  );
  const shippedNodes = useMemo(() => {
    const cutoff = today.getTime() - 7 * 24 * 60 * 60 * 1000;
    return nodes
      .filter((n) => n.status === "DONE" && new Date(n.updatedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [nodes, today]);

  const headline =
    kpis.blocked > 0
      ? `${kpis.blocked} item${kpis.blocked === 1 ? " is" : "s are"} blocked across ${boardName || "this board"}.`
      : "Everything is moving.";
  const summary = `${kpis.onTrack} in progress, ${kpis.shipped} shipped, ${kpis.atRisk} with dates already at risk out of ${nodes.length} items.`;

  const trackFor = (n: ReadoutNodeT) => {
    if (n.status === "BLOCKED") return { label: "Blocked", color: "text-danger" };
    if (n.startDate && new Date(n.startDate) < today && n.status !== "DONE")
      return { label: "At risk", color: "text-warning" };
    if (n.progress > 0) return { label: "On track", color: "text-accent" };
    return { label: "Not started", color: "text-text-muted" };
  };

  return (
    <div className="animate-view-in flex-1 overflow-auto bg-bg">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-8 py-8">
        <div className="readout-noprint">
          <Link href={`/projects?board=${boardId}`} className="text-xs text-text-muted hover:text-text">
            ← Back to board
          </Link>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="figure text-[10px] uppercase tracking-widest text-text-muted">
              Status read-out · {boardName} · generated {fmtDate(today.toISOString().slice(0, 10))}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
            <p className="max-w-xl text-sm leading-relaxed text-text-muted">{summary}</p>
          </div>
          <div className="readout-noprint flex flex-none items-center gap-2">
            <button
              ref={customizeTriggerRef}
              type="button"
              onClick={() => setCustomizeOpen((o) => !o)}
              className="btn-ghost text-xs"
            >
              Customize
            </button>
            {customizeOpen &&
              createPortal(
                <div
                  ref={customizeRef}
                  style={customizeStyle}
                  className="animate-pop-in z-30 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
                >
                  <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Show sections
                  </p>
                  {(Object.keys(SECTION_LABELS) as SectionKey[]).map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-text hover:bg-bg"
                    >
                      <input type="checkbox" checked={sections[key]} onChange={() => toggleSection(key)} />
                      {SECTION_LABELS[key]}
                    </label>
                  ))}
                </div>,
                document.body
              )}
            <button type="button" onClick={() => window.print()} className="btn-ghost text-xs">
              Print
            </button>
          </div>
        </div>

        {sections.kpis && (
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="figure text-[10px] uppercase tracking-widest text-text-muted">On track</p>
              <p className="figure text-2xl font-medium text-info">{kpis.onTrack}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="figure text-[10px] uppercase tracking-widest text-text-muted">Blocked</p>
              <p className="figure text-2xl font-medium text-danger">{kpis.blocked}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="figure text-[10px] uppercase tracking-widest text-text-muted">Shipped</p>
              <p className="figure text-2xl font-medium text-success">{kpis.shipped}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="figure text-[10px] uppercase tracking-widest text-text-muted">Dates at risk</p>
              <p className="figure text-2xl font-medium text-warning">{kpis.atRisk}</p>
            </div>
          </div>
        )}

        {sections.progress && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="border-b border-border2 px-4 py-3 text-sm font-semibold">Progress by project</div>
            {roots.length === 0 && <p className="px-4 py-5 text-sm text-text-muted">No projects on this board.</p>}
            {roots.map((r) => {
              const track = trackFor(r);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-[1fr_120px_1fr_90px_140px] items-center gap-3 border-b border-border2 px-4 py-2.5 last:border-b-0"
                >
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[r.status].color}`} />
                    {STATUS_META[r.status].label}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <div
                        className="animate-bar-grow h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(0, Math.min(100, r.progress))}%` }}
                      />
                    </div>
                    <span className="figure w-9 text-right text-xs text-text-muted">{r.progress}%</span>
                  </div>
                  <span className={`figure text-[10px] uppercase tracking-wide ${track.color}`}>{track.label}</span>
                  <span className="figure truncate text-right text-xs text-text-muted">
                    {r.startDate ? `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}` : "No dates"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {(sections.blocked || sections.shipped) && (
          <div className="grid grid-cols-2 gap-4">
            {sections.blocked && (
              <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                <div className="flex items-center gap-2 border-b border-border2 px-4 py-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                  <span className="text-sm font-semibold">Blocked</span>
                  <span className="figure text-xs text-text-muted">{blockedNodes.length}</span>
                </div>
                {blockedNodes.length === 0 && (
                  <p className="px-4 py-5 text-sm text-text-muted">Nothing blocked.</p>
                )}
                {blockedNodes.map((b) => (
                  <div key={b.id} className="flex flex-col gap-1.5 border-b border-border2 px-4 py-2.5 last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{b.name}</span>
                      <span className="flex flex-none items-center gap-1.5">
                        {b.owner && (
                          <span
                            className="figure flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                            style={{ background: ownerColor(b.owner) }}
                          >
                            {ownerInitials(b.owner)}
                          </span>
                        )}
                        <span className="text-xs text-text-muted">{b.owner || "Unassigned"}</span>
                      </span>
                    </div>
                    <span className="text-xs leading-relaxed text-text-muted">
                      {b.blockReason || "No reason recorded"}
                    </span>
                    <span className="figure text-[10px] text-text-muted">Updated {relativeTime(b.updatedAt, today)}</span>
                  </div>
                ))}
              </div>
            )}

            {sections.shipped && (
              <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                <div className="flex items-center gap-2 border-b border-border2 px-4 py-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  <span className="text-sm font-semibold">Shipped this week</span>
                  <span className="figure text-xs text-text-muted">{shippedNodes.length}</span>
                </div>
                {shippedNodes.length === 0 && (
                  <p className="px-4 py-5 text-sm text-text-muted">Nothing shipped in the last 7 days.</p>
                )}
                {shippedNodes.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 border-b border-border2 px-4 py-2.5 last:border-b-0">
                    <span className="truncate text-sm">{s.name}</span>
                    <span className="figure flex-none text-[10px] text-text-muted">{fmtDate(s.updatedAt.slice(0, 10))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {sections.atRisk && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="border-b border-border2 px-4 py-3 text-sm font-semibold">Dates at risk</div>
            {atRiskNodes.length === 0 && <p className="px-4 py-5 text-sm text-text-muted">Nothing overdue.</p>}
            {atRiskNodes.map((n) => {
              const days = Math.floor((today.getTime() - new Date(n.startDate as string).getTime()) / (24 * 60 * 60 * 1000));
              return (
                <div
                  key={n.id}
                  className="grid grid-cols-[1fr_140px_120px] items-center gap-3 border-b border-border2 px-4 py-2.5 last:border-b-0"
                >
                  <span className="truncate text-sm font-medium">{n.name}</span>
                  <span className="text-xs text-text-muted">{n.owner || "Unassigned"}</span>
                  <span className="figure text-right text-xs text-warning">{days}d overdue</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
