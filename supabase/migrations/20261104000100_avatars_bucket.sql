-- PREPARED, NOT APPLIED. Storage for optional profile pictures.
--
-- profiles.avatar_path already exists (20261011000000_social_foundation.sql) but nothing could fill it. This creates the bucket the app
-- uploads to: a small square WebP (512 px, usually 20 to 60 KB, made on the phone before it is sent) per person, in a folder named by their id.
--
-- PUBLIC bucket: a profile picture is shown to other travellers (in the feed, on a profile), so it is read by plain address with no sign-in
-- check per image; the file name is an unguessable random string that changes with every new picture. Writing is NOT public: only the
-- signed-in owner of the folder can add, replace or delete files in it. 512 KB, WebP or JPEG only, enforced here as well as in the app.
-- Additive: no existing table, row or bucket is touched. Needs the owner's explicit approval before it is applied.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owner uploads own avatar" on storage.objects;
create policy "Owner uploads own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Owner replaces own avatar" on storage.objects;
create policy "Owner replaces own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Owner deletes own avatar" on storage.objects;
create policy "Owner deletes own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The owner may list their own folder (the app checks a file really arrived before pointing the profile at it).
drop policy if exists "Owner lists own avatars" on storage.objects;
create policy "Owner lists own avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
