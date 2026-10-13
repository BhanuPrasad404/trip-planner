"use client";

import dynamic from "next/dynamic";
import { MapSkeleton } from "@/components/ui/Skeleton";

// MapLibre is ~800 KB and needs WebGL, so it's loaded only in the browser, only when this renders.
export const TripMapLazy = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});
