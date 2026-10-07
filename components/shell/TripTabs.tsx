"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { sub: "", label: "Overview" },
  { sub: "/plan", label: "Plan" },
  { sub: "/live", label: "Live" },
  { sub: "/map", label: "Map" },
  { sub: "/explore", label: "Explore" },
  { sub: "/memories", label: "Memories" },
] as const;

/** Secondary navigation inside one trip. Scrolls sideways on small screens. */
export function TripTabs({ tripId, activeNow }: { tripId: string; activeNow: boolean }) {
  const pathname = usePathname() ?? "";
  const base = `/trips/${tripId}`;
  return (
    <nav aria-label="Trip sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map((t) => {
          const href = base + t.sub;
          const active = t.sub === "" ? pathname === base : pathname.startsWith(href);
          return (
            <li key={t.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-11 items-center gap-2 px-4 text-sm font-semibold transition-colors ${active ? "text-pine after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-teal" : "text-ink-muted hover:text-pine"}`}
              >
                {t.label}
                {t.sub === "/live" && activeNow && <span aria-label="in progress" className="h-2 w-2 animate-pulse rounded-full bg-marigold" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
