// Phone-width check: renders real screens (Weather, Add a stop, the plan flow's start and save steps, Your plan, the opening-hours view) with the app's built CSS (.next, so run `next build` first), opens them in
// headless Chrome at 360, 390 and 412 px, and lists every element that sticks out past the screen. Used by tests/phone-width.test.ts.
// Run by hand: npx tsx scripts/phone-width.tsx <folder for the temporary html files>
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { forecastHorizonMs } from "@/lib/forecast/areas";
import { buildBoard } from "@/lib/forecast/board";
import { parseSteps } from "@/lib/providers/weather-open-meteo";
import { WeatherPanel } from "@/components/weather/WeatherPanel";
import { NextHoursRow } from "@/components/weather/WeatherParts";
import { ViewModeSwitch } from "@/components/weather/ViewModeSwitch";
import { AddPlaceForm } from "@/components/AddPlaceForm";
import { TripTabs } from "@/components/shell/TripTabs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PlanFlow } from "@/components/plan/PlanFlow";
import { FeedView } from "@/components/feed/FeedView";
import { FeedCard } from "@/components/feed/FeedCard";
import { PostDetail } from "@/components/feed/PostDetail";
import { TravelerProfile } from "@/components/feed/TravelerProfile";
import { QuickReport } from "@/components/feed/QuickReport";
import type { FeedItemDTO, MediaDTO } from "@/lib/feed/map";
import { TripPlanner } from "@/components/TripPlanner";
import { ComparePlans, DonePanel, ResultView, StopSheet } from "@/components/result/ResultView";
import { EXAMPLES } from "@/lib/result/examples";
import { exampleDraft } from "@/lib/result/example-draft";
import { PlaceHoursView } from "@/components/place/PlaceHours";
import { AppNav } from "@/components/shell/AppNav";
import { rankAttractions } from "@/lib/place-intel/attractions";
import { placeRole } from "@/lib/place-intel/role";
import { resolveHours } from "@/lib/server/hours-resolver";

const ROOT = process.cwd().split(path.sep).join("/");
const WIDTHS = [360, 390, 412];
const F = JSON.parse(readFileSync(`${ROOT}/tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json`, "utf8"));
const NOW = Date.parse(F._meta.fetchedAt) + 5 * 60_000;
const HORIZON = forecastHorizonMs(NOW);
const ist = (d: number, hh: number) => Date.UTC(2026, 9, d, hh) - 330 * 60_000;
const HYD = { lat: 17.385, lng: 78.487 };
const area = { steps: parseSteps(F.response), fetchedAt: NOW - 300_000 };
const b = buildBoard({ nowMs: NOW, mode: { kind: "arrival" }, here: { ...HYD, label: "Where you are" }, road: [], stops: [
  { id: "g", name: "Golconda Fort and the very long name of a place, Hyderabad", ...HYD, isNext: true, liveEta: null, planned: ist(22, 16), dayISO: "2026-10-22" },
  { id: "c", name: "Charminar", ...HYD, isNext: false, liveEta: null, planned: ist(23, 11), dayISO: "2026-10-23" },
] }, () => area, HORIZON);
const board = { status: "ready", problem: null, refreshing: false, fetchedAt: NOW - 300_000, ...b } as never;
const noop = () => {};
// Screens that use the app router get a stand-in (nothing navigates in a static render).
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop };
const withRouter = (el: ReturnType<typeof h>) => h(AppRouterContext.Provider, { value: router as never }, el);
const kochi = EXAMPLES.find((e) => e.slug === "kochi-munnar-alleppey")!;
const firstStop = kochi.data.options[1].days.flatMap((d) => d.stops)[0];
// The trip Plan page with one stop on Day 1 and one place just added to Ideas (the screen that broke on 23 Oct 2026).
const TRIP = { id: "t1", owner_id: "u1", name: "Hyderabad weekend with friends", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: null, dest_lat: null, dest_lng: null, start_date: "2026-11-07", num_days: 3, end_mode: "start", invite_code: "abc", created_at: "2026-10-20T00:00:00Z" };
const place = (id: string, name: string, day: number | null, extra: object = {}) => ({ id, trip_id: "t1", name, lat: 17.36, lng: 78.47, source_type: "search", source_url: null, season_tag_id: null, day_number: day, sequence_order: day ? 1 : null, arrival_time: day ? "10:00" : null, notes: null, category: "fort", status: "planned", status_at: null, address: "Golconda mandal, Hyderabad, Telangana, 500008, India", drive_minutes: day ? 25 : null, drive_km: day ? 9 : null, priority: "normal", added_by: "u1", created_at: "2026-10-20T00:00:00Z", season_tags: null, ...extra });


