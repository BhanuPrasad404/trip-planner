"use client";

import { useState } from "react";
import { fileToDataUrl } from "@/lib/client/image";
import { createClient } from "@/lib/supabase/client";
import {
  REPORT_PHOTO_BUCKET, REPORT_TAGS, REPORT_TAG_IDS, summarizeReports, timeAgo,
  type ReportTag, type ReportView,
} from "@/lib/reports";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { REPORT_TAG_GLYPH } from "@/lib/glyphs";

function TagGlyph({ tag }: { tag: string }) {
  return <Glyph name={REPORT_TAG_GLYPH[tag] ?? "info"} size={13} className="mr-0.5 inline align-text-bottom" />;
}

type PlaceReportsProps = {
  place: { id: string; name: string; lat: number; lng: number };
  reports: ReportView[];
  userId: string;
  /** Called after something changed on the server so the page can reload. */
  onChanged: () => void;
  /** Time is passed in (not read here) so server and client render the same text. */
  now: Date;
};

const linkBtn = "min-h-9 font-semibold text-ink-muted underline underline-offset-2 hover:text-teal-ink";

export function PlaceReports({ place, reports, userId, onChanged, now }: PlaceReportsProps) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<ReportTag[]>([]);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  const summary = summarizeReports(reports, now);
  const toggle = (t: ReportTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 6 ? cur : [...cur, t]));

  async function pickPhoto(file: File | undefined) {
    setError(null);
    if (!file) return setPhoto(null);
    try {
      setPhoto({ dataUrl: await fileToDataUrl(file, 1280, 0.8) });
    } catch (e) {
      setPhoto(null);
      setError(e instanceof Error ? e.message : "Couldn't use that photo.");
    }
  }

  async function submit() {
    setError(null);
    if (tags.length === 0 && !note.trim() && !photo) return setError("Pick a tag, write a note or add a photo.");
    setBusy(true);
    try {
      let photo_path: string | null = null;
      if (photo) {
        const blob = await (await fetch(photo.dataUrl)).blob();
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error: upError } = await createClient().storage.from(REPORT_PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (upError) throw new Error("The photo couldn't be uploaded. You can post without it, or try again.");
        photo_path = path;
      }
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_name: place.name, lat: place.lat, lng: place.lng, tags, note: note.trim() || null, photo_path }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't post your update.");
      setOpen(false); setTags([]); setNote(""); setPhoto(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, kind: "flag" | "delete") {
    setError(null);
    const res = await fetch(kind === "flag" ? `/api/reports/${id}/flag` : `/api/reports/${id}`, { method: kind === "flag" ? "POST" : "DELETE" }).catch(() => null);
    if (!res || !res.ok) return setError(kind === "flag" ? "Couldn't flag that update." : "Couldn't delete that update.");
    if (kind === "flag") setFlagged((s) => new Set(s).add(id));
    else onChanged();
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-white/80 p-3">
      <p className="text-sm text-ink-muted">
        {summary.count === 0 ? (
          <>No updates from the last 30 days.</>
        ) : (
          <>
            <span className="font-semibold text-pine">{summary.count} recent {summary.count === 1 ? "update" : "updates"}</span>
            {summary.top.length > 0 && ": "}
            {summary.top.slice(0, 3).map((t, i) => (
              <span key={t.tag}>{i > 0 && " · "}<TagGlyph tag={t.tag} /> {REPORT_TAGS[t.tag].label}{t.count > 1 ? ` ×${t.count}` : ""}</span>
            ))}
          </>
        )}
      </p>

      {reports.length > 0 && (
        <ul className="mt-2 space-y-3">
          {reports.slice(0, 3).map((r) => (
            <li key={r.id} className="flex gap-3 text-sm">
              {r.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- user photo from Supabase Storage; already downscaled before upload
                <img src={r.photoUrl} alt={`Photo of ${place.name} shared by a traveler`} width={96} height={96} loading="lazy" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap gap-1.5">
                  {r.tags.map((t) => (
                    <span key={t} className="rounded-full bg-sky px-2 py-0.5 text-xs font-semibold text-ink-muted"><TagGlyph tag={t} /> {REPORT_TAGS[t].label}</span>
                  ))}
                </p>
                {r.note && <p className="mt-1 break-words text-ink">{r.note}</p>}
                <p className="mt-1 text-xs text-ink-muted">
                  A traveler · {timeAgo(r.createdAt, now)}
                  {" · "}
                  {r.mine ? (
                    <button type="button" onClick={() => act(r.id, "delete")} className="underline underline-offset-2 hover:text-clay-ink">Delete</button>
                  ) : flagged.has(r.id) ? (
                    "Thanks, flagged"
                  ) : (
                    <button type="button" onClick={() => act(r.id, "flag")} className="underline underline-offset-2 hover:text-clay-ink">Flag</button>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="mt-2 text-sm font-semibold text-clay-ink">{error}</p>}

      {open ? (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="text-sm font-semibold text-pine">What is it like right now?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {REPORT_TAG_IDS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tags.includes(t)}
                  onClick={() => toggle(t)}
                  className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${tags.includes(t) ? "border-teal bg-teal-light text-teal-ink" : "border-line bg-white text-ink-muted hover:border-teal"}`}
                >
                  <TagGlyph tag={t} /> {REPORT_TAGS[t].label}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`note-${place.id}`} className="text-sm font-semibold text-pine">Anything useful for the next traveler? (optional)</label>
            <textarea
              id={`note-${place.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              rows={2}
              className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-sm"
              placeholder="e.g. Parking is full after 10 am. Path is open."
            />
          </div>
          <div>
            <label htmlFor={`photo-${place.id}`} className="text-sm font-semibold text-pine">Photo (optional)</label>
            <input id={`photo-${place.id}`} type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0])} className="mt-1 block w-full text-sm" />
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
              <img src={photo.dataUrl} alt="Preview of your photo" className="mt-2 h-24 w-24 rounded-lg object-cover" />
            )}
            <p className="mt-1 text-xs text-ink-muted">Photos are public to other travelers. Don&apos;t include people&apos;s faces or number plates.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Posting…" : "Post update"}</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`mt-2 ${linkBtn}`}>
          <Glyph name="camera" size={16} className="mr-1.5" />Share an update<span className="sr-only"> about {place.name}</span>
        </button>
      )}
    </div>
  );
}
