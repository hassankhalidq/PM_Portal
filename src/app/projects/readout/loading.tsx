import { SkeletonBlock, SkeletonShell } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6">
        <SkeletonBlock className="h-8 w-96" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <SkeletonBlock className="h-48 rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <SkeletonBlock key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}
