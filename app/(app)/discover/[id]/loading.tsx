import { Skeleton } from "@/components/ui/Skeleton";

// The post page's first screen: the picture's frame and the title lines, so opening a post feels instant.
export default function Loading() {
  return (
    <main id="main" aria-busy="true">
      <span role="status" className="sr-only">Loading the post</span>
      <div aria-hidden="true" className="mx-auto w-full max-w-[72rem] pb-6 sm:px-5 lg:px-8">
        <div className="flex items-center px-2 py-2 sm:px-0 sm:py-4"><Skeleton className="h-11 w-28 rounded-full" /></div>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-8">
          <Skeleton className="aspect-[4/5] max-h-[82dvh] w-full rounded-none sm:rounded-3xl" />
          <div className="space-y-4 px-4 pt-4 sm:px-0 lg:pt-0"><Skeleton className="h-9 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-40 rounded-full" /></div>
        </div>
      </div>
    </main>
  );
}
