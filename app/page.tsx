export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-sky px-6 text-center">
      <div className="text-[10.5px] tracking-widest uppercase text-teal font-semibold mb-3">
        Trailmate
      </div>
      <h1 className="font-display text-4xl font-semibold text-pine max-w-md leading-tight">
        The trip planner that knows when to go.
      </h1>
      <p className="text-ink-soft mt-4 max-w-sm text-[14px] leading-relaxed">
        This is your local dev build. Run the seed SQL in{" "}
        <code className="font-mono text-[12px]">supabase/seed.sql</code> to create a sample trip,
        then visit <code className="font-mono text-[12px]">/trip/[the-trip-id]</code> to see the
        real planner — see README.md for exact steps.
      </p>
    </main>
  );
}
