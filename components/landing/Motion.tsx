"use client";

// The little bit of script behind the landing page's motion. Everything works with no script (content is visible on the server render and
// is only hidden, then revealed, once the browser has taken over), and nothing moves for people who prefer reduced motion.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const calm = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Fades and lifts its content in as it scrolls into view. Already on screen when the page loads: shown at once, no flash. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" | "section" | "p" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inView = () => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight * 0.92 && r.bottom > 0; };
    if (calm() || typeof IntersectionObserver === "undefined" || inView()) { el.dataset.in = "true"; return; }
    el.dataset.armed = "true";
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { el.dataset.in = "true"; io.disconnect(); } }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const style = { "--tm-delay": `${delay}ms` } as CSSProperties;
  const Any = Tag as "div";
  return <Any ref={ref as never} className={`tm-reveal ${className}`} style={style}>{children}</Any>;
}

/** A number that counts up when it scrolls into view. The server render already shows the final number. */
export function CountUp({ to, suffix = "", className = "" }: { to: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || calm() || typeof IntersectionObserver === "undefined") return;
    const fmt = (n: number) => `${Math.round(n).toLocaleString("en-IN")}${suffix}`;
    let raf = 0;
    const run = () => {
      const t0 = performance.now(), dur = 1600;
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    };
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.92) el.textContent = fmt(0);
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { run(); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, suffix]);
  return <span ref={ref} className={className}>{`${to.toLocaleString("en-IN")}${suffix}`}</span>;
}

/** Moves its content a fraction of the scroll distance, for depth. Plain and cheap: one passive listener, one frame at a time. */
export function Parallax({ speed = 0.15, children, className = "" }: { speed?: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || calm()) return;
    let raf = 0;
    const on = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; el.style.transform = `translate3d(0, ${Math.min(window.scrollY, 900) * speed}px, 0)`; }); };
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, [speed]);
  return <div ref={ref} className={`will-change-transform ${className}`}>{children}</div>;
}
