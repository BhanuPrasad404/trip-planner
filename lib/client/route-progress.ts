// "Did my click do something?" — the rules for the thin bar shown while the next page is being fetched. Pure, so they are tested.
export const ROUTE_START_EVENT = "tm:route-start";
/** The bar never stays longer than this, even if a navigation silently fails. */
export const ROUTE_PROGRESS_MAX_MS = 20_000;

/** Programmatic navigation (router.push after a form) can call this to show the bar too. */
export function routeProgressStart(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ROUTE_START_EVENT));
}

export type ClickFacts = {
  /** The link's resolved absolute href. */
  href: string;
  /** The page we are on now (absolute). */
  current: string;
  target: string | null;
  download: boolean;
  noProgress: boolean;
  button: number;
  modifier: boolean; // ctrl / meta / shift / alt
  defaultPrevented: boolean;
};

/** Does this click start an in-app page change (rather than a new tab, a download, an anchor jump or another site)? */
export function shouldTrackNavigation(f: ClickFacts): boolean {
  if (f.defaultPrevented || f.button !== 0 || f.modifier || f.download || f.noProgress) return false;
  if (f.target && f.target !== "_self") return false;
  let to: URL, from: URL;
  try { to = new URL(f.href); from = new URL(f.current); } catch { return false; }
  if (to.origin !== from.origin) return false;
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;
  if (to.pathname === from.pathname && to.search === from.search) return false; // same page, or only a #hash jump
  return true;
}
