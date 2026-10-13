// A person types the hours they know ("9am-6pm", "09:00-18:00", "Mo-Sa 9:00-17:30", "24 hours"). We turn that into the strict form
// the hours reader understands, and refuse anything we cannot read, with a reason, instead of guessing.
import { openStatus } from "@/lib/intel/hours";

export type HoursParse = { ok: true; hours: string | null } | { ok: false; reason: string };
const HELP = "Use a format like 09:00-18:00, 9am-6pm or Mo-Sa 09:00-17:30.";

function to24(h: string, m: string | undefined, ap: string | undefined): string | null {
  let hh = Number(h);
  const mm = m === undefined ? 0 : Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || mm > 59) return null;
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    const pm = ap.toLowerCase() === "pm";
    hh = hh % 12 + (pm ? 12 : 0);
  } else if (hh > 24 || (hh === 24 && mm > 0)) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function normalizeHoursInput(raw: string): HoursParse {
  const text = raw.trim();
  if (!text) return { ok: true, hours: null };
  if (/^(open\s*)?(24\s*(\/|x)\s*7|24\s*hours?|all\s*day|always\s*open|round the clock)$/i.test(text)) return { ok: true, hours: "24/7" };
  if (/^(closed|off|none)$/i.test(text)) return { ok: false, reason: "Enter the hours when it IS open." };

  const day = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(.*)$/i.exec(text);
  const days = day ? day[1].replace(/\b([a-z])([a-z])\b/gi, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase()) : "Mo-Su";
  const times = day ? day[2] : text;
  const parts = times.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: HELP };
  const intervals: string[] = [];
  for (const part of parts) {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(part);
    if (!m) return { ok: false, reason: HELP };
    const a = to24(m[1], m[2], m[3]);
    const b = to24(m[4], m[5], m[6]);
    if (!a || !b) return { ok: false, reason: HELP };
    // "9-6" with no am/pm and a smaller end could mean 9am-6pm or 9am-6am. We will not guess which: a wrong guess means false warnings.
    const noAmPm = !m[3] && !m[6];
    if (noAmPm && Number(m[1]) <= 12 && Number(m[4]) <= 12 && b <= a) return { ok: false, reason: `Is that ${m[1]}am-${m[4]}pm? Add am or pm, or use 24-hour time like 09:00-18:00.` };
    intervals.push(`${a}-${b}`);
  }
  const hours = `${days} ${intervals.join(",")}`;
  // Final check with the same reader the engine will use: if it cannot read the result, say so now.
  if (openStatus(hours, Date.UTC(2026, 9, 14, 6, 0), 330).state === "unknown") return { ok: false, reason: HELP };
  return { ok: true, hours };
}
