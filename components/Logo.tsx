export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-semibold ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <circle cx="13" cy="13" r="13" fill="#E8A33D" />
        <path
          d="M6 18c3-1 3-5 6-5s3-4 8-5"
          stroke="#0B3D3A"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="0.1 4.2"
        />
        <circle cx="6" cy="18" r="2" fill="#0B3D3A" />
        <circle cx="20" cy="8" r="2" fill="#0B3D3A" />
      </svg>
      Trailmate
    </span>
  );
}
