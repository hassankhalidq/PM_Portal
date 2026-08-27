// Shared between Project's Table/Kanban owner avatars and Admin's member
// avatars — a deterministic name -> color mapping so the same person gets
// the same color everywhere, with no state or lookup table to maintain.
const AVATAR_PALETTE = ["#4F46E5", "#0D9488", "#DB2777", "#475569", "#0284C7", "#16A34A"];

export function ownerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ownerColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
