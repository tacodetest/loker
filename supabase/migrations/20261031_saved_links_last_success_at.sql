alter table public.saved_links
  add column if not exists last_success_at timestamptz;

update public.saved_links
set last_success_at = last_scraped_at
where last_success_at is null
  and last_scraped_at is not null
  and last_status in ('berhasil', 'berhasil diperbarui');

update public.saved_links
set last_error = last_status
where last_error is null
  and last_status is not null
  and last_status not in ('berhasil', 'sebagian', 'gagal', 'diblokir', 'berhasil diperbarui', 'gagal diperbarui');

update public.saved_links
set last_error = 'Scrape sebelumnya gagal.'
where last_error is null
  and last_status = 'gagal diperbarui';

update public.saved_links
set last_status = case
  when last_status in ('berhasil', 'berhasil diperbarui') then 'berhasil'
  when last_status in ('sebagian', 'sebagian berhasil') then 'sebagian'
  when last_status = 'diblokir'
    or coalesce(last_error, last_status, '') ~* '(http 403|captcha|pemblokiran|diblokir|menolak akses)' then 'diblokir'
  when last_status is not null or last_error is not null then 'gagal'
  else null
end
where last_status is distinct from case
  when last_status in ('berhasil', 'berhasil diperbarui') then 'berhasil'
  when last_status in ('sebagian', 'sebagian berhasil') then 'sebagian'
  when last_status = 'diblokir'
    or coalesce(last_error, last_status, '') ~* '(http 403|captcha|pemblokiran|diblokir|menolak akses)' then 'diblokir'
  when last_status is not null or last_error is not null then 'gagal'
  else null
end;

create or replace function public.replace_saved_link_url(
  p_owner_id text,
  p_old_url text,
  p_new_url text,
  p_new_source text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_owner_id is null or p_owner_id not in ('taufik', 'alya')
    or p_old_url is null or p_old_url = ''
    or p_new_url is null or p_new_url = ''
    or p_old_url = p_new_url
    or p_new_source is null or p_new_source not in ('jobstreet', 'glints') then
    raise exception 'Data URL sumber tidak valid';
  end if;
  if not exists (
    select 1 from public.saved_links
    where owner_id = p_owner_id and url = p_old_url
  ) then
    raise exception 'Tautan lama tidak ditemukan';
  end if;
  if exists (
    select 1 from public.saved_links
    where owner_id = p_owner_id and url = p_new_url
  ) then
    raise exception 'URL baru sudah tersimpan';
  end if;

  insert into public.sources (owner_id, url)
  values (p_owner_id, p_new_url)
  on conflict (owner_id, url) do nothing;

  perform public.delete_jobs_by_source(p_owner_id, p_old_url);

  update public.saved_links
  set url = p_new_url,
      source = p_new_source,
      last_scraped_at = null,
      last_success_at = null,
      last_status = null,
      last_error = null,
      jobs_count = 0
  where owner_id = p_owner_id and url = p_old_url;
end
$$;
