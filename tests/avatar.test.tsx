// Optional profile pictures: only the person's own small square file can ever be used, the editor's maths keeps the crop inside the photo,
// the routes check ownership and existence and tidy up the old file, nothing changes when the person doesn't touch the picture, and the
// app's own logo (not the default Next.js / Vercel icon) is what browsers and link previews show.
import { createElement } from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_PATH_RE, avatarUrl, isOwnAvatarPath, newAvatarPath } from "@/lib/avatar";
import { MAX_ZOOM, clampCrop, cropRect, dragCrop } from "@/lib/avatar-crop";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FILE = "abcdef0123456789abcdef01";

describe("which pictures may be used", () => {
  it("only a small file with a random name inside the person's OWN folder", () => {
    expect(isOwnAvatarPath(`${ME}/${FILE}.webp`, ME)).toBe(true);
    expect(isOwnAvatarPath(`${ME}/${FILE}.jpg`, ME)).toBe(true);
    expect(isOwnAvatarPath(`${OTHER}/${FILE}.webp`, ME)).toBe(false);                 // someone else's folder
    for (const bad of [`${ME}/../${OTHER}/${FILE}.webp`, `${ME}/${FILE}.png`, `${ME}/x.webp`, `${ME}/${FILE}.webp/extra`, `${ME}${FILE}.webp`, "", null, 7, `${ME}/a b c d e f g h.webp`]) expect(isOwnAvatarPath(bad, ME)).toBe(false);
  });
  it("a new picture gets a new unguessable name every time, in the person's folder", () => {
    const a = newAvatarPath(ME), b = newAvatarPath(ME, "jpg");
    expect(a).not.toBe(b); expect(isOwnAvatarPath(a, ME)).toBe(true); expect(isOwnAvatarPath(b, ME)).toBe(true); expect(b.endsWith(".jpg")).toBe(true);
    expect(AVATAR_PATH_RE.test(a)).toBe(true);
  });
  it("the picture address is built only from a valid path, and is empty for none", () => {
    expect(avatarUrl(`${ME}/${FILE}.webp`, "https://abc.supabase.co")).toBe(`https://abc.supabase.co/storage/v1/object/public/avatars/${ME}/${FILE}.webp`);
    expect(avatarUrl(null, "https://abc.supabase.co")).toBeNull(); expect(avatarUrl("javascript:alert(1)", "https://abc.supabase.co")).toBeNull(); expect(avatarUrl(`${ME}/${FILE}.webp`, undefined)).toBeNull();
  });
});

describe("the editor's crop", () => {
  it("zoom 1 shows the largest centred square; zoom in shows less of it", () => {
    expect(cropRect(4000, 3000, { zoom: 1, cx: 0.5, cy: 0.5 })).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(cropRect(4000, 3000, { zoom: 2, cx: 0.5, cy: 0.5 })).toEqual({ sx: 1250, sy: 750, side: 1500 });
  });
  it("the square can never leave the photo, however far it is pushed", () => {
    const r = cropRect(4000, 3000, { zoom: 3, cx: 0, cy: 5 });
    expect(r.sx).toBeGreaterThanOrEqual(0); expect(r.sy + r.side).toBeLessThanOrEqual(3000); expect(r.sx + r.side).toBeLessThanOrEqual(4000);
    const c = clampCrop(4000, 3000, { zoom: 99, cx: -3, cy: 9 }); expect(c.zoom).toBe(MAX_ZOOM); expect(c.cx).toBeGreaterThan(0); expect(c.cy).toBeLessThan(1);
  });
  it("dragging moves the picture with the finger, and stops at the edge", () => {
    const start = { zoom: 2, cx: 0.5, cy: 0.5 };
    const left = dragCrop(4000, 3000, start, -50, 0, 272);              // finger moves left: the picture moves left, so we see more of the RIGHT
    expect(left.cx).toBeGreaterThan(0.5); expect(left.cy).toBe(0.5);
    const far = dragCrop(4000, 3000, start, -99999, 99999, 272); const r = cropRect(4000, 3000, far);
    expect(r.sx + r.side).toBeLessThanOrEqual(4000); expect(r.sy).toBeGreaterThanOrEqual(0);
  });
});

