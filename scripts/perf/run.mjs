// DEV-ONLY: measure what one page load costs (time, and how many backend calls in what order).
//   npm run build && node scripts/perf/run.mjs            (env: SUPA_LATENCY_MS=150 WEATHER_LATENCY_MS=400 JWT_ALG=ES256|HS256 RUNS=3)
import { spawn, spawnSync } from "node:child_process";

const MOCK = Number(process.env.MOCK_PORT ?? 54399), APP = Number(process.env.APP_PORT ?? 3124), RUNS = Number(process.env.RUNS ?? 3);
const env = { ...process.env, MOCK_PORT: String(MOCK), NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NODE_OPTIONS: "--require ./scripts/perf/preload.cjs", NODE_ENV: "production" };
const procs = [];
const run = (cmd, args, extra = {}) => { const p = spawn(cmd, args, { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] }); if (process.env.DEBUG) { p.stdout.on("data", (d) => process.stdout.write(`[${cmd}] ${d}`)); p.stderr.on("data", (d) => process.stderr.write(`[${cmd}!] ${d}`)); } procs.push(p); return p; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (url) => { for (let i = 0; i < 80; i++) { try { await fetch(url); return; } catch { await sleep(250); } } throw new Error(`no answer from ${url}`); };
const killLeftovers = () => { try { const out = spawnSync("sh", ["-c", `ps -eo pid,cmd | grep next-server | grep -v grep | awk '{print $1}'`], { encoding: "utf8" }).stdout; for (const pid of out.split("\n").filter(Boolean)) process.kill(Number(pid), "SIGTERM"); } catch { /* none */ } };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

try {
  killLeftovers(); await sleep(500);
  run("node", ["scripts/perf/mock-supabase.mjs"]);
  await waitFor(`http://127.0.0.1:${MOCK}/__log`);
  const cookie = await (await fetch(`http://127.0.0.1:${MOCK}/__cookie`)).json();
  run("npx", ["next", "start", "-p", String(APP)]);
  await waitFor(`http://127.0.0.1:${APP}/login`);
  const TRIP = "22222222-2222-4222-8222-222222222222";
  const routes = ["/dashboard", "/trips", `/trips/${TRIP}`, `/trips/${TRIP}/plan`, `/trips/${TRIP}/live`, `/trips/${TRIP}/map`, `/discover`];
  const headers = { cookie: `${cookie.name}=${cookie.value}` };
  const rows = [];
  for (const path of routes) {
    await (await fetch(`http://127.0.0.1:${APP}${path}`, { headers, redirect: "manual" })).text(); // warm-up (module load); read it fully so its calls finish
    await sleep(300);
    const times = [], firstByte = []; let calls = 0; let kinds = {}; let status = 0;
    for (let i = 0; i < RUNS; i++) {
      await fetch(`http://127.0.0.1:${MOCK}/__reset`, { method: "POST" });
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${APP}${path}`, { headers, redirect: "manual" });
      status = res.status;
      firstByte.push(Math.round(performance.now() - t0)); // headers in: the browser can start showing something
      await res.text();
      times.push(Math.round(performance.now() - t0));   // everything in
      const log = await (await fetch(`http://127.0.0.1:${MOCK}/__log`)).json();
      calls = log.length; kinds = {};
      for (const e of log) { const k = e.path.startsWith("/auth") ? "auth" : e.path.startsWith("/rest/v1/") ? e.path.split("?")[0].replace("/rest/v1/", "") : "other"; kinds[k] = (kinds[k] ?? 0) + 1; }
      if (i === RUNS - 1 && process.env.VERBOSE) console.log(path, log.map((e) => `${e.at % 100000}:${e.path.slice(0, 40)}`).join("\n   "));
    }
    rows.push({ route: path.replace(TRIP, ":trip"), status, firstByteMs: median(firstByte), totalMs: median(times), backendCalls: calls, calls: Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(" ") });
  }
  // The actions people click: how long until the server has answered, and how many backend calls it made.
  const PLACE = "33333333-3333-4333-8333-000000000001";
  const apis = [
    ["Mark a stop done (PATCH status)", "PATCH", `/api/places/${PLACE}`, { status: "done" }],
    ["Move a stop to another day (PATCH day)", "PATCH", `/api/places/${PLACE}`, { day_number: 2 }],
    ["Vote on a stop", "POST", `/api/places/${PLACE}/vote`, { vote: 1 }],
    ["Add a stop", "POST", "/api/places", { trip_id: TRIP, name: "Perf stop", lat: 17.5, lng: 79.2, day_number: 1 }],
  ];
  const apiRows = [];
  for (const [label, method, path, body] of apis) {
    const call = () => fetch(`http://127.0.0.1:${APP}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    await (await call()).text(); await sleep(200);
    const times = []; let calls = 0, status = 0;
    for (let i = 0; i < RUNS; i++) {
      await fetch(`http://127.0.0.1:${MOCK}/__reset`, { method: "POST" });
      const t0 = performance.now(); const res = await call(); status = res.status; await res.text(); times.push(Math.round(performance.now() - t0));
      calls = (await (await fetch(`http://127.0.0.1:${MOCK}/__log`)).json()).length;
    }
    apiRows.push({ action: label, status, ms: median(times), backendCalls: calls });
  }
  console.log(`\nSUPA_LATENCY_MS=${process.env.SUPA_LATENCY_MS ?? 150}  WEATHER_LATENCY_MS=${process.env.WEATHER_LATENCY_MS ?? 400}  JWT_ALG=${process.env.JWT_ALG ?? "ES256"}  (median of ${RUNS}, full document load)`);
  console.table(rows);
  console.table(apiRows);
} finally {
  for (const p of procs) p.kill("SIGTERM");
  await sleep(300);
  process.exit(0);
}
