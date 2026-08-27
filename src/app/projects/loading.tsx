import { SkeletonBlock, SkeletonShell } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <div className="mb-6 flex items-center justify-between">
        <SkeletonBlock className="h-7 w-32" />
        <SkeletonBlock className="h-9 w-28 rounded-lg" />
      </div>
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonBlock key={i} className="h-10 w-full" />
        ))}
      </div>
    </SkeletonShell>
  );
}
