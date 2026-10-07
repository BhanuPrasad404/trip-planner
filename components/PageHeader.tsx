import type { ReactNode } from "react";

/** Consistent top of every page: what this page is for, in one line, plus the primary action. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="font-mono text-xs font-semibold uppercase tracking-widest text-teal-ink">{eyebrow}</p>}
        <h1 className="mt-1 break-words font-display text-3xl font-semibold leading-tight text-pine sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-base text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
