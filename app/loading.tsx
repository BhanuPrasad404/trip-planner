import { LoadingMark } from "@/components/ui/Spinner";

// Shown while a top-level page (sign-in, landing, share link) is being prepared.
export default function Loading() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center" aria-busy="true">
      <LoadingMark size={56} label="Loading Trailmate" />
    </main>
  );
}
