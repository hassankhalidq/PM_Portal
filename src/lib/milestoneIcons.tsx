// Shared between the Roadmap board (where milestones live and are edited)
// and the Dashboard (which only shows a read-only preview of upcoming
// milestones) so both render the exact same solid colored-circle-badge +
// hand-drawn glyph per type, instead of Dashboard reinventing a weaker one.
export type MilestoneType = "RELEASE" | "LAUNCH" | "DEADLINE" | "CHECKPOINT" | "DEPRECATION";

export const MILESTONE_META: Record<MilestoneType, { label: string; color: string }> = {
  RELEASE: { label: "Release", color: "#D97706" },
  LAUNCH: { label: "Launch", color: "#16A34A" },
  DEADLINE: { label: "Deadline", color: "#DC2626" },
  CHECKPOINT: { label: "Checkpoint", color: "#2563EB" },
  DEPRECATION: { label: "Deprecation", color: "#71717A" },
};

export function MilestoneGlyph({ type }: { type: MilestoneType }) {
  switch (type) {
    case "RELEASE":
      return (
        <>
          <path
            d="M12 5.2c1.7 1.7 2.6 4 2.6 6.3 0 1.1-.3 2.3-.7 3.2l1 1-.7.7-.9-.9c-.3.4-.8.7-1.3 1v1.7h-1.2v-1.7c-.5-.3-1-.6-1.3-1l-.9.9-.7-.7 1-1c-.4-.9-.7-2.1-.7-3.2 0-2.3.9-4.6 2.6-6.3l.6-.6.6.6Z"
            fill="#fff"
          />
          <circle cx="12" cy="10.8" r="1.25" fill="currentColor" />
        </>
      );
    case "LAUNCH":
      return (
        <>
          <path d="M9.6 17V7h.9l4.6 2.1-4.6 2.1" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M9.9 7.2v9.8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        </>
      );
    case "DEADLINE":
      return (
        <>
          <path d="M12 7v5.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="15.8" r="1" fill="#fff" />
        </>
      );
    case "CHECKPOINT":
      return (
        <path d="M8.4 12.3l2.4 2.4 4.8-5.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      );
    case "DEPRECATION":
      return (
        <>
          <circle cx="12" cy="12" r="5.4" fill="none" stroke="#fff" strokeWidth="1.5" />
          <path d="M8.2 15.8 15.8 8.2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
  }
}

export function MilestoneIcon({ type, size = 16 }: { type: MilestoneType; size?: number }) {
  const c = MILESTONE_META[type].color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ filter: `drop-shadow(0 1px 2px ${c}66)`, color: c }}>
      <circle cx="12" cy="12" r="11" fill={c} />
      <MilestoneGlyph type={type} />
    </svg>
  );
}
