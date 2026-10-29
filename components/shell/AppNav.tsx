"use client";

import { SignOutForm } from "@/components/SignOutForm";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Logo } from "../Logo";
import { Glyph } from "@/components/ui/Glyph";
import { IconChevron, IconMenu } from "./icons";
import { useHideOnScroll } from "@/lib/client/use-hide-on-scroll";
import { buildNav, currentTrip, isDrivingSurface, type NavTrip } from "./nav";

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

type Props = { trips: NavTrip[]; userInitial: string; signOutAction: () => Promise<void>; userId?: string | null };

export function AppNav({ trips, userInitial, signOutAction, userId = null }: Props) {
  const pathname = usePathname() ?? "/";
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const [drawer, setDrawer] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  // Twitter-style: reading down tucks the bottom bar away, reading up brings it back. Never on the driving screens, never while the menu is open.
  const scrolledAway = useHideOnScroll(!isDrivingSurface(pathname) && !drawer, pathname);
  const barHidden = scrolledAway && !focusInside;
  // The search pill is the first thing on most screens, but the live map needs every pixel.
  const showSearch = !/^\/trips\/[^/]+\/map(\/|$)/.test(pathname); // a keyboard or screen-reader user who reaches the bar always sees it
  const items = buildNav(pathname, trips);
  const trip = currentTrip(pathname, trips);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const link = (it: (typeof items)[number], compact: boolean, onClick?: () => void, light = false) => {
    const active = it.match(pathname);
    return (
      <li key={it.id}>
        <Link
          href={it.href}
          onClick={onClick}
          aria-current={active ? "page" : undefined}
          title={compact ? it.label : undefined}
          className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
            light ? (active ? "bg-teal-light text-teal-ink" : "text-ink hover:bg-sky") : active ? "bg-white text-pine shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
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

      {/* Phone: the brand, a search pill, and a floating glass bottom bar. (Not sticky: it scrolls away and gives the page the room;
          the bottom bar is the navigation.) The search pill is a link to Explore, where searching already lives. */}
      <header className="relative z-20 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" aria-label="Trailmate dashboard" className="rounded-xl"><Logo tagline /></Link>
          <Link href="/profile" aria-label="Your profile" className="grid h-11 w-11 place-items-center rounded-full bg-teal text-base font-bold text-white shadow-md ring-2 ring-white">{userInitial}</Link>
        </div>
        {showSearch && (
          <Link href="/explore" aria-label="Search destinations and plan your next ride" className="tm-glass mt-3 flex min-h-12 items-center gap-3 rounded-full px-4 text-[15px] text-ink-muted">
            <Glyph name="pin" size={20} className="shrink-0 text-teal" />
            <span className="min-w-0 flex-1 truncate">Search destinations, plan your next ride…</span>
            <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-light text-teal-ink"><Glyph name="navigate" size={16} /></span>
          </Link>
        )}
      </header>
      <nav aria-label="Main navigation" data-mobile-nav data-hidden={barHidden} onFocus={() => setFocusInside(true)} onBlur={() => setFocusInside(false)} className={`tm-glass fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 rounded-[1.75rem] text-ink transition-transform duration-200 motion-reduce:transition-none md:hidden ${barHidden ? "translate-y-[calc(100%+1.5rem)]" : "translate-y-0"}`}>
        <ul className="grid grid-cols-5">
          {primaryMobile.map((it) => {
            const active = it.match(pathname);
            return (
              <li key={it.id}>
                <Link href={it.href} aria-current={active ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-teal-ink" : "text-ink-muted"}`}>
                  <it.Icon className={active ? "text-teal" : ""} />{it.label.replace("My trips", "Trips").replace("Live trip", "Live")}
                  <span aria-hidden="true" data-glow={active || undefined} className={`mt-0.5 h-[3px] w-9 rounded-full ${active ? "bg-teal" : "bg-transparent"}`} />
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setDrawer(true)} aria-haspopup="dialog" aria-expanded={drawer} className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-ink-muted">
              <IconMenu />More
              <span aria-hidden="true" className="mt-0.5 h-0.5 w-9 rounded-full bg-transparent" />
            </button>
          </li>
        </ul>
      </nav>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" aria-label="Close menu" onClick={closeDrawer} className="absolute inset-0 bg-[var(--tm-scrim)]" />
          <div className="tm-glass absolute inset-x-0 bottom-0 rounded-t-3xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink">
            <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line" />
            <ul className="space-y-1">{items.filter((i) => !["dashboard", "trips", "live", "map"].includes(i.id)).map((i) => link(i, false, closeDrawer, true))}</ul>
            <SignOutForm action={signOutAction} userId={userId} className="mt-3 border-t border-line pt-3">
              <button type="submit" className="min-h-11 w-full rounded-xl bg-sky text-sm font-semibold text-ink hover:bg-line">Sign out</button>
            </SignOutForm>
          </div>
        </div>
      )}
    </>
  );
}
