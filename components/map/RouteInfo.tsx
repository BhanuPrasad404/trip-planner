"use client";

import { useEffect, useRef } from "react";
import { TollNote, tollDetail, tollLine } from "@/components/LiveTolls";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { ActiveAlert } from "@/lib/client/use-alerts";
import type { TollView } from "@/lib/client/use-toll-watch";
import type { HudNotice } from "@/lib/map/notices";
import { formatAhead } from "@/lib/trip/toll";

/** What the button says, or null when there is nothing worth a button (so an empty route has no clutter at all). */
export function routeInfoLabel(tolls: TollView, alertCount: number, otherMessages: number): string | null {
  if (tolls.next) return `Toll · ${formatAhead(tolls.next.aheadM).replace("about ", "")}`;
  if (alertCount > 0) return `Alerts · ${alertCount}`;
  if (tolls.unavailable) return "Route info";
  if (tolls.navigating && tolls.ahead.length > 0) return "Tolls ahead";
  if (otherMessages > 0) return "Messages";
  return null;
}

export function RouteInfoButton({ label, open, warn, onClick }: { label: string; open: boolean; warn: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="relative min-h-11 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-pine shadow-sm">
      <span className="inline-flex items-center gap-1.5"><Glyph name="car" size={16} className="text-marigold" />{label}</span>
      {warn && <><span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-clay" /><span className="sr-only"> (needs attention)</span></>}
    </button>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }); // India time

/**
 * Everything the map keeps OFF the road until asked: tolls ahead and what we do and do not know about them, recent alerts (also the ones
 * that were dismissed, so nothing is lost), and any message that did not fit on the map. It opens inside the top stack, so the route, the
 * next-turn banner and the End button stay visible and reachable while it is open.
 */
export function RouteInfoSheet({ tolls, alerts, other, onClose }: { tolls: TollView; alerts: ActiveAlert[]; other: HudNotice[]; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const list = tolls.ahead.slice(0, 6);
  return (
    <section role="dialog" aria-label="Route info" className="max-h-[42dvh] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-white p-3.5 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-pine">Route info</h2>
        <button ref={close} type="button" onClick={onClose} aria-label="Close route info" className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-ink-muted"><Glyph name="close" size={18} /></button>
      </div>

      {tolls.navigating && (
        <div className="mt-1">
          <h3 className="text-sm font-semibold text-pine">Tolls ahead</h3>
          {list.length > 0 ? (
            <ul className="mt-1 divide-y divide-line">{list.map((t) => <li key={t.id} className="py-2 text-sm"><p className="font-semibold text-pine">{tollLine(t)}</p><p className="text-ink-muted">{tollDetail(t)}</p></li>)}</ul>
          ) : tolls.status === "loading" ? (
            <p role="status" className="mt-1 text-sm text-ink-muted">Checking this route for toll plazas…</p>
          ) : tolls.unavailable ? (
            <div className="mt-1"><p className="text-sm text-ink-muted">We couldn&apos;t check this route for toll plazas, so there may be tolls ahead that aren&apos;t shown.</p><Button size="sm" variant="secondary" className="mt-1.5 min-h-11" onClick={tolls.retry}>Check again</Button></div>
          ) : tolls.status === "ready" ? (
            <p className="mt-1 text-sm text-ink-muted">No toll plazas found ahead on this route in map data.</p>
          ) : <p className="mt-1 text-sm text-ink-muted">Still checking; we&apos;ll keep trying quietly.</p>}
          <div className="mt-1"><TollNote complete={tolls.complete} unavailable={tolls.unavailable} /></div>
        </div>
      )}

      {other.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <h3 className="text-sm font-semibold text-pine">Other messages</h3>
          <ul className="mt-1 space-y-1 text-sm text-ink-muted">{other.map((n) => <li key={n.id}>{n.text}</li>)}</ul>
        </div>
      )}

      <div className="mt-3 border-t border-line pt-2">
        <h3 className="text-sm font-semibold text-pine">Recent alerts</h3>
        {alerts.length === 0 ? <p className="mt-1 text-sm text-ink-muted">None yet on this trip.</p> : (
          <ul className="mt-1 divide-y divide-line">{alerts.slice(0, 8).map((a) => <li key={`${a.id}:${a.at}`} className="py-1.5 text-sm"><p className="font-semibold text-pine">{a.title} <span className="font-normal text-ink-muted">· {time(a.at)}</span></p><p className="text-ink-muted">{a.body}</p></li>)}</ul>
        )}
      </div>
    </section>
  );
}
