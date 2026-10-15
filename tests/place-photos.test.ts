import { describe, expect, it } from "vitest";
import { identity, matchTitle, pickIdentity, pickPage, type PageCandidate } from "@/lib/place-photos/match";

const thumb = { url: "https://upload.wikimedia.org/x/480px-a.jpg", width: 480, height: 320 };
const page = (title: string, lat: number, lng: number, t: PageCandidate["thumb"] = thumb): PageCandidate => ({ title, lat, lng, thumb: t });

describe("identity: what a name actually identifies", () => {
  it("separates the kind of place from its name and ignores honorifics", () => {
    const i = identity("Sri Kanaka Durga Temple");
    expect([...i.sig].sort()).toEqual(["durga", "kanaka"]);
    expect([...i.types]).toEqual(["temple"]);
    expect(identity("Kollipara Waterfalls").types.has("falls")).toBe(true);
    expect(identity("Hotel Évora (Goa)").sig.has("evora")).toBe(true); // accents folded, qualifier dropped
  });
});

describe("matchTitle: is this page ABOUT this place?", () => {
  it("accepts the same place under normal spelling differences", () => {
    expect(matchTitle("Kanaka Durga Temple", "Kanaka Durga Temple")).not.toBeNull();
    expect(matchTitle("Undavalli Caves", "Undavalli Caves")).not.toBeNull();
    expect(matchTitle("Sri Kanaka Durga Temple", "Kanaka Durga Temple")).not.toBeNull();
    expect(matchTitle("Dudhsagar Waterfall", "Dudhsagar Falls")).not.toBeNull(); // waterfall == falls
  });
  it("rejects different places, even close ones", () => {
    expect(matchTitle("Kondapalli Fort", "Undavalli Caves")).toBeNull();
    expect(matchTitle("Kanaka Durga Temple", "Kanaka Durga Fort")).toBeNull(); // temple is not the fort beside it
    expect(matchTitle("Matheran Hill Station", "Lonavala")).toBeNull();
  });
  it("rejects names that identify nothing", () => {
    expect(matchTitle("Restroom", "Restroom")).toBeNull();
    expect(matchTitle("Beach", "Beach")).toBeNull();
    expect(matchTitle("Temple", "Kanaka Durga Temple")).toBeNull();
    expect(matchTitle("Om Temple", "Om Temple")).toBeNull(); // too short to trust
  });
  it("never uses disambiguation or list pages", () => {
    expect(matchTitle("Vijayawada", "Vijayawada (disambiguation)")).toBeNull();
    expect(matchTitle("Vijayawada Temples", "List of temples in Vijayawada")).toBeNull();
  });
  it("marks a bare-name page (the village) as weaker than the place itself", () => {
    expect(matchTitle("Kondapalli Fort", "Kondapalli")?.bareTitle).toBe(true);
    expect(matchTitle("Kondapalli Fort", "Kondapalli Fort")?.bareTitle).toBe(false);
  });
});

describe("pickPage: name AND location must agree", () => {
  const fort = { name: "Kondapalli Fort", lat: 16.62, lng: 80.54 };
  it("takes the page that is this place and near it", () => {
    const got = pickPage(fort, [page("Undavalli Caves", 16.497, 80.582), page("Kondapalli Fort", 16.621, 80.541)]);
    expect(got?.title).toBe("Kondapalli Fort");
  });
  it("rejects a right-named page that is far from where we located the place", () => {
    expect(pickPage(fort, [page("Kondapalli Fort", 17.5, 78.4)])).toBeNull(); // same name, another part of the state
  });
  it("accepts a bare village page only when it is practically the same spot", () => {
    expect(pickPage(fort, [page("Kondapalli", 16.9, 80.54)])).toBeNull();
    expect(pickPage(fort, [page("Kondapalli", 16.622, 80.541)])?.title).toBe("Kondapalli");
  });
  it("prefers the exact page over a bare one, and the closer of equals", () => {
    expect(pickPage(fort, [page("Kondapalli", 16.62, 80.54), page("Kondapalli Fort", 16.63, 80.55)])?.title).toBe("Kondapalli Fort");
  });
  it("skips pages without a usable photo", () => {
    expect(pickPage(fort, [page("Kondapalli Fort", 16.62, 80.54, null)])).toBeNull();
  });
});

describe("pickIdentity: name AND location, independent of whether a thumbnail exists", () => {
  const fort = { name: "Kondapalli Fort", lat: 16.62, lng: 80.54 };
  it("picks the right page even with no photo on it (the photo is chosen separately now)", () => {
    expect(pickIdentity(fort, [{ title: "Undavalli Caves", lat: 16.497, lng: 80.582 }, { title: "Kondapalli Fort", lat: 16.621, lng: 80.541 }])?.title).toBe("Kondapalli Fort");
  });
  it("still refuses a same-named page in another part of the state, and a village far from the pin", () => {
    expect(pickIdentity(fort, [{ title: "Kondapalli Fort", lat: 17.5, lng: 78.4 }])).toBeNull();
    expect(pickIdentity(fort, [{ title: "Kondapalli", lat: 16.9, lng: 80.54 }])).toBeNull();
  });
});