// ── The routes, against a small fake of the database and storage ──
type Row = Record<string, unknown>;
const fake = { user: { id: ME } as { id: string } | null, profile: null as Row | null, files: new Set<string>(), removed: [] as string[], updated: [] as Row[], metadata: [] as unknown[], upsert: [] as Row[], listFail: false };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: fake.user } }), updateUser: async (a: unknown) => { fake.metadata.push(a); return { data: {}, error: null }; } },
    storage: { from: () => ({
      list: async (folder: string, o: { search?: string }) => (fake.listFail ? { data: null, error: { message: "x" } } : { data: [...fake.files].filter((f) => f.startsWith(`${folder}/`)).map((f) => f.split("/")[1]).filter((n) => !o.search || n === o.search).map((name) => ({ name })), error: null }),
      remove: async (paths: string[]) => { fake.removed.push(...paths); return { error: null }; },
    }) },
    from: (t: string) => {
      if (t !== "profiles") throw new Error(t);
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, maybeSingle: async () => ({ data: fake.profile, error: null }),
        update: (r: Row) => ({ eq: async () => { fake.updated.push(r); fake.profile = { ...(fake.profile ?? {}), ...r }; return { error: null }; } }),
        upsert: async (r: Row) => { fake.upsert.push(r); fake.profile = { ...(fake.profile ?? {}), ...r }; return { error: null }; },
      };
      return b;
    },
  }),
}));
import { PATCH } from "@/app/api/profile/avatar/route";
import { PUT } from "@/app/api/profile/route";
const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
const mine = `${ME}/${FILE}.webp`;
const older = `${ME}/oldoldoldold0123456789ab.webp`;
let n = 0;

describe("PATCH /api/profile/avatar", () => {
  beforeEach(() => { fake.user = { id: `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}` }; fake.profile = { id: fake.user.id, avatar_path: null }; fake.files = new Set(); fake.removed = []; fake.updated = []; fake.metadata = []; fake.upsert = []; fake.listFail = false; });
  const own = (name = FILE) => `${fake.user!.id}/${name}.webp`;

  it("needs sign-in", async () => { fake.user = null; expect((await patch({ path: mine })).status).toBe(401); });
  it("refuses a picture that is not in the person's own folder, and one that never finished uploading", async () => {
    expect((await patch({ path: `${OTHER}/${FILE}.webp` })).status).toBe(400);
    expect((await patch({ path: "../../etc/passwd" })).status).toBe(400);
    expect((await patch({ path: own() })).status).toBe(400);                         // not in storage
    expect(fake.updated).toEqual([]);
  });
  it("needs a traveler profile first (a username), and says so", async () => {
    fake.files.add(own()); fake.profile = null;
    const r = await patch({ path: own() }); expect(r.status).toBe(409); expect((await r.json()).error).toContain("Create your traveler profile");
  });
  it("sets the picture, deletes the one it replaces, and remembers the path on the sign-in record", async () => {
    fake.files.add(own()); fake.files.add(own("oldoldoldold0123456789ab")); fake.profile = { id: fake.user!.id, avatar_path: own("oldoldoldold0123456789ab") };
    const r = await patch({ path: own() });
    expect(r.status).toBe(200); expect(fake.updated[0]).toMatchObject({ avatar_path: own() });
    expect(fake.removed).toEqual([own("oldoldoldold0123456789ab")]); expect(fake.metadata).toEqual([{ data: { avatar_path: own() } }]);
  });
  it("removing the picture clears it and deletes the file", async () => {
    fake.profile = { id: fake.user!.id, avatar_path: own() };
    expect((await patch({ path: null })).status).toBe(200);
    expect(fake.updated[0]).toMatchObject({ avatar_path: null }); expect(fake.removed).toEqual([own()]); expect(fake.metadata).toEqual([{ data: { avatar_path: null } }]);
  });
  it("a storage problem is a refusal, never a pretend success", async () => { fake.listFail = true; expect((await patch({ path: own() })).status).toBe(400); });
});

