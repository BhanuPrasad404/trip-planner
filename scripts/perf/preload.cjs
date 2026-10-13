// DEV-ONLY: makes Open-Meteo answer from a local fake with a fixed delay, so the weather wait on a page can be measured
// without the real internet. Loaded with NODE_OPTIONS="--require ./scripts/perf/preload.cjs".
const delay = Number(process.env.WEATHER_LATENCY_MS ?? 400);
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (/open-meteo\.com/.test(url)) {
    await new Promise((r) => setTimeout(r, delay));
    return new Response(JSON.stringify({ daily: { time: [], temperature_2m_max: [], precipitation_sum: [] } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return real(input, init);
};
