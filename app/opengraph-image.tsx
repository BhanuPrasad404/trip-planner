import { ImageResponse } from "next/og";

export const alt = "Trailmate — Plan trips that know when to go";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#0B3D3A",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 36, color: "#E8A33D" }}>
          <div style={{ width: 44, height: 44, borderRadius: 22, background: "#E8A33D" }} />
          Trailmate
        </div>
        <div style={{ marginTop: 40, fontSize: 84, lineHeight: 1.05, fontWeight: 700, maxWidth: 950 }}>
          The trip planner that knows when to go.
        </div>
        <div style={{ marginTop: 32, fontSize: 32, color: "#cfe3df" }}>
          Season-aware planning for group trips
        </div>
      </div>
    ),
    size
  );
}