describe("PUT /api/profile and the picture", () => {
  beforeEach(() => { fake.user = { id: `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}` }; fake.profile = { id: fake.user.id, avatar_path: `${fake.user.id}/${FILE}.webp` }; fake.files = new Set(); fake.removed = []; fake.upsert = []; fake.metadata = []; fake.listFail = false; });
  const base = { username: "ravi_travels", interests: [] };
  it("a save that does not mention the picture leaves it exactly as it is", async () => {
    expect((await put(base)).status).toBe(200);
    expect("avatar_path" in fake.upsert[0]).toBe(false); expect(fake.removed).toEqual([]); expect(fake.metadata).toEqual([]);
  });
  it("null removes it; a real path of the person's own sets it (and deletes the old one)", async () => {
    const mineNow = `${fake.user!.id}/${FILE}.webp`, next = `${fake.user!.id}/newnewnewnew0123456789ab.webp`;
    fake.files.add(next);
    expect((await put({ ...base, avatar_path: next })).status).toBe(200);
    expect(fake.upsert[0]).toMatchObject({ avatar_path: next }); expect(fake.removed).toEqual([mineNow]);
    expect((await put({ ...base, avatar_path: null })).status).toBe(200);
    expect(fake.upsert[1]).toMatchObject({ avatar_path: null });
  });
  it("a path that is not theirs, or not there, saves nothing", async () => {
    expect((await put({ ...base, avatar_path: `${OTHER}/${FILE}.webp` })).status).toBe(400);
    expect((await put({ ...base, avatar_path: `${fake.user!.id}/newnewnewnew0123456789ab.webp` })).status).toBe(400);
    expect(fake.upsert).toEqual([]);
  });
});

// ── The picker, the profile form and the avatar mark ──
const flat = (x: ReactTestInstance | string): string => (typeof x === "string" ? x : x.children.map(flat).join(""));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {} }) }));
vi.mock("@/components/ui/Sheet", async () => { const { createElement: h } = await import("react"); return { PICKER_BUTTON: "picker-button", PickerSheet: ({ title, children, footer }: { title: string; children: unknown; footer?: unknown }) => h("div", { role: "dialog", "aria-label": title }, children as never, footer as never) }; });
const uploaded: { path: string; type: string }[] = []; const storageRemoved: string[] = []; const up = { error: null as { message: string } | null };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ upload: async (path: string, blob: Blob) => { if (!up.error) uploaded.push({ path, type: blob.type }); return { error: up.error }; }, remove: async (p: string[]) => { storageRemoved.push(...p); return { error: null }; } }) } }) }));
vi.mock("@/components/profile/AvatarEditor", async () => { const { createElement: h } = await import("react"); return { AvatarEditor: ({ onDone, onCancel }: { onDone: (r: unknown) => void; onCancel: () => void }) => h("div", null, h("button", { onClick: () => onDone({ blob: new Blob(["x"], { type: "image/webp" }), ext: "webp" }) }, "Use this photo"), h("button", { onClick: onCancel }, "Cancel")) }; });
import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { Avatar } from "@/components/ui/Avatar";
import { TravelerProfileForm } from "@/components/TravelerProfileForm";

describe("the picture control and the avatar mark", () => {
  it("without a picture it shows the initial and offers 'Add a photo' (optional); with one it offers Change and Remove", () => {
    const none = renderToStaticMarkup(createElement(AvatarPicker, { userId: ME, path: null, initial: "R", hasProfile: true, onChange: () => {} }));
    expect(none).toContain(">R<"); expect(none).toContain("Add a photo"); expect(none).toContain("(optional)"); expect(none).not.toContain("Remove"); expect(none).toContain("Add a profile photo");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    const some = renderToStaticMarkup(createElement(AvatarPicker, { userId: ME, path: mine, initial: "R", hasProfile: true, onChange: () => {} }));
    vi.unstubAllEnvs();
    expect(some).toContain("Change photo"); expect(some).toContain("Remove"); expect(some).toContain("Change profile photo"); expect(some).toContain("storage/v1/object/public/avatars/");
  });
  it("a picture that cannot load falls back to the initial, never a broken image", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { src: "https://x.example/a.webp", initial: "R", size: 40 }));
    expect(html).toContain("<img"); expect(html).toContain("rounded-full"); expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(createElement(Avatar, { src: null, initial: "R", size: 40 }))).toContain(">R<");
  });
  it("a file that is not a photo, or is huge, is refused with words, and nothing is uploaded", async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(AvatarPicker, { userId: ME, path: null, initial: "R", hasProfile: true, onChange: () => {} })); });
    const input = r.root.findByType("input");
    await act(async () => { input.props.onChange({ target: { files: [{ type: "application/pdf", size: 10 }], value: "" } }); });
    expect(flat(r.root)).toContain("Please choose a photo");
    await act(async () => { input.props.onChange({ target: { files: [{ type: "image/jpeg", size: 40 * 1024 * 1024 }], value: "" } }); });
    expect(flat(r.root)).toContain("too big"); expect(uploaded).toEqual([]);
    await act(async () => { r.unmount(); });
  });
  it("Remove (profile exists) asks the server to clear the picture and tells the form", async () => {
    refresh.mockClear();
    const calls: { url: string; body: unknown }[] = []; const changes: (string | null)[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: unknown, init?: RequestInit) => { calls.push({ url: String(u), body: JSON.parse(String(init?.body)) }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(AvatarPicker, { userId: ME, path: mine, initial: "R", hasProfile: true, onChange: (p) => changes.push(p) })); });
    await act(async () => { r.root.findAll((x) => x.type === "button" && flat(x) === "Remove")[0].props.onClick(); });
    expect(calls).toEqual([{ url: "/api/profile/avatar", body: { path: null } }]); expect(changes).toEqual([null]);
    expect(refresh).toHaveBeenCalledTimes(1);          // the menu and header are drawn by the server: they must show the change without a manual refresh
    globalThis.fetch = real; await act(async () => { r.unmount(); });
  });
  it("before the profile exists a removed picture is only held for the form (no request)", async () => {
    const real = globalThis.fetch; const fetched = vi.fn(); globalThis.fetch = fetched as unknown as typeof fetch; const changes: (string | null)[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(AvatarPicker, { userId: ME, path: mine, initial: "R", hasProfile: false, onChange: (p) => changes.push(p) })); });
    await act(async () => { r.root.findAll((x) => x.type === "button" && flat(x) === "Remove")[0].props.onClick(); });
    expect(fetched).not.toHaveBeenCalled(); expect(changes).toEqual([null]);
    globalThis.fetch = real; await act(async () => { r.unmount(); });
  });
});