// Feed screens: one real post (photos, conditions, a tip, a long caption and a long place name) on the card and on its own page.
const FEED_PHOTO: MediaDTO = { type: "image", url: "https://signed.example/a.jpg", posterUrl: null, width: 1080, height: 1350, durationS: null };
const FEED_POST = { id: "22222222-2222-4222-8222-222222222222", kind: "photo", caption: "Mist over the trail after the rain, and the parking was full by nine so come early if you can, the road is fine.", placeName: "Echo Point and a very long viewpoint name for a small phone", destination: { id: "d1", name: "Matheran Hill Station Near Mumbai", slug: "matheran" }, author: { username: "ravi_kumar_long_name", displayName: null }, media: [FEED_PHOTO, { ...FEED_PHOTO, url: "https://signed.example/b.jpg" }], counts: { likes: 1200, comments: 3, saves: 4, helpful: 5, tripAdds: 2 }, me: { liked: false, saved: false, helped: false }, experience: { crowd: "crowded", conditions: ["long_queue", "road_good", "parking_full"], vibes: ["best_view", "family"], tip: "Go before 9 AM, parking fills up quickly.", fromArea: true }, freshness: { label: "2 hours ago", state: "today", dot: "green", usableAsCurrent: true }, location: { lat: 18.98, lng: 73.26, precision: "approx", distanceKm: 3.4 }, canComment: true, isMine: false, createdAt: "2026-10-10T10:00:00Z" } as unknown as FeedItemDTO;
const feedNoop = () => undefined;
const feedCardProps = { item: FEED_POST, index: 0, active: true, near: true, frugal: false, muted: true, onTrip: true, register: feedNoop, onToggleMute: feedNoop, onLike: feedNoop, onSave: feedNoop, onComments: feedNoop, onMenu: feedNoop, onAddToTrip: feedNoop, onHelpful: feedNoop, onShare: feedNoop, onDestination: feedNoop, onVideoPlay: feedNoop, onVideoProgress: feedNoop };

// The shared opening-hours view (components/place/PlaceHours.tsx): a town with its places (long names, long reasons, every badge), and a
// sight whose sources disagree (long schedules). Answers made by the real resolver and ranking from made-up rows.
const HOURS_DATE = "2026-11-02";
const hrow = (i: number, over: Record<string, unknown>) => ({ key: `osm:way/${i}`, name: `Place ${i}`, category: "temple", lat: 15.05, lng: 78, notable: true, heritage: true, wikidata: `Q${i}`, wikipedia: "x", sitelinks: 40,
  hours: null, website: null, osm_id: `way/${i}`, osm_date: "2026-10-28", wd_date: "2026-10-29", region_code: "AP", wd_type: null, osm_type: "amenity=place_of_worship", located_in: "Q1", located_in_name: "Ravipuram Town Municipal Corporation Area",
  part_of: null, service_times: null, hours_url: null, check_date: null, ...over });
const hoursTown = rankAttractions({ name: "Ravipuram", lat: 15, lng: 78, kind: "city", population: 400_000, state: "Andhra Pradesh" }, [
  hrow(1, { name: "Sri Lakshmi Venkateswara Swamy Vari Devasthanam on the Hilltop above the Old Town", hours: "Mo-Su 03:00-12:30,13:30-22:00", check_date: "2026-06-01", service_times: "Mo-Su 03:00-04:00,06:00-07:00" }),
  hrow(2, { name: "Old River Fort", category: "fort", osm_type: "historic=fort", hours: "Tu-Su 09:00-17:00; PH off" }),
  hrow(3, { name: "Very Long Golden Sands Beach Along the Coast Road", category: "beach", osm_type: "natural=beach" }),
].map((r) => r as never));
const hoursAround = { parent: hoursTown.parent, radiusKm: hoursTown.radiusKm, dropped: hoursTown.dropped, date: HOURS_DATE, areas: [],
  items: hoursTown.items.map(({ hoursRows, ...a }) => ({ ...a, hours: resolveHours({ name: a.name, lat: a.lat, lng: a.lng, role: a.role }, { osm: hoursRows }, HOURS_DATE) })) };
