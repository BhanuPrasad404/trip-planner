// The security headers every page is served with (next.config.ts imports this; tests/security-headers.test.ts pins the rules).
//
// Permissions-Policy decides which browser features THIS site may ask for at all. It used to say `camera=(), microphone=()`,
// which switches the camera and microphone OFF for the whole site: getUserMedia is then refused with "NotAllowedError" no matter
// what the user taps in the browser's own prompt — the app showed "Camera access is blocked" on laptop AND phone. The camera,
// microphone and location are features of Trailmate itself (Discover capture, drive mode), so the site's own pages may use them
// (`self`); embedded third-party frames still may not. Everything else stays off.
export const PERMISSIONS_POLICY = [
  "geolocation=(self)",
  "camera=(self)",
  "microphone=(self)",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];
