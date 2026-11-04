// What the landing page says. Every claim here is true of the product as built, and the numbers are read from the product itself where
// they can be (regions, kinds of place, researched places). Nothing is invented: no ratings, reviews, user counts or testimonials.
import seasonData from "@/data/season-tags.json";
import { EXPLORE_CATEGORIES } from "@/lib/explore/categories";
import { REGIONS } from "@/lib/explore/regions";

/** Places in our own catalogue (OpenStreetMap + Wikidata, loaded 29 Oct 2026: 87,997). Shown rounded DOWN (so "87,000+" is always true). */
export const CATALOGUE_PLACES = 87_000;
const researched = (seasonData as { places: { confidence: string }[] }).places.filter((p) => p.confidence === "researched").length;

export const STATS = [
  { to: CATALOGUE_PLACES, suffix: "+", label: "places to discover", note: "forts, temples, falls, beaches and more" },
  { to: REGIONS.length, suffix: "", label: "states & union territories", note: "all of India, not a handful of cities" },
  { to: EXPLORE_CATEGORIES.length, suffix: "", label: "kinds of places", note: "from waterfalls to heritage sites" },
  { to: 6, suffix: " yrs", label: "of weather history", note: "behind each month's picks" },
] as const;
export const RESEARCHED_PLACES = researched;

/** Famous places shown with their real, credited Wikipedia photos. Position + name are what the photo lookup must agree with. */
export const DESTINATIONS = [
  { key: "hampi", name: "Virupaksha Temple", where: "Hampi, Karnataka", kind: "Temples", lat: 15.335, lng: 76.46 },
  { key: "taj", name: "Taj Mahal", where: "Agra, Uttar Pradesh", kind: "Heritage", lat: 27.1751, lng: 78.0421 },
  { key: "jaisalmer", name: "Jaisalmer Fort", where: "Jaisalmer, Rajasthan", kind: "Forts", lat: 26.9124, lng: 70.9126 },
  { key: "golden", name: "Golden Temple", where: "Amritsar, Punjab", kind: "Temples", lat: 31.62, lng: 74.8765 },
  { key: "konark", name: "Konark Sun Temple", where: "Konark, Odisha", kind: "Heritage", lat: 19.8876, lng: 86.0945 },
  { key: "meenakshi", name: "Meenakshi Temple", where: "Madurai, Tamil Nadu", kind: "Temples", lat: 9.9195, lng: 78.1193 },
  { key: "mysore", name: "Mysore Palace", where: "Mysuru, Karnataka", kind: "Heritage", lat: 12.3052, lng: 76.6552 },
  { key: "gateway", name: "Gateway of India", where: "Mumbai, Maharashtra", kind: "Heritage", lat: 18.922, lng: 72.8347 },
] as const;

export const KIND_STRIP = ["Forts & palaces", "Temples & religious sites", "Waterfalls", "Beaches", "Wildlife & parks", "Lakes & dams", "Museums & caves", "Viewpoints", "Heritage & monuments", "Hills & peaks"] as const;

export const FEATURES = [
  { glyph: "compass", title: "Explore all of India", body: "Search any town or pick a state: forts, temples, waterfalls, beaches and more, well-known places first, each with its source and the date of its data." },
  { glyph: "sun", title: "Best in the month you travel", body: "Picks change with where you are and the month you choose, from the typical weather there. The numbers are shown, so you can judge for yourself." },
  { glyph: "navigate", title: "Plans the route, not just a list", body: "Drop in places from reels and links. Trailmate orders them along a sensible road and spreads them over your days, with the drive time between stops." },
  { glyph: "rain", title: "Weather at the hour you'll arrive", body: "See the forecast for each stop at the time you'd actually be there, and get a calm heads-up when rain, heat or fog could spoil it." },
  { glyph: "chat", title: "One plan for the whole group", body: "Share one invite link. Everyone sees the same itinerary. Only the owner approves changes, and confirmed bookings are never moved." },
  { glyph: "check", title: "A companion on the road", body: "Start your trip, add an unplanned stop, finish stops as you go. If you run late, it offers options and explains them; it never changes your plan on its own." },
] as const;

export const STEPS = [
  { title: "Find places worth going to", body: "Explore by state, by town, or by the kind of place. Or paste the reel that inspired the trip." },
  { title: "See when each one is at its best", body: "Every pick shows the month's typical weather. Places with researched season notes say so and link their source." },
  { title: "Get a route you can follow", body: "Days, drive times and an order that makes sense. Tweak it, share it, then follow it live." },
] as const;

export const TRUST = [
  { title: "Real data, with sources", body: "Places come from OpenStreetMap and Wikidata and say where and when. Photos are from Wikimedia Commons with the author and licence." },
  { title: "No made-up ratings", body: "We show no star ratings, crowd levels or prices we can't source. If we don't know something, we say so." },
  { title: "Your location stays yours", body: "Asked only when you tap. We keep how accurate a reading was, never a trail of where you went." },
  { title: "You stay in control", body: "Nothing in your plan changes unless you approve it. Late start or missed day? You get options and what each one does." },
] as const;

export const FAQ = [
  { q: "Is Trailmate free?", a: "It is free to start. You can create an account and plan your first trip in about a minute." },
  { q: "Which places does it cover?", a: `All ${REGIONS.length} states and union territories. Our place list holds about ${CATALOGUE_PLACES.toLocaleString("en-IN")} places from OpenStreetMap and Wikidata. Famous places are well covered; very small ones may be missing, and we say so rather than pretend.` },
  { q: "Where do the 'best month' picks come from?", a: `From the typical weather for that month where each place is (six past years), matched to the kind of place: a waterfall wants rain, a beach wants warm and dry. For ${RESEARCHED_PLACES} places in Andhra Pradesh and Telangana we also hold hand-researched season notes with their sources, shown first and marked Researched.` },
  { q: "Does it track my location?", a: "Only when you ask. It uses your position to show the distance to your next stop and to notice arrivals, and keeps how accurate the reading was, never a trail of where you went. Starting a trip works without location too." },
  { q: "Can my group use it together?", a: "Yes. Share one invite link on WhatsApp. Everyone sees the same plan. Members can suggest changes; the trip owner decides." },
  { q: "What if I have no signal?", a: "Things you tell the app on the road (leaving, arriving, an unplanned stop) are saved on your phone with the time you tapped, and sent when you're back online." },
  { q: "Will it change my plan by itself?", a: "No. If you start late or miss a day it explains what happened and offers options. Your plan only changes when you approve one." },
] as const;
