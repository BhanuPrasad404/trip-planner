-- Storage for report photos. Kept in its OWN migration so that, if storage is configured differently
-- on your project, it cannot block the rest of the schema.
-- Photos are publicly viewable by their (unguessable) URL; only signed-in users can upload,
-- and only into a folder named after their own user id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 1500000, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "Report photos: upload into own folder" on storage.objects;
create policy "Report photos: upload into own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Report photos: delete own" on storage.objects;
create policy "Report photos: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
