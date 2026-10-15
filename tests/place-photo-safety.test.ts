import { describe, expect, it } from "vitest";
import { commonsFilePage, creditText, freeLicenceName, isFreeLicence, licenceFromCode, looksNotAPhoto, parseCommonsUrl, safeLicenceUrl, sanitizeCredit, thumbSet, THUMB_WIDTHS } from "@/lib/place-photos/safety";

const thumb = (file = "Kondapalli_Fort.jpg", w = 500) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/${w}px-${file}`;

describe("parseCommonsUrl: Commons-hosted raster images only", () => {
  it("accepts a pre-sized thumbnail and an original", () => {
    expect(parseCommonsUrl(thumb())).toMatchObject({ file: "Kondapalli_Fort.jpg", width: 500, hash1: "a", hash2: "ab" });
    expect(parseCommonsUrl("https://upload.wikimedia.org/wikipedia/commons/a/ab/Kondapalli_Fort.JPG")).toMatchObject({ width: null });
    expect(parseCommonsUrl(thumb("Fort%20gate.webp"))?.file).toBe("Fort gate.webp"); // decoded for matching, raw kept for URLs
  });
  it.each([
    ["another wiki's local upload (can be non-free)", "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/F.jpg/500px-F.jpg"],
    ["http", "http://upload.wikimedia.org/wikipedia/commons/a/ab/F.jpg"],
    ["another host", "https://evil.example/wikipedia/commons/a/ab/F.jpg"],
    ["userinfo trick", "https://upload.wikimedia.org@evil.example/wikipedia/commons/a/ab/F.jpg"],
    ["a port", "https://upload.wikimedia.org:8443/wikipedia/commons/a/ab/F.jpg"],
    ["svg", "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.svg/500px-F.svg.png"],
    ["tiff/pdf/video", "https://upload.wikimedia.org/wikipedia/commons/a/ab/F.tif"],
    ["hash folders that do not match", "https://upload.wikimedia.org/wikipedia/commons/z/zz/F.jpg"],
    ["hash folders that disagree", "https://upload.wikimedia.org/wikipedia/commons/a/bc/F.jpg"],
    ["extra path segments", "https://upload.wikimedia.org/wikipedia/commons/a/ab/x/F.jpg"],
    ["a thumbnail without a size", "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/F.jpg"],
    ["not a URL", "javascript:alert(1)"],
    ["a broken escape", "https://upload.wikimedia.org/wikipedia/commons/a/ab/%E0%A4%A.jpg"],
  ])("rejects %s", (_n, url) => expect(parseCommonsUrl(url)).toBeNull());
});

describe("looksNotAPhoto: maps, flags, seals, logos and diagrams are not photos of a place", () => {
  it.each(["Telangana_locator_map.png", "Flag_of_India.png", "Emblem of Telangana.png", "Coat_of_arms_of_X.png", "Fort floor plan.jpg", "Temple_logo.png", "District-map-2020.png", "Mapa_de_Goa.jpg", "Seal_of_Karnataka.png"])("rejects %s", (f) => expect(looksNotAPhoto(f)).toBe(true));
  it.each(["Kondapalli_Fort.jpg", "Planetarium_Hyderabad.jpg", "Mapusa_market.jpg", "Flagstaff_hill.jpg", "Dudhsagar Falls 2019.jpg", "Temple_sculpture_relief.jpg", "Charminar_at_night.JPG"])("keeps %s (whole words only)", (f) => expect(looksNotAPhoto(f)).toBe(false));
});

describe("isFreeLicence: narrow allow-list", () => {
  it.each(["CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 2.0 DE", "CC0 1.0", "CC-BY-SA-4.0", "Public domain", "PD-old-70", "PDM 1.0"])("accepts %s", (l) => expect(isFreeLicence(l)).toBe(true));
  it.each(["CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "Fair use", "All rights reserved", "GFDL", "", "  ", undefined, null, "x".repeat(80)])("rejects %s", (l) => expect(isFreeLicence(l as string)).toBe(false));
});

describe("sanitizeCredit: third-party HTML becomes short plain text", () => {
  it("strips markup, decodes entities, collapses whitespace", () => {
    expect(sanitizeCredit('<a href="//commons.wikimedia.org/wiki/User:J">Jane &amp; Co</a>')).toBe("Jane & Co");
    expect(sanitizeCredit("  A\n\n  B  ")).toBe("A B");
    expect(sanitizeCredit("Caf&#233; &#x41;")).toBe("Café A");
  });
  it("never lets markup or scripts through", () => {
    const out = sanitizeCredit('<script>alert(1)</script><img src=x onerror=alert(1)>Bob &lt;b&gt;') as string;
    expect(out).toBe("Bob b");
    expect(out).not.toMatch(/[<>]/);
  });
  it("is null for nothing, clips long text, ignores non-strings", () => {
    expect(sanitizeCredit("<br>")).toBeNull();
    expect(sanitizeCredit(undefined)).toBeNull();
    expect(sanitizeCredit(42)).toBeNull();
    expect((sanitizeCredit("x".repeat(500), 40) as string).length).toBeLessThanOrEqual(40);
  });
});

describe("licence / credit links and text", () => {
  it("keeps only Creative Commons licence links", () => {
    expect(safeLicenceUrl("https://creativecommons.org/licenses/by-sa/4.0")).toBe("https://creativecommons.org/licenses/by-sa/4.0");
    expect(safeLicenceUrl("//creativecommons.org/licenses/by/4.0/")).toContain("creativecommons.org");
    expect(safeLicenceUrl("https://evil.example/by")).toBeNull();
    expect(safeLicenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeLicenceUrl(undefined)).toBeNull();
  });
  it("builds the file-page URL in one place and encodes it", () => {
    expect(commonsFilePage("Fort gate #1.jpg")).toBe("https://commons.wikimedia.org/wiki/File:Fort_gate_%231.jpg");
  });
  it("credit text names author and licence, honestly falling back when the author is unknown", () => {
    expect(creditText({ author: "Jane Doe", licence: "CC BY-SA 4.0" })).toBe("Photo: Jane Doe, CC BY-SA 4.0");
    expect(creditText({ author: null, licence: "CC0 1.0" })).toBe("Photo: Wikimedia Commons, CC0 1.0");
  });
});

describe("thumbSet: right-sized files, never upscaled, never from an unaccepted URL", () => {
  it("offers only standard widths not larger than the delivered thumbnail", () => {
    const s = thumbSet(thumb("A.jpg", 500))!;
    expect(s.srcSet!.split(", ").map((x) => Number(x.split(" ")[1].replace("w", "")))).toEqual([...THUMB_WIDTHS]);
    const small = thumbSet(thumb("A.jpg", 260))!;
    expect(small.srcSet).not.toContain("330w");
    expect(small.srcSet).toContain("250w");
  });
  it("every generated URL is itself an accepted Commons URL for the same file", () => {
    for (const part of thumbSet(thumb("Fort%20gate.jpg", 500))!.srcSet!.split(", ")) {
      expect(parseCommonsUrl(part.split(" ")[0])).toMatchObject({ file: "Fort gate.jpg" });
    }
  });
  it("prefers 330 px as the single fallback size when available", () => {
    expect(thumbSet(thumb("A.jpg", 500))!.src).toContain("/330px-");
    expect(thumbSet(thumb("A.jpg", 250))!.src).toContain("/250px-");
  });
  it("tiny images and originals get no srcset; foreign URLs get nothing at all", () => {
    expect(thumbSet(thumb("A.jpg", 100))).toEqual({ src: thumb("A.jpg", 100), srcSet: null });
    const orig = "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg";
    expect(thumbSet(orig)).toEqual({ src: orig, srcSet: null });
    expect(thumbSet("https://evil.example/x.jpg")).toBeNull();
    expect(thumbSet("https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/A.jpg/500px-A.jpg")).toBeNull();
  });
});

describe("freeLicenceName: Commons often offers ALTERNATIVE licences; one acceptable alternative is enough", () => {
  it.each([
    ["CC BY-SA 3.0, GFDL", "CC BY-SA 3.0"], ["GFDL 1.2 or later / CC BY-SA 3.0", "CC BY-SA 3.0"], ["CC BY-SA 3.0, 2.5, 2.0, 1.0", "CC BY-SA 3.0"],
    ["GFDL; CC BY 2.5", "CC BY 2.5"], ["CC BY-SA 4.0", "CC BY-SA 4.0"], ["Public domain", "Public domain"], ["CC0 1.0", "CC0 1.0"], ["CC BY-SA 3.0 IGO", "CC BY-SA 3.0 IGO"],
  ])("%s → %s", (input, shown) => expect(freeLicenceName(input)).toBe(shown));
  it.each(["GFDL 1.2", "GFDL, CC BY-NC 3.0", "CC BY-NC-SA 4.0", "CC BY-SA 3.0 and CC BY-NC 3.0", "CC BY-SA 3.0 & GFDL", "Fair use", "", undefined, null, "x, ".repeat(60)])(
    "never accepts %s (\"and\" means BOTH apply, so one acceptable half proves nothing)", (l) => expect(freeLicenceName(l as string)).toBeNull());
  it("isFreeLicence agrees with it", () => { expect(isFreeLicence("CC BY-SA 3.0, GFDL")).toBe(true); expect(isFreeLicence("GFDL")).toBe(false); });
});

describe("licenceFromCode: the machine-readable code is a second opinion", () => {
  it.each([["cc-by-sa-4.0", "CC BY-SA 4.0"], ["cc-by-3.0", "CC BY 3.0"], ["cc-by-sa-3.0-igo", "CC BY-SA 3.0"], ["cc-zero", "CC0"], ["pd", "Public domain"], ["pd-old-70", "Public domain"]])("%s → %s", (c, shown) => expect(licenceFromCode(c)).toBe(shown));
  it.each(["gfdl", "cc-by-nc-4.0", "cc-by-nd-2.0", "fairuse", "", undefined, null])("rejects %s", (c) => expect(licenceFromCode(c as string)).toBeNull());
});
