"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Logo } from "../Logo";
import { IconChevron, IconMenu } from "./icons";
import { buildNav, currentTrip, type NavTrip } from "./nav";

// Remember whether the sidebar is collapsed, without a hydration mismatch.
const KEY = "trailmate.sidebar.collapsed";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
const read = () => {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
};
const write = (v: boolean) => {
  try { window.localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode: just don't remember */ }
  listeners.forEach((l) => l());
};

type Props = { trips: NavTrip[]; userInitial: string; signOutAction: () => Promise<void> };

export function AppNav({ trips, userInitial, signOutAction }: Props) {
  const pathname = usePathname() ?? "/";
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const [drawer, setDrawer] = useState(false);
  const items = buildNav(pathname, trips);
  const trip = currentTrip(pathname, trips);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const link = (it: (typeof items)[number], compact: boolean, onClick?: () => void) => {
    const active = it.match(pathname);
    return (
      <li key={it.id}>
        <Link
          href={it.href}
          onClick={onClick}
          aria-current={active ? "page" : undefined}
          title={compact ? it.label : undefined}
          className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
            active ? "bg-white text-pine shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
          } ${compact ? "justify-center" : ""}`}
        >
          <it.Icon className={active ? "text-teal" : ""} />
          <span className={compact ? "sr-only" : ""}>{it.label}</span>
          {it.id === "live" && trip?.state === "active" && (
            <span className={`ml-auto h-2 w-2 shrink-0 animate-pulse rounded-full bg-marigold ${compact ? "absolute -mt-4 ml-4" : ""}`} aria-label="Trip in progress" />
          )}
        </Link>
      </li>
    );
  };

  const primaryMobile = items.filter((i) => ["discover", "trips", "live", "map"].includes(i.id));

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside
        aria-label="Main navigation"
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-pine text-white transition-[width] duration-200 md:flex ${collapsed ? "w-[4.5rem]" : "w-60"}`}
      >
        <div className={`flex h-16 items-center ${collapsed ? "justify-center" : "px-4"}`}>
          <Link href="/dashboard" aria-label="Trailmate dashboard" className="rounded-lg">{collapsed ? <span className="font-display text-2xl font-semibold">T</span> : <Logo />}</Link>
        </div>
        {!collapsed && trip && (
          <p className="mx-3 mb-2 truncate rounded-lg bg-white/10 px-3 py-2 text-xs text-white/80" title={trip.name}>
            <span className="block font-mono uppercase tracking-widest text-white/60">Current trip</span>
            <span className="font-semibold text-white">{trip.name}</span>
          </p>
        )}
        <nav className="flex-1 overflow-y-auto px-3 py-2"><ul className="space-y-1">{items.map((i) => link(i, collapsed))}</ul></nav>
        <div className={`flex items-center gap-2 border-t border-white/10 p-3 ${collapsed ? "flex-col" : "justify-between"}`}>
          <Link href="/profile" className="flex items-center gap-2 rounded-lg" aria-label="Your profile">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-teal text-sm font-bold">{userInitial}</span>
          </Link>
          <button
            type="button"
            onClick={() => write(!collapsed)}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10"
          >
            <IconChevron className={collapsed ? "" : "rotate-180"} />
          </button>
        </div>
      </aside>

      {/* Phone: slim top bar + bottom navigation */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-pine px-4 text-white md:hidden">
        <Link href="/dashboard" aria-label="Trailmate dashboard"><Logo /></Link>
        <Link href="/profile" aria-label="Your profile" className="flex h-8 w-8 items-center justify-center rounded-full bg-teal text-sm font-bold">{userInitial}</Link>
      </header>
      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-pine pb-[env(safe-area-inset-bottom)] text-white md:hidden">
        <ul className="grid grid-cols-5">
          {primaryMobile.map((it) => {
            const active = it.match(pathname);
            return (
              <li key={it.id}>
                <Link href={it.href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-marigold" : "text-white/75"}`}>
                  <it.Icon />{it.label.replace("My trips", "Trips").replace("Live trip", "Live")}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setDrawer(true)} aria-haspopup="dialog" aria-expanded={drawer} className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-white/75">
              <IconMenu />More
            </button>
          </li>
        </ul>
      </nav>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" aria-label="Close menu" onClick={closeDrawer} className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-pine p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white">
            <ul className="space-y-1">{items.filter((i) => !["dashboard", "trips", "live", "map"].includes(i.id)).map((i) => link(i, false, closeDrawer))}</ul>
            <form action={signOutAction} className="mt-3 border-t border-white/10 pt-3">
              <button type="submit" className="min-h-11 w-full rounded-xl bg-white/10 text-sm font-semibold">Sign out</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
