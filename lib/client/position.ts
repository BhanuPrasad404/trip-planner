/** One quick look at the device's position (or null). Only used when the person ticks a box that says so; never stored by the browser. */
export function currentPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
    const stop = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(stop); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(stop); resolve(null); },
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: timeoutMs },
    );
  });
}
