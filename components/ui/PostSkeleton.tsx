import { Skeleton } from "./Skeleton";

/** One post, shaped like the real card (header, picture, actions, two lines), so the feed does not jump when it arrives. */
export function PostCardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden border-y border-line bg-white sm:rounded-3xl sm:border">
      <div className="flex items-center gap-3 px-3 py-3"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-2/3" /></div></div>
      <Skeleton className="aspect-[4/5] max-h-[min(78dvh,46rem)] w-full rounded-none" />
      <div className="space-y-3 p-4"><Skeleton className="h-6 w-2/5 rounded-full" /><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-11 w-36 rounded-full" /></div>
    </div>
  );
}

export function FeedSkeletonList({ count = 2 }: { count?: number }) {
  return <div className="space-y-4 sm:space-y-6">{Array.from({ length: count }, (_, i) => <PostCardSkeleton key={i} />)}</div>;
}
