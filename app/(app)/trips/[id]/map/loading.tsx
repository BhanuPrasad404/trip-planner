import { MapSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main id="main" aria-busy="true" className="relative h-[calc(100dvh-14.5rem)] min-h-[30rem] w-full md:h-[calc(100dvh-10.5rem)]">
      <span role="status" className="sr-only">Loading map</span>
      <MapSkeleton />
    </main>
  );
}
