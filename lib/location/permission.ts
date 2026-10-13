// Why can't we get a position, and what should the person do about it? "Permission denied" covers many different things
// (a block they set earlier, a closed prompt, an insecure page, a site-wide policy, an embedded frame), and "can't read your
// location" covers others (GPS off, airplane mode, no signal) — the advice differs, so they are told apart here.
export type LocationEnv = {
  secure: boolean;
  hasApi: boolean;
  embedded: boolean;
  /** Does the site's Permissions-Policy allow geolocation? null = this browser can't tell. */
  policyAllows: boolean | null;
  /** The browser's saved answer for this site. null = this browser can't tell. */
  permission: "granted" | "denied" | "prompt" | null;
};
export type LocationProblem = "insecure" | "unsupported" | "policy" | "embedded" | "denied" | "dismissed" | "unavailable" | "timeout" | "unknown";
export type LocationDiagnosis = { problem: LocationProblem; message: string; /** true = the drive cannot continue until the person changes something */ fatal: boolean };

const IPHONE = "On an iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App.";

export function diagnoseLocation(error: unknown, env: LocationEnv | null): LocationDiagnosis {
  const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
  if (env && !env.secure) return { problem: "insecure", fatal: true, message: "Location only works on a secure (https) page, and this one isn't. Open the https address of the site." };
  if (env && !env.hasApi) return { problem: "unsupported", fatal: true, message: "This browser can't share your location with web pages. Try Chrome, Safari or Edge." };
  if (code === 1) {
    if (env?.policyAllows === false) return { problem: "policy", fatal: true, message: "This page isn't allowed to use your location — that is a setting of the site, not something you can change in your browser." };
    if (env?.embedded && env.permission !== "denied") return { problem: "embedded", fatal: true, message: "Location can't be used while this page is shown inside another page. Open it in its own tab." };
    if (env?.permission === "prompt") return { problem: "dismissed", fatal: true, message: "Location wasn't allowed. Start the drive again and choose Allow (and Precise, if your phone asks)." };
    return { problem: "denied", fatal: true, message: `Location is blocked for this site. Tap the lock (or settings) icon next to the address, set Location to Allow, then start the drive again. ${IPHONE}` };
  }
  if (code === 2) return { problem: "unavailable", fatal: false, message: "Can't read your location right now. Check that Location / GPS is on and airplane mode is off, or move somewhere with a clearer sky." };
  if (code === 3) return { problem: "timeout", fatal: false, message: "Still looking for your location… this can take a moment, especially indoors." };
  return { problem: "unknown", fatal: false, message: "Can't read your location right now. Check that Location / GPS is turned on." };
}
