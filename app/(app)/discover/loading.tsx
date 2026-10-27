import { FeedSkeletonList } from "@/components/ui/PostSkeleton";

// The feed's first screen, shaped like the feed, so opening Discover feels instant.
export default function Loading() {
  return (
    <main id="main" aria-busy="true">
      <span role="status" className="sr-only">Loading Discover</span>
      <div className="mx-auto w-full max-w-[34rem] pt-14 sm:px-5 sm:pt-6"><FeedSkeletonList count={2} /></div>
    </main>
  );
}
