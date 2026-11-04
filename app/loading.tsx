import { AppLoader } from "@/components/ui/AppLoader";

// Shown while a top-level page (sign-in, landing, share link) is being prepared: the full-yellow opening screen with the mark building itself.
export default function Loading() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center" aria-busy="true">
      <AppLoader />
    </main>
  );
}
