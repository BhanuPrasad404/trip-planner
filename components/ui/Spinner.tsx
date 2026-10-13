// The ONE loading indicator. Use these instead of hand-made spinning borders so every wait looks and sounds the same.
//   <Spinner />        small ring that takes the surrounding text colour (buttons, inline status)
//   <LoadingMark />    the Trailmate logo with its dotted trail walking (page and panel loads)
// Both announce themselves to screen readers once via role="status" when given a label, and are still (not spinning) for
// people who prefer reduced motion — the visible words next to them carry the message then.

export function Spinner({ size = 16, label, className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <span role={label ? "status" : undefined} className={`inline-flex shrink-0 ${className}`}>
      <span
        aria-hidden="true"
        style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
        className="inline-block animate-spin rounded-full border-current border-t-transparent opacity-80 motion-reduce:animate-none motion-reduce:border-t-current"
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export function LoadingMark({ size = 56, label = "Loading", className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex flex-col items-center gap-3 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <circle cx="13" cy="13" r="13" fill="#E8A33D" />
        <path className="tm-mark-trail" d="M6 18c3-1 3-5 6-5s3-4 8-5" stroke="#0B3D3A" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="0.1 4.2" />
        <circle className="tm-mark-pin" cx="6" cy="18" r="2" fill="#0B3D3A" />
        <circle className="tm-mark-pin" cx="20" cy="8" r="2" fill="#0B3D3A" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
