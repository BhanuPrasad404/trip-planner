// "Download my data" and "Delete my account" — the logic, kept apart from the routes so it can be tested.
// Everything runs as the signed-in person (their own session), so Row Level Security stays the boundary: this code can only
// read what that person may read and only delete what that person may delete.
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring";
import { REPORT_PHOTO_BUCKET } from "@/lib/reports";
import { POST_MEDIA_BUCKET } from "@/lib/social/media";

export const EXPORT_ROW_LIMIT = 5000;
export const EXPORT_FORMAT_VERSION = 1;
export const SIGNED_URL_SECONDS = 3600;

type Row = Record<string, unknown>;
type Query = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

export type AccountExport = {
  readme: string;
  format_version: number;
  exported_at: string;
  account: { id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null; terms_version: unknown; terms_accepted_at: unknown };
  warnings: string[];
  sections: Record<string, Row[]>;
  files: { bucket: string; path: string; temporary_link: string | null }[];
};

const README =
  "This file contains the data Trailmate holds about you: your account, profile, the trips you belong to (including their stops), " +
  "your votes, posts, comments, likes, saves, reports, feedback, follows, blocks and notifications, your journey history (when you left, paused or arrived) and the bookings you entered, and links to the photos and " +
  "videos you uploaded. Links in 'files' stop working after one hour; download the files you want to keep. Other people's " +
  "names and emails are not included. It is JSON: any text editor can open it.";

