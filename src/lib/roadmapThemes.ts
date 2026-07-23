export type RoadmapTheme = {
  label: string;
  bgTint: string;
  accent: string;
  laneColors: string[];
};

export const ROADMAP_THEMES: Record<string, RoadmapTheme> = {
  indigo: { label: "Indigo", bgTint: "#EEF2FF", accent: "#4F46E5", laneColors: ["#4F46E5", "#7C3AED", "#2563EB", "#0EA5E9", "#0891B2", "#059669"] },
  sunset: { label: "Sunset", bgTint: "#FFF7ED", accent: "#EA580C", laneColors: ["#EA580C", "#DC2626", "#D97706", "#DB2777", "#C026D3", "#9333EA"] },
  forest: { label: "Forest", bgTint: "#F0FDF4", accent: "#16A34A", laneColors: ["#16A34A", "#059669", "#0D9488", "#65A30D", "#4D7C0F", "#166534"] },
  ocean: { label: "Ocean", bgTint: "#F0F9FF", accent: "#0284C7", laneColors: ["#0284C7", "#0369A1", "#0891B2", "#0E7490", "#155E75", "#164E63"] },
  berry: { label: "Berry", bgTint: "#FDF4FF", accent: "#C026D3", laneColors: ["#C026D3", "#A21CAF", "#DB2777", "#BE185D", "#9D174D", "#831843"] },
  slate: { label: "Slate", bgTint: "#F8FAFC", accent: "#475569", laneColors: ["#475569", "#334155", "#64748B", "#0F172A", "#1E293B", "#94A3B8"] },
  amber: { label: "Amber", bgTint: "#FFFBEB", accent: "#D97706", laneColors: ["#D97706", "#B45309", "#92400E", "#CA8A04", "#A16207", "#854D0E"] },
  rose: { label: "Rose", bgTint: "#FFF1F2", accent: "#E11D48", laneColors: ["#E11D48", "#BE123C", "#9F1239", "#F43F5E", "#FB7185", "#881337"] },
  teal: { label: "Teal", bgTint: "#F0FDFA", accent: "#0D9488", laneColors: ["#0D9488", "#0F766E", "#115E59", "#14B8A6", "#2DD4BF", "#134E4A"] },
  mono: { label: "Mono", bgTint: "#FAFAFA", accent: "#18181B", laneColors: ["#18181B", "#3F3F46", "#52525B", "#71717A", "#A1A1AA", "#D4D4D8"] },
};
