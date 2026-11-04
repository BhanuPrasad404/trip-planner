// The top of Explore: a deep pine banner with a low sun over the hills (theme colours only), the question "Where to next?", and room for the
// search card to float over its lower edge. Server-safe: no state.
import type { ReactNode } from "react";

export function ExploreHero({ title, subtitle, children }: { title: string; subtitle: ReactNode; children?: ReactNode }) {
  return (
    <header className="relative -mx-4 -mt-6 overflow-hidden rounded-b-[2rem] bg-pine px-5 pb-20 pt-9 text-white sm:-mx-6 sm:px-8 sm:pt-12 lg:mx-0 lg:mt-0 lg:rounded-[2rem]">
      <svg aria-hidden="true" viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-x-0 bottom-0 h-full w-full opacity-90">
        <circle cx="352" cy="34" r="20" className="fill-marigold" opacity="0.95" />
        <path d="M0 160V112c40-34 70-30 104-6 30-30 66-52 108-20 26-22 60-26 94-2 34-12 66 4 94 24v52z" className="fill-teal" opacity="0.55" />
        <path d="M0 160v-30c46-22 84-14 122 8 40-30 92-34 130-6 40-16 92-14 148 10v18z" className="fill-teal" opacity="0.85" />
      </svg>
      <div className="relative max-w-2xl">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">Explore</p>
        <h1 className="mt-1 font-display text-4xl font-semibold leading-[1.05] sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-xl text-base text-white/85 sm:text-lg">{subtitle}</p>
        {children}
      </div>
    </header>
  );
}
