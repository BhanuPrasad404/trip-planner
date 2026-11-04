"use client";

// "What are you in the mood for?": one big tap per kind of place. Choosing one filters Discover below and takes the person there.
import { CategoryGlyph } from "@/components/ui/Glyph";
import { EXPLORE_CATEGORIES, type ExploreCategoryId } from "@/lib/explore/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import { ChipRow } from "./kit";

const SHORT: Record<ExploreCategoryId, string> = { fort: "Forts", temple: "Temples", waterfall: "Waterfalls", beach: "Beaches", wildlife: "Wildlife", lake: "Lakes", museum: "Museums", viewpoint: "Viewpoints", heritage: "Heritage", peak: "Hills" };

export function MoodTiles({ value, onPick }: { value: ExploreCategoryId | "all"; onPick: (c: ExploreCategoryId) => void }) {
  return (
    <section aria-label="What are you in the mood for?">
      <h2 className="font-display text-xl font-semibold text-pine">What are you in the mood for?</h2>
      <div className="mt-3">
        <ChipRow label="Kinds of places" bleed="4">
          {EXPLORE_CATEGORIES.map((c) => {
            const on = value === c.id;
            return (
              <button key={c.id} type="button" aria-pressed={on} aria-label={`Show ${c.label}`} onClick={() => onPick(c.id)} className="group flex w-[4.75rem] shrink-0 flex-col items-center gap-1.5 py-1 text-center">
                <span className={`flex h-16 w-16 items-center justify-center rounded-full border-2 transition group-active:scale-95 ${on ? "border-marigold bg-pine text-white" : "border-transparent bg-teal-light text-teal-ink group-hover:border-teal"}`}><CategoryGlyph category={plannerCategory(c.id)} size={26} /></span>
                <span className={`text-xs font-semibold ${on ? "text-pine" : "text-ink-muted"}`}>{SHORT[c.id]}</span>
              </button>
            );
          })}
        </ChipRow>
      </div>
    </section>
  );
}
