// Phone-width check: renders real screens (Weather, Add a stop) with the app's built CSS (.next, so run `next build` first), opens them in
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

export const pages: Record<string, string> = {
  weather: renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" },
    h("div", { className: "mt-3" }, h(TripTabs, { tripId: "t", activeNow: false })),
    h(WeatherPanel, { title: "Weather for every stop", board, mode: { kind: "arrival" }, setMode: noop, nowMs: NOW, hereSource: "planned", requestDevice: noop, headings: { g: "Day 1 · Thu 22 Oct", c: "Day 2 · Fri 23 Oct" } } as never),
    h(ViewModeSwitch, { mode: { kind: "picked", at: ist(22, 18) }, setMode: noop, nowMs: NOW, horizonEnd: HORIZON } as never),
    h("div", { className: "rounded-2xl border border-line bg-white p-3.5" }, h(NextHoursRow, { hours: b.places[1]?.next ?? [], label: "x" })),
  )),
  // The bug of Oct 2026, kept on purpose: the test must SEE it, or it proves nothing.
  control: renderToStaticMarkup(h("main", { className: "mx-auto w-full px-4" }, h("ol", { className: "flex gap-1.5 overflow-x-auto" },
    ...Array.from({ length: 12 }, (_, i) => h("li", { key: i, className: "w-14 shrink-0" }, `${i}h`, h("span", { className: "sr-only" }, `hour ${i} details`)))))),
  addplace: renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-3xl px-4 py-5" },
    h(AddPlaceForm, { tripId: "t", dayNumber: 1, near: HYD, onAdded: noop, onCancel: noop } as never))),
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
    const dom = execFileSync(CHROME!, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--window-size=1400,1000", "--virtual-time-budget=4000", "--dump-dom", `file:///${outer}`], { encoding: "utf8", maxBuffer: 64 << 20 });
    const m = /<pre id="RESULT">([\s\S]*?)<\/pre>/.exec(dom);
    if (!m) throw new Error(`no measurement for ${name}`);
    const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) as Record<string, { W: number; scroll: number; bad: string[] }>;
    for (const w of WIDTHS) out.push({ page: name, width: w, ...r[w] });
  }
  return out;
}

if (process.argv[1]?.split(path.sep).join("/").endsWith("scripts/phone-width.tsx") && process.argv[2]) for (const r of measurePages(pages, process.argv[2])) console.log(r.page, r.width, JSON.stringify({ W: r.W, scroll: r.scroll, bad: r.bad }));