const townAnswer = resolveHours({ name: "Ravipuram", lat: 15, lng: 78, role: hoursTown.parent.role }, {}, HOURS_DATE);
const shrineRole = placeRole({ name: "x", category: "temple", wdType: "Q842402" });
const o = (ref: string, oh: string) => ({ ref, dataDate: "2026-10-28", openingHours: oh, serviceTimes: null, hoursUrl: "https://example.org/a/very/long/path/to/the/timings/page/of/the/temple", checkDate: null, website: null });
const conflictAnswer = resolveHours({ name: "Sri Lakshmi Narasimha Swamy Temple on the Hill", lat: 15, lng: 78, role: shrineRole },
  { osm: [o("osm/way/1", "Mo-Fr 05:30-12:00,16:00-21:00; Sa,Su 05:00-22:00"), o("osm/relation/123456789", "Mo-Su 06:00-20:00 \"darshan closes 30 minutes before\"")] }, HOURS_DATE);

// The phone shell as every signed-in page wears it: the brand header, the search pill, the floating bottom bar (and a long trip name).
const shellTrips = [{ id: "t1", name: "Hyderabad weekend with friends and a very long trip name", state: "active" }] as never;
const shell = (body: ReturnType<typeof h>) => h("div", { className: "flex min-h-dvh flex-col md:flex-row" }, h(AppNav, { trips: shellTrips, userInitial: "B", signOutAction: async () => {} }), h("div", { className: "min-w-0 flex-1 pb-28 md:pb-0" }, body));

