import { AppLoader } from "@/components/ui/AppLoader";

// Shown while a top-level page (sign-in, landing, share link) is being prepared: the road-trip opening scene.
export default function Loading() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center py-16" aria-busy="true">
      <AppLoader />
    </main>
  );
}