/** Everything the signed-in person owns or belongs to, as plain data. A section that fails is reported in `warnings`, not fatal. */
export async function buildAccountExport(supabase: SupabaseClient, user: User, now: Date = new Date()): Promise<AccountExport> {
  const uid = user.id;
  const warnings: string[] = [];
  const sections: Record<string, Row[]> = {};

  /** A table that may not exist yet (its migration not applied) is simply empty: that is not something to warn the person about. */
  const notThereYet = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(e.message ?? "");
  const run = async (name: string, q: Query, optional = false): Promise<Row[]> => {
    try {
      const { data, error } = await q;
      if (error && optional && notThereYet(error)) return [];
      if (error) { warnings.push(`${name}: could not be read (${error.message})`); return []; }
      const rows = (data ?? []) as Row[];
      if (rows.length >= EXPORT_ROW_LIMIT) warnings.push(`${name}: only the first ${EXPORT_ROW_LIMIT} rows are included`);
      return rows;
    } catch (e) {
      warnings.push(`${name}: could not be read (${e instanceof Error ? e.message : "error"})`);
      return [];
    }
  };
  const mine = (table: string, column: string, select = "*") => supabase.from(table).select(select).eq(column, uid).limit(EXPORT_ROW_LIMIT) as unknown as Query;

  // Wave 1: everything that only needs my id.
  const [profile, trips, memberships, votes, reports, reportFlags, feedback, posts, comments, likes, saves, helpful, tripAdds, postReports, following, blocks, hides, notifications, live, journeyEvents, bookings] = await Promise.all([
    run("profile", mine("profiles", "id")),
    run("trips", supabase.from("trips").select("*").limit(EXPORT_ROW_LIMIT) as unknown as Query), // Row Level Security returns only trips I own or belong to
    run("trip_memberships", mine("trip_members", "user_id")),
    run("place_votes", mine("place_votes", "user_id")),
    run("place_reports", mine("place_reports", "user_id")),
    run("report_flags", mine("report_flags", "user_id")),
    run("feedback", mine("feedback", "user_id")),
    run("posts", mine("posts", "author_id")),
    run("post_comments", mine("post_comments", "author_id")),
    run("post_likes", mine("post_likes", "user_id")),
    run("post_saves", mine("post_saves", "user_id")),
    run("post_helpful", mine("post_helpful", "user_id")),
    run("post_trip_adds", mine("post_trip_adds", "user_id")),
    run("post_reports_i_made", mine("post_reports", "reporter_id")),
    run("people_i_follow", mine("follows", "follower_id", "followee_id, status, created_at")),
    run("people_i_blocked", mine("user_blocks", "blocker_id", "blocked_id, created_at")),
    run("feed_hides", mine("feed_hides", "user_id")),
    run("notifications", mine("notifications", "user_id")),
    run("live_location", mine("live_locations", "user_id")),
    run("journey_events", mine("trip_events", "user_id"), true),          // when I left, paused, arrived, corrections (no coordinates are ever kept)
    run("bookings_i_entered", mine("trip_commitments", "created_by"), true),
  ]);

  // Wave 2: things that hang off the first results.
  const tripIds = trips.map((t) => String(t.id));
  const postIds = posts.map((p) => String(p.id));
  const [places, postMedia] = await Promise.all([
    tripIds.length ? run("trip_stops", supabase.from("places").select("*").in("trip_id", tripIds).limit(EXPORT_ROW_LIMIT) as unknown as Query) : Promise.resolve([] as Row[]),
    postIds.length ? run("post_media", supabase.from("post_media").select("*").in("post_id", postIds).limit(EXPORT_ROW_LIMIT) as unknown as Query) : Promise.resolve([] as Row[]),
  ]);

  Object.assign(sections, {
    profile,
    trips: trips.map((t) => ({ ...t, my_role: t.owner_id === uid ? "owner" : "member" })),
    trip_stops: places,
    trip_memberships: memberships,
    place_votes: votes,
    place_reports: reports,
    report_flags: reportFlags,
    feedback,
    posts,
    post_media: postMedia,
    post_comments: comments,
    post_likes: likes,
    post_saves: saves,
    post_helpful: helpful,
    post_trip_adds: tripAdds,
    post_reports_i_made: postReports,
    people_i_follow: following,
    people_i_blocked: blocks,
    feed_hides: hides,
    notifications,
    live_location: live,
    ...(journeyEvents.length ? { journey_events: journeyEvents } : {}),
    ...(bookings.length ? { bookings_i_entered: bookings } : {}),
  });

  // Links to the files I uploaded (valid for an hour). Only paths inside my own folder are ever included.
  const own = (p: unknown): p is string => typeof p === "string" && p.startsWith(`${uid}/`);
  const mediaPaths = [...new Set(postMedia.flatMap((m) => [m.storage_path, m.poster_path]).filter(own))].slice(0, 200);
  const photoPaths = [...new Set(reports.map((r) => r.photo_path).filter(own))].slice(0, 200);
  const files: AccountExport["files"] = [];
  for (const [bucket, paths] of [[POST_MEDIA_BUCKET, mediaPaths], [REPORT_PHOTO_BUCKET, photoPaths]] as const) {
    if (paths.length === 0) continue;
    try {
      const { data } = await supabase.storage.from(bucket).createSignedUrls([...paths], SIGNED_URL_SECONDS);
      const urls = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl] as const));
      for (const p of paths) files.push({ bucket, path: p, temporary_link: urls.get(p) ?? null });
    } catch {
      for (const p of paths) files.push({ bucket, path: p, temporary_link: null });
      warnings.push(`files in ${bucket}: temporary links could not be created`);
    }
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    readme: README,
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: now.toISOString(),
    account: { id: uid, email: user.email ?? null, created_at: user.created_at ?? null, last_sign_in_at: user.last_sign_in_at ?? null, terms_version: meta.accepted_terms_version ?? null, terms_accepted_at: meta.accepted_terms_at ?? null },
    warnings,
    sections,
    files,
  };
}

export const exportFileName = (now: Date = new Date()) => `trailmate-my-data-${now.toISOString().slice(0, 10)}.json`;

// ───────────────────────────────────────────────── delete my account

