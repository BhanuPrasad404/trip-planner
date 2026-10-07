// Glides the "you" puck and the camera between GPS fixes on requestAnimationFrame. MapLibre is updated directly, so React
// never re-renders per frame. The camera only moves while FOLLOWING: when the traveller pans, zooms or rotates by hand,
// following stops and we never touch the camera again until they ask to re-centre — and when they do, we glide back from
// where they left it instead of teleporting.
import type { Map as MapLibreMap } from "maplibre-gl";
import { lerp, lerpAngle, smoothingAlpha } from "@/lib/map/navigation";

export type CamTarget = { lng: number; lat: number; bearing: number; zoom: number; pitch: number };
export type PuckPos = { lng: number; lat: number; bearing: number };

export class NavCamera {
  private target: CamTarget | null = null;
  private pos: PuckPos | null = null; // the puck
  private cam: CamTarget | null = null; // the camera
  private raf = 0;
  private last = 0;
  private follow = true;

  constructor(
    private map: MapLibreMap,
    private onFrame: (p: PuckPos) => void,
    private tau = { puck: 220, center: 140, view: 450 },
  ) {}

  get following() { return this.follow; }

  /** Turn follow mode on/off. Turning it ON glides back from the CURRENT view (no jump). */
  setFollowing(on: boolean) {
    if (on && !this.follow) {
      const c = this.map.getCenter();
      this.cam = { lng: c.lng, lat: c.lat, bearing: this.map.getBearing(), zoom: this.map.getZoom(), pitch: this.map.getPitch() };
    }
    this.follow = on;
  }

  /**
   * "Re-centre": resume following and glide from wherever the traveller left the view to the CURRENT position.
   * Works even if the camera has not received a position yet (e.g. right after switching routes).
   */
  recenter(t: CamTarget) {
    const c = this.map.getCenter();
    this.cam = { lng: c.lng, lat: c.lat, bearing: this.map.getBearing(), zoom: this.map.getZoom(), pitch: this.map.getPitch() };
    if (!this.pos) this.pos = { lng: t.lng, lat: t.lat, bearing: t.bearing };
    this.target = t;
    this.follow = true;
  }

  /** New goal from a GPS fix. The first one snaps (no long swoop across the country). */
  setTarget(t: CamTarget) {
    this.target = t;
    if (!this.pos || !this.cam) {
      this.pos = { lng: t.lng, lat: t.lat, bearing: t.bearing };
      this.cam = { ...t };
      if (this.follow) this.map.jumpTo({ center: [t.lng, t.lat], bearing: t.bearing, zoom: t.zoom, pitch: t.pitch });
      this.onFrame(this.pos);
    }
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(100, now - this.last); // a stalled tab must not cause one giant leap
      this.last = now;
      const t = this.target, p = this.pos, c = this.cam;
      if (!t || !p || !c) return;
      const ap = smoothingAlpha(dt, this.tau.puck);
      p.lng = lerp(p.lng, t.lng, ap); p.lat = lerp(p.lat, t.lat, ap);
      p.bearing = lerpAngle(p.bearing, t.bearing, smoothingAlpha(dt, this.tau.view));
      this.onFrame(p);
      if (!this.follow) return; // exploring: leave the camera alone
      const ac = smoothingAlpha(dt, this.tau.center), av = smoothingAlpha(dt, this.tau.view);
      c.lng = lerp(c.lng, p.lng, ac); c.lat = lerp(c.lat, p.lat, ac);
      c.bearing = lerpAngle(c.bearing, t.bearing, av);
      c.zoom = lerp(c.zoom, t.zoom, av); c.pitch = lerp(c.pitch, t.pitch, av);
      this.map.jumpTo({ center: [c.lng, c.lat], bearing: c.bearing, zoom: c.zoom, pitch: c.pitch });
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.target = null;
    this.pos = null;
    this.cam = null;
  }
}
