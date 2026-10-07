"use client";

import dynamic from "next/dynamic";

// MapLibre is ~800 KB and needs WebGL, so it's loaded only in the browser, only when this renders.
export const TripMapLazy = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-line/60" aria-hidden="true" />,
});
