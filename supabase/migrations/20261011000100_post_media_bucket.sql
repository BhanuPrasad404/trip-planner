-- Storage for traveler photos/videos. PRIVATE bucket: followers-only posts must not be reachable by URL.
-- The app hands out short-lived signed URLs, and only for posts the viewer is allowed to see.
-- Upload goes directly browser → Storage with a signed upload URL (video bytes never pass through Next.js).
-- Own migration so a different storage setup cannot block the rest of the schema.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 41943040,
        array['image/jpeg', 'image/webp', 'image/png', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

drop policy if exists "Post media: upload into own folder" on storage.objects;
create policy "Post media: upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Post media: delete own" on storage.objects;
create policy "Post media: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Read: your own folder (preview before posting) or media of a post you may see.
drop policy if exists "Post media: read allowed" on storage.objects;
create policy "Post media: read allowed" on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.post_media m where (m.storage_path = name or m.poster_path = name) and public.can_view_post(m.post_id))
    )
  );
