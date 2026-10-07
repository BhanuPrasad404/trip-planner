"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TZ_COOKIE } from "@/lib/tz";

/** Tells the server the traveller's UTC offset so "today" means THEIR today. Refreshes once if it was missing or changed. */
export function TimezoneCookie() {
  const router = useRouter();
  useEffect(() => {
    const offset = String(-new Date().getTimezoneOffset());
    const current = document.cookie.split("; ").find((c) => c.startsWith(`${TZ_COOKIE}=`))?.split("=")[1];
    if (current === offset) return;
    document.cookie = `${TZ_COOKIE}=${offset}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);
  return null;
}
