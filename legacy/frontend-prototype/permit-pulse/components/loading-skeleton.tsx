import { Skeleton } from "@/components/ui/skeleton"

export function LoadingSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[26px] border border-navy-200/70 bg-white/80 p-5 shadow-sm dark:border-dark-border/70 dark:bg-dark-card/90"
          >
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="mt-4 h-7 w-3/5 rounded-xl" />
            <Skeleton className="mt-3 h-4 w-4/5 rounded-xl" />
            <Skeleton className="mt-6 h-10 w-full rounded-2xl" />
          </div>
        ))}
      </div>
      <div className="rounded-[28px] border border-navy-200/70 bg-white/80 p-6 shadow-sm dark:border-dark-border/70 dark:bg-dark-card/90">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="mt-4 h-9 w-3/4 rounded-2xl" />
        <Skeleton className="mt-3 h-4 w-full rounded-xl" />
        <Skeleton className="mt-3 h-4 w-4/5 rounded-xl" />
        <Skeleton className="mt-8 h-28 w-full rounded-[24px]" />
        <Skeleton className="mt-5 h-44 w-full rounded-[24px]" />
      </div>
    </div>
  )
}
