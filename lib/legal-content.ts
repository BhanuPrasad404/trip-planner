// The text of the Privacy Policy and the Terms of Use, as data, so a test can check that every real data flow in the app is
// mentioned. It was written from what the code actually does (tables, services, cookies); when the app changes, change this.
// It is plain-language and NOT legal advice: have a lawyer who knows Indian law review it before you launch widely.
import { LEGAL_UPDATED_LABEL, MINIMUM_AGE, type LegalContact } from "./legal";

export type Block = string | { list: string[] };
export type Section = { id: string; title: string; body: Block[] };

const who = (c: LegalContact) => c.operator ?? "the Trailmate team";
const how = (c: LegalContact) => (c.email ? `by email at ${c.email}` : "through the contact details on this site");

export function privacySections(c: LegalContact): Section[] {
  return [
    { id: "who", title: "Who we are", body: [
      `Trailmate is a trip planner and live travel companion for road trips in India. It is run by ${who(c)}${c.address ? `, ${c.address}` : ""}. We call ourselves "we" in this policy. Trailmate is an early test version (beta).`,
      `Questions, requests or complaints about your data: contact us ${how(c)}. We will answer within 30 days.`,
    ] },
    { id: "collect", title: "What we collect, and why", body: [
      "We only collect what the app needs to work. Here is everything, in plain words:",
      { list: [
        "Account: your email address and a password (the password is stored only as a scrambled hash by our login provider; we cannot read it) and the display name you choose.",
        "Profile (optional): a username, short bio, interests, a profile picture and whether your profile is private.",
        "Trips: the trips you create or join: names, start place, destination, dates, the stops you add (names, places, notes, order, done or skipped), votes, and the display names of the people on the trip.",
        "Your location: only when you press Start drive, use a nearby search, or add a post with a place. Your position is used to work out what is ahead of you. We do not keep a history of where you have been. If you choose to share your position with your trip group, your latest position is stored while you share, deleted when you stop, and nobody can see it after 6 hours even if you forget.",
        "Things you post: photos and videos, captions, the place and tags, comments, reports about a place, and feedback you send us.",
        "Choices and activity: likes, saves, follows, hides, blocks and notifications; and simple counters that limit how often something can be used (for example place searches per day).",
        "Technical data: a sign-in cookie, a small cookie with your time-zone offset (so trip days change at your midnight), your IP address and browser type as seen by our hosting provider, and error reports when something breaks (technical details only: never passwords).",
      ] },
      "We use this to run Trailmate (plan trips, show maps and routes, let you share with your group and in Discover), to keep it safe (limit abuse, handle reports), and to fix problems. We do not sell your data and we do not show ads.",
    ] },
    { id: "legal-basis", title: "Why we may use your data", body: [
      "We use your data because you asked us to run the service for you, and because you agree to this policy when you create an account. For location, we ask your browser to ask you each time. You can switch it off in your browser at any time; planning still works. You can withdraw consent by deleting your account (see Your choices).",
    ] },
    { id: "share", title: "Who can see it", body: [
      { list: [
        "Your trip group sees the trip, its stops, votes and (only if you opt in) your live position.",
        "Other people see what you choose to post to Discover. A public post shows your username, caption, photos or videos and the place. Exact coordinates of a post are shown at the precision you choose.",
        "Nobody else sees your email address.",
      ] },
    ] },
    { id: "providers", title: "Companies that help us run Trailmate", body: [
      "Trailmate is built on services from other companies. They receive only what is needed for their part:",
      { list: [
        "Supabase: our database, login and file storage (your account, trips, posts, photos and videos). Our database is hosted in Tokyo, Japan.",
        "Vercel: hosts the website and handles each request (it sees your IP address and the pages you open).",
        "OSRM (OpenStreetMap routing): receives the start and end coordinates of a route you ask for, to return road directions.",
        "Nominatim (OpenStreetMap search): receives the place name you type in search.",
        "Overpass (OpenStreetMap): receives the area you look at, to find nearby fuel, food and sights.",
        "Open-Meteo: receives the coordinates and dates of your stops to return weather.",
        "OpenFreeMap: delivers the map pictures; it sees your IP address and which part of the map you view.",
        "Wikipedia and Wikimedia: may be asked for a photo of a well-known place by its name and position.",
        "An AI provider (Google Gemini or Anthropic): only if you use Smart Import. The text or picture you paste is sent to the provider to find place names. Do not paste anything private.",
        "A message service (such as Discord or Slack) that receives short technical error alerts (no personal content).",
      ] },
      "Some of these companies are outside India, so your data is processed abroad. They act on our instructions or under their own published terms.",
    ] },
    { id: "keep", title: "How long we keep it", body: [
      { list: [
        "Your account data stays until you delete your account.",
        "Live position: deleted when you stop sharing; hidden from everyone after 6 hours.",
        "When you delete your account (Profile, then Delete my account) your profile, posts, photos and videos, comments, likes, votes, reports, feedback and live position are erased. A trip you own that other people are on is handed to the person who has been on it longest; a trip only you are on is deleted. Stops you added to a group's trip stay on that trip without your name.",
        "Our database provider may keep short-lived technical backups. Deleted data disappears from them when they expire.",
      ] },
    ] },
    { id: "rights", title: "Your choices and rights", body: [
      { list: [
        "See and download your data: Profile, then Download my data. You get a file with everything we hold about you.",
        "Correct it: edit your profile, trips and posts in the app.",
        "Delete it: Profile, then Delete my account. This is permanent.",
        "Turn location off: in your browser's site settings, at any time.",
        "Complain: contact us first. If you are in India you may also complain to the Data Protection Board of India under the Digital Personal Data Protection Act, 2023. We aim to follow that law.",
      ] },
    ] },
    { id: "children", title: "Age", body: [`Trailmate is for people aged ${MINIMUM_AGE} and over. We do not knowingly collect data from anyone younger. If you think a younger person has an account, contact us and we will delete it.`] },
    { id: "security", title: "Keeping your data safe", body: [
      "Everything travels over HTTPS. Every table in our database has rules that only let people see their own data or data shared with them, even if a bug in the app tried to ask for more. No system is perfectly safe; if we learn of a breach that affects you we will tell you and the authorities as the law requires.",
    ] },
    { id: "cookies", title: "Cookies", body: ["We use only cookies the site needs: your sign-in session and your time-zone offset. We do not use advertising or tracking cookies, so there is no cookie banner."] },
    { id: "changes", title: "Changes to this policy", body: [`We will update this page when things change and change the date at the top (this version: ${LEGAL_UPDATED_LABEL}). For big changes we will tell you in the app.`] },
  ];
}

