"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { logout } from "@/lib/actions";
import { useClosePopover } from "@/components/ui";
import { ownerColor, ownerInitials } from "@/lib/avatar";
import {
  DENSITY_EVENT,
  KPIS_EVENT,
  ALERTS_EVENT,
  SNAP_WEEKS_EVENT,
  getDensity,
  setDensity,
  getShowKpis,
  setShowKpis,
  getAlertsOn,
  setAlertsOn,
  getSnapWeeks,
  setSnapWeeks,
  type Density,
} from "@/lib/uiPrefs";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            value === o.value ? "on-accent bg-accent" : "text-text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-sm text-text"
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-border"}`}>
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", INTERNAL: "Internal" };

export default function PreferencesMenu({
  userName,
  role,
  collapsed,
}: {
  userName: string;
  role?: string;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [density, setDensityState] = useState<Density>("comfortable");
  const [showKpis, setShowKpisState] = useState(true);
  const [alertsOn, setAlertsOnState] = useState(true);
  const [snapWeeks, setSnapWeeksState] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  useClosePopover(open, () => setOpen(false), popoverRef);

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setDensityState(getDensity());
    setShowKpisState(getShowKpis());
    setAlertsOnState(getAlertsOn());
    setSnapWeeksState(getSnapWeeks());
    const onDensity = (e: Event) => setDensityState((e as CustomEvent<Density>).detail);
    const onKpis = (e: Event) => setShowKpisState((e as CustomEvent<boolean>).detail);
    const onAlerts = (e: Event) => setAlertsOnState((e as CustomEvent<boolean>).detail);
    const onSnap = (e: Event) => setSnapWeeksState((e as CustomEvent<boolean>).detail);
    window.addEventListener(DENSITY_EVENT, onDensity);
    window.addEventListener(KPIS_EVENT, onKpis);
    window.addEventListener(ALERTS_EVENT, onAlerts);
    window.addEventListener(SNAP_WEEKS_EVENT, onSnap);
    return () => {
      window.removeEventListener(DENSITY_EVENT, onDensity);
      window.removeEventListener(KPIS_EVENT, onKpis);
      window.removeEventListener(ALERTS_EVENT, onAlerts);
      window.removeEventListener(SNAP_WEEKS_EVENT, onSnap);
    };
  }, []);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    setOpen(true);
  };

  const setTheme = (next: "light" | "dark") => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("theme-preference", next);
  };

  return (
    <div className="border-t border-border p-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-bg"
      >
        <span
          className="figure flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ background: ownerColor(userName || "?") }}
        >
          {ownerInitials(userName || "?")}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-text">{userName}</span>
            {role && <span className="block truncate text-xs text-text-muted">{ROLE_LABEL[role] ?? role}</span>}
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="animate-pop-in fixed z-30 w-64 rounded-xl border border-border bg-surface p-3 shadow-lg"
          style={{ left: pos.left, bottom: pos.bottom }}
        >
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Interface
              </p>
              <div className="space-y-2 px-1">
                <div>
                  <p className="mb-1 text-xs text-text-muted">Appearance</p>
                  <Segmented
                    value={theme}
                    options={[
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                    onChange={setTheme}
                  />
                </div>
                <ToggleRow
                  checked={alertsOn}
                  onChange={() => {
                    const next = !alertsOn;
                    setAlertsOnState(next);
                    setAlertsOn(next);
                  }}
                  label="Change alerts"
                />
              </div>
            </div>

            <div className="border-t border-border2 pt-3">
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Project board
              </p>
              <div className="space-y-2 px-1">
                <div>
                  <p className="mb-1 text-xs text-text-muted">Row density</p>
                  <Segmented
                    value={density}
                    options={[
                      { value: "comfortable", label: "Comfortable" },
                      { value: "compact", label: "Compact" },
                    ]}
                    onChange={(v) => {
                      setDensityState(v);
                      setDensity(v);
                    }}
                  />
                </div>
                <ToggleRow
                  checked={showKpis}
                  onChange={() => {
                    const next = !showKpis;
                    setShowKpisState(next);
                    setShowKpis(next);
                  }}
                  label="KPI strip"
                />
              </div>
            </div>

            <div className="border-t border-border2 pt-3">
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Product roadmap
              </p>
              <div className="px-1">
                <ToggleRow
                  checked={snapWeeks}
                  onChange={() => {
                    const next = !snapWeeks;
                    setSnapWeeksState(next);
                    setSnapWeeks(next);
                  }}
                  label="Snap drags to weeks"
                />
              </div>
            </div>

            <div className="border-t border-border2 pt-3">
              <form action={logout}>
                <button className="btn-ghost w-full justify-center text-text-muted" type="submit">
                  Log out
                </button>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