export const pages: Record<string, string> = {
  "app-shell": renderToStaticMarkup(withRouter(shell(h("main", { className: "mx-auto w-full max-w-3xl space-y-4 px-4 py-5" },
    h("h1", { className: "font-display text-2xl font-semibold text-pine" }, "Good morning, Banu"),
    h("div", { className: "rounded-2xl border border-line bg-white p-5" }, h("p", { className: "text-ink" }, "A white card on the warm page, with the soft resting shadow.")))))),
  "place-hours-town": renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-3xl px-4 py-5" },
    h(PlaceHoursView, { place: { name: "Ravipuram" }, answer: townAnswer, around: hoursAround as never, aroundLoading: false, aroundError: null, date: HOURS_DATE, onDate: noop, onAdd: noop, added: () => false }))),
  "place-hours-conflict": renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-3xl px-4 py-5" },
    h(PlaceHoursView, { place: { name: "Sri Lakshmi Narasimha Swamy Temple on the Hill" }, answer: conflictAnswer, around: null, aroundLoading: false, aroundError: null, date: HOURS_DATE, onDate: noop, onAddHours: noop }))),
  weather: renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" },
    h("div", { className: "mt-3" }, h(TripTabs, { tripId: "t", activeNow: false })),
    h(WeatherPanel, { title: "Weather for every stop", board, mode: { kind: "arrival" }, setMode: noop, nowMs: NOW, hereSource: "planned", requestDevice: noop, headings: { g: "Day 1 · Thu 22 Oct", c: "Day 2 · Fri 23 Oct" } } as never),
    h(ViewModeSwitch, { mode: { kind: "picked", at: ist(22, 18) }, setMode: noop, nowMs: NOW, horizonEnd: HORIZON } as never),
    h("div", { className: "rounded-2xl border border-line bg-white p-3.5" }, h(NextHoursRow, { hours: b.places[1]?.next ?? [], label: "x" })),
  )),
  // The bug of Oct 2026, kept on purpose: the test must SEE it, or it proves nothing.
  "feed-screen": renderToStaticMarkup(h("main", { id: "main" }, h(FeedView, { tripId: null, trips: [{ id: "t1", name: "Monsoon weekend with the family" }], hasProfile: true }))),
  "feed-card": renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-[34rem]" }, h(FeedCard, feedCardProps as never))),
  "post-page": renderToStaticMarkup(withRouter(h(PostDetail, { initial: FEED_POST, more: [FEED_POST], trips: [{ id: "t1", name: "Monsoon weekend with the family" }], focusTripId: "t1", hasProfile: true } as never))),
  "traveler-page": renderToStaticMarkup(withRouter(h(TravelerProfile, { profile: { username: "ravi_kumar_long_name", displayName: "Ravi Kumar from a long village name", bio: "Weekend rider. Hills, waterfalls and the long way round.", isPrivate: false, mine: true }, standing: { helped: 1240, posts: 3400, followers: 125000, following: 980, tier: "guide", place: { id: "d", name: "Araku Valley and the hills around it", helped: 300 } }, follow: "none", posts: [FEED_POST, { ...FEED_POST, id: "33333333-3333-4333-8333-333333333333" }], nextCursor: "c", postsHidden: false } as never))),
  "quick-report": renderToStaticMarkup(h(QuickReport, { place: { name: "Echo Point and a very long viewpoint name", lat: 18.98, lng: 73.26 }, onClose: feedNoop })),
  control: renderToStaticMarkup(h("main", { className: "mx-auto w-full px-4" }, h("ol", { className: "flex gap-1.5 overflow-x-auto" },
    ...Array.from({ length: 12 }, (_, i) => h("li", { key: i, className: "w-14 shrink-0" }, `${i}h`, h("span", { className: "sr-only" }, `hour ${i} details`)))))),
  addplace: renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-3xl px-4 py-5" },
    h(AddPlaceForm, { tripId: "t", dayNumber: 1, near: HYD, onAdded: noop, onCancel: noop } as never))),
  "planner-ideas": renderToStaticMarkup(withRouter(h(TripPlanner, { trip: TRIP, places: [place("p1", "Charminar", 1), place("p3", "https://maps.app.goo.gl/u7XkQ2vZpL9mN3bR8cTy", null, { address: "8C9F+XQ2,Golconda,Hyderabad,Telangana,500008,India" }), place("p2", "Sri Venkateswara Swamy Vari Devasthanam Chilkur Balaji Temple", null, { source_url: "https://www.instagram.com/reel/C1234567890abcdefghijklmnop/?utm_source=ig_web_copy_link&igshid=MzRlODBiNWFlZA==" })], members: [], today: "2026-10-23", siteUrl: "http://localhost", conditions: {}, userId: "u1", votes: {} } as never))),
  // A real multi-day trip as the Plan page shows it (days, drive legs, long place names), like the Hyderabad → Goa one reported on a phone.
  "planner-days": renderToStaticMarkup(withRouter(h(TripPlanner, { trip: { ...TRIP, name: "Hyd- Goa trip", start_date: "2026-10-31", num_days: 6, end_mode: "start" }, places: [
    place("d1", "Rachol Fort and the very long name of a heritage site", 2, { lat: 15.34, lng: 73.95, arrival_time: "11:23", drive_minutes: 173, drive_km: 161 }),
    place("d2", "Rachol Church", 3, { lat: 15.34, lng: 73.95, arrival_time: "08:31", drive_minutes: 1, drive_km: 0 }),
    place("d3", "Safa Masjid", 4, { lat: 15.43, lng: 73.99, arrival_time: "10:55", drive_minutes: 41, drive_km: 35 }),
    place("d4", "Mormugao", 4, { lat: 15.41, lng: 73.8, arrival_time: "13:16", drive_minutes: 45, drive_km: 36 }),
    place("d5", "Sankeshwar (night halt)", 1, { lat: 16.27, lng: 74.48, arrival_time: null, drive_minutes: 493, drive_km: 550, category: "stay", source_type: "plan_halt" }),
  ], members: [], today: "2026-10-29", siteUrl: "http://localhost", conditions: {}, userId: "u1", votes: {} } as never))),
  "plan-start": renderToStaticMarkup(withRouter(h(PlanFlow, { signedIn: false }))),
  "save-step": renderToStaticMarkup(withRouter(h(PlanFlow, { signedIn: false, initial: { draft: exampleDraft(kochi), step: "ready" } }))),
  ...Object.fromEntries(EXAMPLES.map((e) => [`result-${e.slug}`, renderToStaticMarkup(withRouter(h(ResultView, { kind: "example", example: e, signedIn: false })))])),
  "result-parts": renderToStaticMarkup(withRouter(h("main", { className: "mx-auto w-full max-w-2xl space-y-4 px-4" },
    h(ComparePlans, { data: kochi.data, total: kochi.places.length }),
    h(DonePanel, { tripId: "t", busy: false, onUndo: noop }),
    h(StopSheet, { stop: { ...firstStop, name: "Eravikulam National Park and a very long name for a phone" }, must: false, place: { id: "p", name: "x", lat: 10, lng: 77 }, busy: false, onClose: noop, onMust: noop, onSkip: noop })))),
};

