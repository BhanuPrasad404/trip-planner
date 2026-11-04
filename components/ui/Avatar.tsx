"use client";

// A person's round mark: their picture when they chose one, otherwise their initial on a theme colour. A picture that fails to load falls
// back to the initial (never a broken-image icon). Decorative: the person's name is always written next to it.
import { SafeImg } from "./SafeImg";

export function Avatar({ src, initial, size = 36, tone = "bg-teal text-white", className = "" }: { src?: string | null; initial: string; size?: number; tone?: string; className?: string }) {
  const mark = (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${tone} ${className}`}>{initial}</span>
  );
  if (!src) return mark;
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={`relative block shrink-0 overflow-hidden rounded-full bg-sky ${className}`}>
      <SafeImg src={src} alt="" width={size} height={size} className="h-full w-full object-cover" fallback={mark} />
    </span>
  );
}
