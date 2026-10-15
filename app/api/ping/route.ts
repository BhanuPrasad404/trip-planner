// The connectivity probe's target (lib/client/connectivity.ts): the smallest possible answer, no sign-in, no database, never cached.
// It exists so the app can tell "my phone has no internet" from "Trailmate is slow". It reveals nothing about anyone.
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Length": "0" };

export function GET() { return new Response(null, { status: 204, headers }); }
export function HEAD() { return new Response(null, { status: 204, headers }); }