export function termsSections(c: LegalContact): Section[] {
  return [
    { id: "agreement", title: "Agreement", body: [
      `These terms are between you and ${who(c)} ("we"). By creating an account or using Trailmate you agree to them and to our Privacy Policy. If you do not agree, please do not use Trailmate. You must be at least ${MINIMUM_AGE} years old.`,
    ] },
    { id: "beta", title: "Trailmate is an early test version", body: [
      "Trailmate is still being tested with a small group. It may have bugs, change, be interrupted, or stop. Please keep your own copy of anything important (you can download your data from your Profile). We do not promise it will always be available.",
    ] },
    { id: "account", title: "Your account", body: [
      "Give true information, keep your password private, and tell us if someone else uses your account. You are responsible for what happens under your account. You can delete your account at any time from your Profile.",
    ] },
    { id: "safety", title: "Road safety and the information we show", body: [
      "Drive safely and follow traffic laws. Do not use Trailmate while driving unless a passenger operates it or your phone is mounted and you only glance at it. Directions, arrival times, weather, season scores (\"Go score\"), nearby places and road reports are estimates from public data and other travellers. They can be wrong or out of date, and routes may include closed or unsuitable roads. Use your own judgment; we are not responsible for decisions you make based on them.",
    ] },
    { id: "content", title: "What you post", body: [
      "You own what you post. You give us permission to store it, show it to the people you chose (your trip group or, for public posts, other users) and process it (for example resize photos, check video length) so the service works. You promise you have the right to post it.",
      "Do not post anything illegal, hateful, harassing, sexual, violent or dangerous, anything that infringes someone's rights, spam, or other people's private information (including photos where someone can be identified without their consent). Do not misuse the service or try to break it.",
    ] },
    { id: "moderation", title: "Reports and removal", body: [
      "Anyone can report a post or a place update. A post reported by several people may be hidden automatically while we look at it. We may remove content and suspend or end accounts that break these terms, without notice where needed to protect people.",
    ] },
    { id: "sharing", title: "Sharing your location with a group", body: [
      "Sharing your live position with your trip group is always your choice, each drive. People on the trip can see it while you share. Only share with people you trust.",
    ] },
    { id: "third", title: "Other companies' services", body: [
      "Maps, routes, search, weather and photos come from other providers (listed in the Privacy Policy). They are provided as they are and can change or fail. Links to Google Maps open Google's own service under Google's terms.",
    ] },
    { id: "liability", title: "Our responsibility", body: [
      "Trailmate is provided \"as is\". To the fullest extent the law allows, we are not liable for indirect or consequential loss, for loss of data, or for anything that happens on a trip. Nothing in these terms limits liability that cannot be limited by law.",
    ] },
    { id: "law", title: "Law and disputes", body: [
      "These terms follow the laws of India. Courts in Hyderabad, Telangana have jurisdiction, unless the law gives you the right to go elsewhere. Please contact us first so we can try to sort it out.",
    ] },
    { id: "changes", title: "Changes and contact", body: [
      `We may change these terms and will change the date on this page (this version: ${LEGAL_UPDATED_LABEL}). If you keep using Trailmate after a change, you accept the new terms. Contact us ${how(c)}.`,
    ] },
  ];
}
