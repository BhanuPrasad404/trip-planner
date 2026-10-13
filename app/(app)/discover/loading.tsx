import { FeedSkeleton } from "@/components/ui/Skeleton";

// The feed's first screen, in the feed's own colours, so opening Discover feels instant.
export default function Loading() {
  return (
    <main id="main" aria-busy="true">
      <span role="status" className="sr-only">Loading Discover</span>
      <div className="h-[calc(100dvh-11.5rem)] md:h-[calc(100dvh-3rem)] md:p-4"><div className="mx-auto h-full w-full overflow-hidden bg-pine md:max-w-[440px] md:rounded-3xl"><FeedSkeleton /></div></div>
    </main>
  );
}
