// Small shared preference helpers for cross-component UI state (density,
// KPI strip visibility) that isn't worth a Context — mirrors ThemeToggle's
// direct-localStorage-plus-DOM-attribute pattern, and a same-tab CustomEvent
// keeps every mounted toggle (sidebar + page header) in sync since the
// native `storage` event only fires in *other* tabs.
export type Density = "comfortable" | "compact";

const DENSITY_KEY = "density";
const KPIS_KEY = "show-kpis";
export const DENSITY_EVENT = "density-changed";
export const KPIS_EVENT = "kpis-changed";

export function getDensity(): Density {
  if (typeof window === "undefined") return "comfortable";
  return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

export function setDensity(value: Density) {
  localStorage.setItem(DENSITY_KEY, value);
  document.documentElement.setAttribute("data-density", value);
  window.dispatchEvent(new CustomEvent<Density>(DENSITY_EVENT, { detail: value }));
}

export function getShowKpis(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(KPIS_KEY);
  return v === null ? true : v === "1";
}

export function setShowKpis(value: boolean) {
  localStorage.setItem(KPIS_KEY, value ? "1" : "0");
  window.dispatchEvent(new CustomEvent<boolean>(KPIS_EVENT, { detail: value }));
}
