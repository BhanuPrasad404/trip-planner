import { avatarTone, initialOf } from "@/lib/feed/people";

/** A traveler's round mark: their initial on a stable theme colour. Decorative: the name is always written next to it. */
export function Avatar({ username, displayName, size = 36 }: { username: string; displayName?: string | null; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${avatarTone(username)}`}>
      {initialOf(username, displayName)}
    </span>
  );
}
