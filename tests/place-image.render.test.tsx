import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { SafeImg, forgetFailedImages } from "@/components/ui/SafeImg";
import { PlaceRow } from "@/components/intel/PlaceRow";
import type { PlacePhoto as Photo } from "@/lib/place-photos";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const photo: Photo = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fort.jpg/330px-Fort.jpg",
  srcSet: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fort.jpg/120px-Fort.jpg 120w, https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fort.jpg/330px-Fort.jpg 330w",
  width: 500, height: 300, title: "Fort", source: "wikipedia", pageUrl: "https://en.wikipedia.org/wiki/Fort",
  creditUrl: "https://commons.wikimedia.org/wiki/File:Fort.jpg", author: "Jane Doe", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
};

beforeEach(() => forgetFailedImages());

describe("<PlacePhoto> credit and delivery", () => {
  it("credits author AND licence, linking to the file page that shows the full terms", () => {
    const html = renderToStaticMarkup(<PlacePhoto photo={photo} name="Fort" credit fallback={<i>icon</i>} />);
    expect(html).toContain("Photo: Jane Doe, CC BY-SA 4.0");
    expect(html).toContain('href="https://commons.wikimedia.org/wiki/File:Fort.jpg"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("is honest when only a legacy photo (no licence data) is passed in: it says where it is from, nothing more", () => {
    const html = renderToStaticMarkup(<PlacePhoto photo={{ ...photo, licence: undefined, author: undefined, creditUrl: undefined }} name="Fort" credit fallback={<i>icon</i>} />);
    expect(html).toContain(">Wikipedia<");
    expect(html).not.toContain("CC BY");
  });
  it("sends right-sized files: srcset + sizes, lazy, async decode, fixed box, no referrer", () => {
    const html = renderToStaticMarkup(<PlacePhoto photo={photo} name="Fort" sizes="80px" fallback={<i>icon</i>} />);
    expect(html).toContain("120w");
    expect(html).toContain('sizes="80px"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('width="500"');
  });
  it("does not send `sizes` when there is no srcset (it would mean nothing)", () => {
    const html = renderToStaticMarkup(<SafeImg src="https://x/y.jpg" sizes="64px" alt="a" fallback={null} />);
    expect(html).not.toContain("sizes=");
  });
});

describe("<SafeImg> failure handling", () => {
  const mount = (el: React.ReactElement) => { let r!: TestRenderer.ReactTestRenderer; act(() => { r = TestRenderer.create(el, { createNodeMock: () => ({ complete: false, naturalWidth: 0 }) }); }); return r; };

  it("replaces a failed image with the fallback", () => {
    const r = mount(<SafeImg src="https://x/a.jpg" alt="A" fallback={<b>icon</b>} />);
    expect(r.root.findAllByType("img")).toHaveLength(1);
    act(() => { r.root.findByType("img").props.onError(); });
    expect(r.root.findAllByType("img")).toHaveLength(0);
    expect(r.root.findByType("b").children).toEqual(["icon"]);
  });
  it("remembers the failure for the session, so another card with the same photo does not flash a broken image", () => {
    const first = mount(<SafeImg src="https://x/same.jpg" alt="A" fallback={<b>icon</b>} />);
    act(() => { first.root.findByType("img").props.onError(); });
    const second = mount(<SafeImg src="https://x/same.jpg" alt="B" fallback={<b>icon</b>} />);
    expect(second.root.findAllByType("img")).toHaveLength(0);
  });
  it("a new src gets a fresh try", () => {
    const r = mount(<SafeImg src="https://x/one.jpg" alt="A" fallback={<b>icon</b>} />);
    act(() => { r.root.findByType("img").props.onError(); });
    act(() => { r.update(<SafeImg src="https://x/two.jpg" alt="A" fallback={<b>icon</b>} />); });
    expect(r.root.findAllByType("img")).toHaveLength(1);
  });
  it("catches an image that already failed before React could listen (server-rendered page)", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(<SafeImg src="https://x/early.jpg" alt="A" fallback={<b>icon</b>} />, { createNodeMock: () => ({ complete: true, naturalWidth: 0 }) }); });
    expect(r.root.findAllByType("img")).toHaveLength(0);
  });
  it("does NOT treat a still-loading or loaded image as failed", () => {
    for (const node of [{ complete: false, naturalWidth: 0 }, { complete: true, naturalWidth: 320 }]) {
      let r!: TestRenderer.ReactTestRenderer;
      forgetFailedImages();
      act(() => { r = TestRenderer.create(<SafeImg src="https://x/ok.jpg" alt="A" fallback={<b>icon</b>} />, { createNodeMock: () => node }); });
      expect(r.root.findAllByType("img")).toHaveLength(1);
    }
  });
  it("the credit disappears together with a failed photo (no credit for a picture that is not shown)", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(<PlacePhoto photo={photo} name="Fort" credit fallback={<b>icon</b>} />, { createNodeMock: () => ({ complete: false, naturalWidth: 0 }) }); });
    expect(r.root.findAllByType("a")).toHaveLength(1);
    act(() => { r.root.findByType("img").props.onError(); });
    expect(r.root.findAllByType("a")).toHaveLength(0);
    expect(r.root.findByType("b").children).toEqual(["icon"]);
  });
});

describe("list rows use the fallback too", () => {
  it("PlaceRow falls back to its category badge when the photo cannot load", () => {
    let r!: TestRenderer.ReactTestRenderer;
    const open = { state: "unknown" } as never;
    act(() => {
      r = TestRenderer.create(
        <PlaceRow kind="food" name="Sunset Dhaba" lat={17} lng={80} etaMin={5} aheadKm={3} detourMin={0} open={open} note={null} hours={null} fetchedAt={null as never}
          photo={{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Dhaba.jpg", source: "osm", creditUrl: "https://commons.wikimedia.org/wiki/File:Dhaba.jpg" }} />,
        { createNodeMock: () => ({ complete: false, naturalWidth: 0 }) },
      );
    });
    expect(r.root.findAllByType("img")).toHaveLength(1);
    act(() => { r.root.findByType("img").props.onError(); });
    expect(r.root.findAllByType("img")).toHaveLength(0);
  });
});