describe("choosing and uploading a picture", () => {
  const pick = async (o: { hasProfile: boolean; onChange?: (p: string | null) => void }) => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(AvatarPicker, { userId: ME, path: null, initial: "R", hasProfile: o.hasProfile, onChange: o.onChange ?? (() => {}) })); });
    await act(async () => { r.root.findByType("input").props.onChange({ target: { files: [{ type: "image/jpeg", size: 2_000_000 }], value: "" } }); });
    return r;
  };
  const use = async (r: TestRenderer.ReactTestRenderer) => { await act(async () => { await r.root.findAll((x) => x.type === "button" && flat(x) === "Use this photo")[0].props.onClick(); }); for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); }); };
  beforeEach(() => { uploaded.length = 0; storageRemoved.length = 0; up.error = null; });

  it("picking a photo opens the editor, and nothing is uploaded until 'Use this photo'", async () => {
    const r = await pick({ hasProfile: true });
    expect(flat(r.root)).toContain("Use this photo"); expect(uploaded).toEqual([]);
    await act(async () => { r.root.findAll((x) => x.type === "button" && flat(x) === "Cancel")[0].props.onClick(); });
    expect(flat(r.root)).not.toContain("Use this photo"); expect(uploaded).toEqual([]);
    await act(async () => { r.unmount(); });
  });
  it("with a profile: one small file goes to the person's OWN folder, then the profile is pointed at it, then the form is told", async () => {
    const real = globalThis.fetch; const calls: unknown[] = [];
    globalThis.fetch = vi.fn(async (u: unknown, init?: RequestInit) => { calls.push([String(u), JSON.parse(String(init?.body))]); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const changes: (string | null)[] = []; const r = await pick({ hasProfile: true, onChange: (p) => changes.push(p) });
    await use(r);
    expect(uploaded).toHaveLength(1); expect(isOwnAvatarPath(uploaded[0].path, ME)).toBe(true); expect(uploaded[0].type).toBe("image/webp");
    expect(calls).toEqual([["/api/profile/avatar", { path: uploaded[0].path }]]); expect(changes).toEqual([uploaded[0].path]);
    expect(flat(r.root)).not.toContain("Use this photo");                         // the editor closed
    globalThis.fetch = real; await act(async () => { r.unmount(); });
  });
  it("without a profile yet it uploads and hands the path to the form, with no request to the server", async () => {
    const real = globalThis.fetch; const fetched = vi.fn(); globalThis.fetch = fetched as unknown as typeof fetch;
    const changes: (string | null)[] = []; const r = await pick({ hasProfile: false, onChange: (p) => changes.push(p) });
    await use(r);
    expect(uploaded).toHaveLength(1); expect(fetched).not.toHaveBeenCalled(); expect(changes).toEqual([uploaded[0].path]);
    globalThis.fetch = real; await act(async () => { r.unmount(); });
  });
  it("if the server refuses, the file is taken back out of storage and the person is told why", async () => {
    const real = globalThis.fetch; globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Too many changes." }), { status: 429 })) as unknown as typeof fetch;
    const changes: (string | null)[] = []; const r = await pick({ hasProfile: true, onChange: (p) => changes.push(p) });
    await use(r);
    expect(storageRemoved).toEqual([uploaded[0].path]); expect(changes).toEqual([]); expect(flat(r.root)).toContain("Too many changes.");
    globalThis.fetch = real; await act(async () => { r.unmount(); });
  });
  it("when profile pictures are not switched on yet (no bucket) it says so kindly, and nothing is changed", async () => {
    up.error = { message: "Bucket not found" }; const changes: (string | null)[] = []; const r = await pick({ hasProfile: true, onChange: (p) => changes.push(p) });
    await use(r);
    expect(flat(r.root)).toContain("aren't switched on yet"); expect(changes).toEqual([]);
    await act(async () => { r.unmount(); });
  });
});

