// Small inline icons for the feed (heart, bookmark, comment…). Decorative: the buttons carry the accessible names.
import type { ReactNode } from "react";

type P = { className?: string; filled?: boolean; size?: number };
const svg = (children: ReactNode, { className, size = 26 }: P, fill = "none") => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>{children}</svg>
);

export const HeartIcon = (p: P) => svg(<path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.8 6.9 4.8c1.9 0 3.5 1 5.1 3 1.6-2 3.2-3 5.1-3 3.3 0 5.2 3.2 4.1 6.4-1.7 4.7-9.2 9.3-9.2 9.3Z" />, p, p.filled ? "currentColor" : "none");
export const BookmarkIcon = (p: P) => svg(<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.6L5 21V4.5a1 1 0 0 1 1-1Z" />, p, p.filled ? "currentColor" : "none");
export const CommentIcon = (p: P) => svg(<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.5-5A8.5 8.5 0 1 1 21 11.5Z" />, p);
export const PinIcon = (p: P) => svg(<><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>, p);
export const PlusIcon = (p: P) => svg(<path d="M12 5v14M5 12h14" />, p);
export const MoreIcon = (p: P) => svg(<><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>, p);
export const CloseIcon = (p: P) => svg(<path d="m6 6 12 12M18 6 6 18" />, p);
export const SendIcon = (p: P) => svg(<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />, p);
export const PlayIcon = (p: P) => svg(<path d="M8 5.5v13l11-6.5-11-6.5Z" />, p, "currentColor");
export const MutedIcon = (p: P) => svg(<><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m16 9 5 6M21 9l-5 6" /></>, p);
export const SoundIcon = (p: P) => svg(<><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>, p);
export const CameraIcon = (p: P) => svg(<><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></>, p);
export const FlagIcon = (p: P) => svg(<path d="M5 21V4m0 0h11l-2 4 2 4H5" />, p);
export const EyeOffIcon = (p: P) => svg(<><path d="M3 3l18 18" /><path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2.1-2.7 3.3M6.4 7.9C4.6 9.2 3.4 10.9 2.5 12c1 1.8 4.5 6 9.5 6a9.7 9.7 0 0 0 3.4-.6" /></>, p);
export const BlockIcon = (p: P) => svg(<><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>, p);
export const CheckIcon = (p: P) => svg(<path d="m5 12.5 4.5 4.5L19 7.5" />, p);
export const SearchIcon = (p: P) => svg(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>, p);
export const ShieldIcon = (p: P) => svg(<><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>, p);
export const BackIcon = (p: P) => svg(<path d="m15 6-6 6 6 6" />, p);
export const UploadIcon = (p: P) => svg(<><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>, p);
export const PenIcon = (p: P) => svg(<><path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" /><path d="m14.5 6.5 3 3" /></>, p);
export const StarIcon = (p: P) => svg(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />, p, p.filled ? "currentColor" : "none");
export const BellIcon = (p: P) => svg(<><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>, p);
export const TrashIcon = (p: P) => svg(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>, p);
export const BulbIcon = (p: P) => svg(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" /></>, p, p.filled ? "currentColor" : "none");
export const ChartIcon = (p: P) => svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />, p);
