import { SkeletonBlock, SkeletonShell } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonBlock className="mb-6 h-7 w-40" />
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <SkeletonBlock key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </SkeletonShell>
  );
}
