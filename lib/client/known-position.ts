/** The phone's position, but ONLY if the person already allowed it (this never triggers a permission prompt) and never for long. */
export async function knownPosition(waitMs = 800): Promise<{ lat: number; lng: number } | null> {
  try {
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !navigator.permissions) return null;
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (p.state !== "granted") return null;
    return await new Promise((res) => {
      const stop = setTimeout(() => res(null), waitMs);
      navigator.geolocation.getCurrentPosition(
        (g) => { clearTimeout(stop); res({ lat: g.coords.latitude, lng: g.coords.longitude }); },
        () => { clearTimeout(stop); res(null); }, { maximumAge: 600_000, timeout: waitMs },
      );
    });
  } catch { return null; }
}
