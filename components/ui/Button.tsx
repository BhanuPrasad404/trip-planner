import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 select-none";

const variants: Record<Variant, string> = {
  primary: "bg-marigold text-pine hover:bg-[#f0b254] active:bg-[#d9942d]",
  secondary: "bg-white text-pine border border-line hover:bg-teal-light",
  ghost: "text-pine hover:bg-pine/10",
  danger: "bg-clay-light text-clay-ink border border-clay/30 hover:bg-[#f7d9cc]",
};

const sizes: Record<Size, string> = {
  md: "min-h-12 px-5 text-base",
  sm: "min-h-10 px-3.5 text-sm max-sm:min-h-11",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** The action is running: show a spinner at once, ignore further clicks (no double submit), keep the button where it is. */
  loading?: boolean;
  /** Replaces the label while loading ("Saving…"). Without it the normal label stays next to the spinner. */
  loadingLabel?: string;
};

export function Button({ variant, size, className, type = "button", loading = false, loadingLabel, disabled, children, onClick, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      // `disabled` already blocks clicks; this also stops a second click that lands before the re-render.
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading && <Spinner size={size === "sm" ? 14 : 16} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size };

export function LinkButton({ variant, size, className, ...props }: LinkButtonProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
