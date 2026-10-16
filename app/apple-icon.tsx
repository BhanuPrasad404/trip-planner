import { ImageResponse } from "next/og";
import { pwaIconArt } from "@/lib/pwa";

// iPhone "Add to Home Screen" icon (Next adds <link rel="apple-touch-icon"> by itself).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(pwaIconArt(180), size);
}
