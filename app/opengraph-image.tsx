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
          <svg width="64" height="64" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="13" fill="#E8A33D" />
            <path d="M5 18.5l4.6-6.2 2.6 3.2 3-5.4 5.8 8.4z" fill="#0B3D3A" />
            <path d="M6 20.5c3-1.2 6-.3 9-1.4 2-.7 3.6-.6 5-1.1" stroke="#0B3D3A" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="0.1 2.4" fill="none" />
          </svg>
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
