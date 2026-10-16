import { ImageResponse } from "next/og";
import { PWA_ICON_SIZES, pwaIconArt, type PwaIconKey } from "@/lib/pwa";

// The installable app's icons (referenced by app/manifest.ts). Built once at build time; the same public PNG for everyone.
export const dynamic = "force-static";
export const generateStaticParams = () => Object.keys(PWA_ICON_SIZES).map((size) => ({ size }));

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!(size in PWA_ICON_SIZES)) return new Response("Not found", { status: 404 });
  const key = size as PwaIconKey;
  const px = PWA_ICON_SIZES[key];
  return new ImageResponse(pwaIconArt(px, key === "maskable"), {
    width: px,
    height: px,
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
