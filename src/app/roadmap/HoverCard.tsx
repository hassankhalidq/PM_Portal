"use client";

import { useEffect, useRef, useState } from "react";

export function useHoverCard(disabled: boolean) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disabled) setVisible(false);
  }, [disabled]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return {
    visible: visible && !disabled,
    onMouseEnter: () => {
      if (disabled) return;
      timer.current = setTimeout(() => setVisible(true), 200);
    },
    onMouseLeave: () => {
      if (timer.current) clearTimeout(timer.current);
      setVisible(false);
    },
  };
}

function fmtShort(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
function fmtLong(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateRange(start: string, end: string) {
  return `${fmtShort(start)} – ${fmtLong(end)}`;
}

export function HoverCardContent({
  title,
  dateRange,
  description,
}: {
  title: string;
  dateRange: string;
  description: string;
}) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-[280px] -translate-x-1/2 rounded-xl border border-border bg-surface p-3 text-left shadow-lg">
      <p className="font-semibold text-text">{title}</p>
      <p className="figure mt-0.5 text-xs text-text-muted">{dateRange}</p>
      {description && <p className="mt-1.5 line-clamp-3 text-xs text-text-muted">{description}</p>}
    </div>
  );
}
