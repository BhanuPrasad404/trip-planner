// Questions people really ask, answered plainly. A native disclosure (works with no script, keyboard friendly); the chevron is the app's own.
import { FAQ } from "@/lib/landing-content";

export function Faq() {
  return (
    <div className="divide-y divide-line rounded-3xl border border-line bg-white">
      {FAQ.map((f) => (
        <details key={f.q} className="group px-5 py-1 sm:px-7">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-3 text-left text-base font-semibold text-pine sm:text-lg">{f.q}</summary>
          <p className="pb-4 pr-6 text-base leading-relaxed text-ink-muted">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
