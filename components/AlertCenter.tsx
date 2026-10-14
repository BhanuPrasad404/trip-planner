"use client";

import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { ActiveAlert } from "@/lib/client/use-alerts";
import { clockToMinutes, minutesToClock, type AlertPrefs } from "@/lib/alerts/prefs";
import type { Permission } from "@/lib/alerts/delivery";

/** Short cards at the top of the screen for alerts that matter right now. Dismissible, with the action right there. */
export function AlertBanners({ alerts, onDismiss, onAction }: { alerts: ActiveAlert[]; onDismiss: (id: string) => void; onAction: (id: string, actionId: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 space-y-2" data-testid="alert-banners">
      {alerts.map((a) => {
        const critical = a.level === 1;
        return (
          <section key={a.id} role={critical ? "alert" : "status"} aria-live={critical ? "assertive" : "polite"} className={`tm-sheet-in pointer-events-auto mx-auto w-full max-w-md rounded-2xl border bg-white p-3.5 shadow-[0_10px_28px_rgba(11,61,58,0.22)] ${critical ? "border-clay/50" : a.kind === "toll" ? "border-marigold/60" : "border-teal/40"}`}>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${critical ? "bg-clay-light text-clay-ink" : a.kind === "toll" ? "bg-marigold-light text-[#7a4a00]" : "bg-teal-light text-teal-ink"}`}><Glyph name={critical ? "warn" : a.kind === "toll" ? "car" : "info"} size={20} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold leading-snug text-pine">{a.title}</h2>
                <p className="mt-0.5 text-sm text-ink-muted">{a.body}</p>
                {a.actions && a.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{a.actions.map((x, i) => <Button key={x.id} size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={() => onAction(a.id, x.id)}>{x.label}</Button>)}</div>
                )}
              </div>
              <button type="button" onClick={() => onDismiss(a.id)} aria-label={`Dismiss: ${a.title}`} className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="close" size={18} /></button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

const PERMISSION_TEXT: Record<Permission, string> = {
  granted: "Phone notifications are allowed.",
  denied: "Phone notifications are blocked in this browser. Allow them in the site settings to use this.",
  default: "Phone notifications haven't been allowed yet.",
  unsupported: "This browser can't show phone notifications. In-app alerts still work.",
};

function Switch({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={`flex min-h-12 items-center justify-between gap-3 py-1.5 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span className="min-w-0"><span className="block text-sm font-semibold text-pine">{label}</span>{hint && <span className="block text-xs text-ink-muted">{hint}</span>}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-6 w-11 shrink-0 cursor-pointer accent-[#1c7c6d]" />
    </label>
  );
}

/** What the traveller allows, in plain words, with a test button so they can check it works before they need it. */
export function AlertSettings({ prefs, permission, onChange, onEnablePhone, onTest }: { prefs: AlertPrefs; permission: Permission; onChange: (p: Partial<AlertPrefs>) => void; onEnablePhone: () => void; onTest: () => void }) {
  const q = prefs.quiet;
  return (
    <details className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-display text-lg font-semibold text-pine">Alerts<span className="text-xs font-normal text-ink-muted">{prefs.enabled ? "On" : "Off"}</span></summary>
      <div className="mt-2 divide-y divide-line">
        <Switch id="alerts-on" label="Alerts" hint="Arrivals, tolls ahead and important changes." checked={prefs.enabled} onChange={(v) => onChange({ enabled: v })} />
        <div className="py-1.5">
          <Switch id="alerts-phone" label="Phone notifications" hint="When Trailmate is in the background." checked={prefs.phone && permission === "granted"} disabled={!prefs.enabled || permission === "unsupported" || permission === "denied"} onChange={(v) => (v ? onEnablePhone() : onChange({ phone: false }))} />
          <p className="pb-1 text-xs text-ink-muted">{PERMISSION_TEXT[permission]}</p>
        </div>
        <Switch id="alerts-sound" label="Sound" hint="A short tone for important alerts while the app is open." checked={prefs.sound} disabled={!prefs.enabled} onChange={(v) => onChange({ sound: v })} />
        <Switch id="alerts-haptics" label="Vibration" hint="A short buzz for important alerts." checked={prefs.haptics} disabled={!prefs.enabled} onChange={(v) => onChange({ haptics: v })} />
        <div className="py-1.5">
          <Switch id="alerts-quiet" label="Quiet hours" hint="No sound, buzz or phone notification. Cards still appear in the app." checked={!!q} disabled={!prefs.enabled} onChange={(v) => onChange({ quiet: v ? { startMin: 22 * 60, endMin: 7 * 60 } : null })} />
          {q && (
            <div className="grid grid-cols-2 gap-3 pb-1">
              <label className="text-xs font-semibold text-ink-muted">From<input type="time" value={minutesToClock(q.startMin)} onChange={(e) => { const m = clockToMinutes(e.target.value); if (m !== null && m !== q.endMin) onChange({ quiet: { startMin: m, endMin: q.endMin } }); }} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-pine" /></label>
              <label className="text-xs font-semibold text-ink-muted">To<input type="time" value={minutesToClock(q.endMin)} onChange={(e) => { const m = clockToMinutes(e.target.value); if (m !== null && m !== q.startMin) onChange({ quiet: { startMin: q.startMin, endMin: m } }); }} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-pine" /></label>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2"><Button size="sm" variant="secondary" onClick={onTest} disabled={!prefs.enabled}>Send a test alert</Button></div>
      <p className="mt-3 rounded-xl bg-sky/60 px-3 py-2.5 text-xs text-ink-muted"><strong className="text-pine">What this can and can&apos;t do.</strong> Alerts work while Trailmate is open on your phone. Phones pause location and web pages when the screen is locked or the app is closed, so nothing can arrive then. On iPhone, phone notifications may need Trailmate added to your Home Screen first.</p>
    </details>
  );
}