/** Every file a person uploaded: the ones their rows point at, plus anything else in their own folder. Only paths in `<id>/` count. */
export async function collectUploadPaths(supabase: SupabaseClient, uid: string): Promise<{ bucket: string; paths: string[] }[]> {
  const own = (p: unknown): p is string => typeof p === "string" && p.startsWith(`${uid}/`);
  const [{ data: media }, { data: reportRows }, { data: profile }] = await Promise.all([
    supabase.from("post_media").select("storage_path, poster_path, posts!inner(author_id)").eq("posts.author_id", uid).limit(5000),
    supabase.from("place_reports").select("photo_path").eq("user_id", uid).limit(5000),
    supabase.from("profiles").select("avatar_path").eq("id", uid).maybeSingle(),
  ]);
  const post = new Set<string>(), rep = new Set<string>();
  for (const m of (media ?? []) as { storage_path?: unknown; poster_path?: unknown }[]) { if (own(m.storage_path)) post.add(m.storage_path); if (own(m.poster_path)) post.add(m.poster_path); }
  for (const r of (reportRows ?? []) as { photo_path?: unknown }[]) if (own(r.photo_path)) rep.add(r.photo_path);
  const avatar = (profile as { avatar_path?: unknown } | null)?.avatar_path;
  if (own(avatar)) post.add(avatar);
  // Anything left in my folder (for example an upload that was never turned into a post).
  for (const [bucket, set] of [[POST_MEDIA_BUCKET, post], [REPORT_PHOTO_BUCKET, rep]] as const) {
    for (const p of await listFolder(supabase, bucket, uid, 0)) set.add(p);
  }
  return [{ bucket: POST_MEDIA_BUCKET, paths: [...post] }, { bucket: REPORT_PHOTO_BUCKET, paths: [...rep] }];
}

async function listFolder(supabase: SupabaseClient, bucket: string, prefix: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data) {
      if (e.id === null || e.id === undefined) { if (depth < 2) out.push(...(await listFolder(supabase, bucket, `${prefix}/${e.name}`, depth + 1))); }
      else out.push(`${prefix}/${e.name}`);
    }
    if (data.length < 100) break;
  }
  return out;
}

export async function removeUploads(supabase: SupabaseClient, groups: { bucket: string; paths: string[] }[]): Promise<void> {
  for (const g of groups) {
    for (let i = 0; i < g.paths.length; i += 100) {
      const { error } = await supabase.storage.from(g.bucket).remove(g.paths.slice(i, i + 100));
      if (error) throw new Error(`remove ${g.bucket}: ${error.message}`);
    }
  }
}

export type DeleteResult = { ok: true } | { ok: false; status: number; error: string };

export async function deleteAccount(deps: {
  supabase: SupabaseClient;
  user: User;
  input: { confirm: string; password: string };
  /** Checks the password WITHOUT signing the person in again anywhere. */
  verifyPassword: (email: string, password: string) => Promise<boolean>;
}): Promise<DeleteResult> {
  const { supabase, user, input } = deps;
  const email = user.email;
  if (!email) return { ok: false, status: 400, error: "This account has no email address, so it cannot be confirmed here. Please contact us." };
  if (input.confirm.trim().toLowerCase() !== email.toLowerCase()) return { ok: false, status: 400, error: "The email you typed doesn't match your account's email." };
  if (!(await deps.verifyPassword(email, input.password))) return { ok: false, status: 403, error: "That password is not correct." };

  // 1. Files first. If any cannot be removed we stop with nothing deleted, so a retry is safe and no file is left behind.
  try {
    await removeUploads(supabase, await collectUploadPaths(supabase, user.id));
  } catch (e) {
    reportError(e, { where: "account-delete", extra: { step: "files" } });
    return { ok: false, status: 502, error: "We couldn't remove all of your uploaded photos and videos, so nothing was deleted. Please try again in a minute." };
  }

  // 2. The account and everything linked to it (the database function hands over shared trips; see the migration).
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    reportError(new Error(`delete_my_account: ${error.code ?? "?"} ${error.message}`), { where: "account-delete", extra: { step: "database" } });
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) return { ok: false, status: 503, error: "Account deletion isn't switched on on this server yet. Please contact us and we will delete it for you." };
    return { ok: false, status: 500, error: "Something went wrong while deleting your account. Please try again, or contact us." };
  }

  // 3. End this browser's session (best effort: the account no longer exists, so the session is already useless).
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
  return { ok: true };
}
