"use client";

import { useEffect, useRef, useState } from "react";

// Images we do not control (Wikimedia, traveller uploads) can fail: 404, 429, offline, a file removed from Commons.
// A browser's broken-image icon says nothing useful, so a failed image is replaced by `fallback` (the category icon or an honest
// "Photo unavailable" tile) and remembered for the session so lists do not retry it on every render.
const failed = new Set<string>();
export const forgetFailedImages = () => failed.clear(); // tests only

type Props = {
  src: string;
  srcSet?: string;
  /** What the browser should assume about the rendered width, e.g. "64px". Needed for srcSet to pick the right file. */
  sizes?: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  /** Shown instead of the image when it cannot be loaded. */
  fallback: React.ReactNode;
  /** Rendered with the image only (a credit link must not stay behind when the image is gone). */
  children?: React.ReactNode;
};

export function SafeImg({ src, srcSet, sizes, alt, width, height, className, fallback, children }: Props) {
  const [badSrc, setBadSrc] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const bad = badSrc === src || failed.has(src);
  const fail = () => { failed.add(src); setBadSrc(src); };

  // The image may already have failed before React attached onError (server-rendered page, slow hydration).
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per src; `fail` only closes over `src`
  }, [src]);

  if (bad) return <>{fallback}</>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote Wikimedia / Storage image: pre-sized, lazy, fixed box, with a fallback */}
      <img
        ref={ref} src={src} srcSet={srcSet} sizes={srcSet ? sizes : undefined} alt={alt} width={width} height={height}
        loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className} onError={fail}
      />
      {children}
    </>
  );
}
