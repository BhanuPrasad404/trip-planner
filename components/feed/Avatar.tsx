import { Avatar as Mark } from "@/components/ui/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { avatarTone, initialOf } from "@/lib/feed/people";

/** A traveler's round mark: their picture if they set one, otherwise their initial on a stable theme colour. Decorative: the name is always written next to it. */
export function Avatar({ username, displayName, avatarPath = null, size = 36 }: { username: string; displayName?: string | null; avatarPath?: string | null; size?: number }) {
  return <Mark src={avatarUrl(avatarPath)} initial={initialOf(username, displayName)} tone={avatarTone(username)} size={size} />;
}