describe("the profile form", () => {
  const initial = { username: "ravi", display_name: "Ravi", bio: "Hills", interests: ["beaches"], is_private: false, show_follow_lists: true, avatar_path: null };
  const mount = async (o: Partial<Parameters<typeof TravelerProfileForm>[0]> = {}) => { let r!: TestRenderer.ReactTestRenderer; await act(async () => { r = TestRenderer.create(createElement(TravelerProfileForm, { initial, userId: ME, ...o })); }); return r; };
  it("has an icon-led field for each thing, tap-to-add interests, privacy rows and one clear Save", async () => {
    const r = await mount(); const t = flat(r.root);
    for (const w of ["Your traveler profile", "Username", "Name", "About you", "Travel interests", "Privacy", "Private profile", "Save profile", "Profile photo"]) expect(t).toContain(w);
    expect(r.root.findAll((x) => x.type === "input" && x.props.type === "checkbox")).toHaveLength(2);
    await act(async () => { r.unmount(); });
  });
  it("interest chips add and remove words from the list", async () => {
    const r = await mount(); const field = () => r.root.findAll((x) => x.type === "input" && x.props.placeholder?.startsWith("road trips"))[0];
    await act(async () => { r.root.findAll((x) => x.type === "button" && flat(x) === "food")[0].props.onClick(); });
    expect(field().props.value).toBe("beaches, food");
    await act(async () => { r.root.findAll((x) => x.type === "button" && flat(x) === "beaches")[0].props.onClick(); });
    expect(field().props.value).toBe("food");
    await act(async () => { r.unmount(); });
  });
  it("saving without touching the picture does not send it (so it can never be wiped by accident)", async () => {
    const bodies: Record<string, unknown>[] = []; const real = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const r = await mount({ initial: { ...initial, avatar_path: mine } });
    await act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect("avatar_path" in bodies[0]).toBe(false); expect(bodies[0]).toMatchObject({ username: "ravi", interests: ["beaches"] });
    expect(flat(r.root)).toContain("Saved. Your profile is up to date.");
    globalThis.fetch = real; await act(async () => { r.unmount(); });
  });
  it("a new person (no profile yet) is told it is optional and that nothing is public until they do this", async () => {
    const r = await mount({ initial: null }); const t = flat(r.root);
    expect(t).toContain("Create your traveler profile"); expect(t).toContain("nothing about you is public"); expect(t).toContain("Create traveler profile");
    await act(async () => { r.unmount(); });
  });
});

describe("the app's own logo", () => {
  it("the favicon is Trailmate's mark (three sizes), not the default Next.js / Vercel icon", () => {
    const ico = readFileSync("app/favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1); expect(ico.readUInt16LE(4)).toBe(3);        // an .ico with three pictures
    expect(statSync("app/favicon.ico").size).not.toBe(25931);                       // the size of the default icon
    const svg = readFileSync("app/icon.svg", "utf8"); expect(svg).toContain("#E8A33D"); expect(svg).toContain("#0B3D3A");
  });
  it("the link preview image carries the mark and the name", () => {
    const src = readFileSync("app/opengraph-image.tsx", "utf8"); expect(src).toContain("#E8A33D"); expect(src).toContain("Trailmate"); expect(src).toContain("<svg");
  });
});