export const cssDir = `${ROOT}/.next/static/chunks`;
const css = !existsSync(cssDir) ? "" : readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(`${cssDir}/${f}`, "utf8")).join("\n");
// Each page is loaded in three iframes exactly 360, 390 and 412 px wide (headless Chrome's own window can't be that narrow). Inside
// each: the page's scroll width, and every element sticking out past the screen that isn't clipped by a scrolling row it belongs to.
const measure = `function wide(d){const W=d.documentElement.clientWidth;const bad=[];for(const e of d.body.querySelectorAll('*')){const r=e.getBoundingClientRect();if(r.right<=W+0.5||r.width===0)continue;let p=e.parentElement,clipped=false;const abs=getComputedStyle(e).position==='absolute';while(p&&p!==d.body){const s=getComputedStyle(p);if(s.overflowX!=='visible'&&p.getBoundingClientRect().right<=W+0.5&&(!abs||s.position!=='static'||p.querySelector(':scope *')&&[...p.querySelectorAll('*')].some(x=>x!==e&&x.contains(e)&&getComputedStyle(x).position!=='static'))){clipped=true;break}p=p.parentElement}if(!clipped)bad.push(e.tagName.toLowerCase()+'.'+(e.getAttribute('class')||'').slice(0,70)+' right='+Math.round(r.right)+' text='+(e.textContent||'').trim().slice(0,30))}return{W,scroll:d.documentElement.scrollWidth,bad:bad.slice(0,8)}}`;
export const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => !!p && existsSync(p)) ?? null;
export type WidthResult = { page: string; width: number; W: number; scroll: number; bad: string[] };
export function measurePages(pages: Record<string, string>, outDir: string): WidthResult[] {
  const out: WidthResult[] = [];
  for (const [name, body] of Object.entries(pages)) {
    const inner = `${outDir}/wide-${name}.html`;
    writeFileSync(inner, `<!doctype html><html class="h-full"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="min-h-full flex flex-col bg-sky text-ink">${body}</body></html>`);
    const outer = `${outDir}/wide-${name}-frames.html`;
    const frames = WIDTHS.map((w) => `<iframe id="f${w}" src="wide-${name}.html" style="width:${w}px;height:900px;border:0"></iframe>`).join("");
    writeFileSync(outer, `<!doctype html><html><body style="margin:0;width:1400px">${frames}<script>${measure};addEventListener('load',()=>{const r={};for(const w of ${JSON.stringify(WIDTHS)})r[w]=wide(document.getElementById('f'+w).contentDocument);const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=JSON.stringify(r);document.body.appendChild(pre)})</script></body></html>`);
    const dom = execFileSync(CHROME!, ["--headless=new", ...(process.env.CHROME_NO_SANDBOX ? ["--no-sandbox"] : []), "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--window-size=1400,1000", "--virtual-time-budget=4000", "--dump-dom", `file:///${outer}`], { encoding: "utf8", maxBuffer: 64 << 20 });
    const m = /<pre id="RESULT">([\s\S]*?)<\/pre>/.exec(dom);
    if (!m) throw new Error(`no measurement for ${name}`);
    const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) as Record<string, { W: number; scroll: number; bad: string[] }>;
    for (const w of WIDTHS) out.push({ page: name, width: w, ...r[w] });
  }
  return out;
}

if (process.argv[1]?.split(path.sep).join("/").endsWith("scripts/phone-width.tsx") && process.argv[2]) for (const r of measurePages(pages, process.argv[2])) console.log(r.page, r.width, JSON.stringify({ W: r.W, scroll: r.scroll, bad: r.bad }));
