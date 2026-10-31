-- Run supabase.sql first, then run this additive migration.
-- Existing sources and jobs remain intact while the scraper tables are introduced.

create extension if not exists pgcrypto;

create table if not exists public.saved_links (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (owner_id in ('taufik', 'alya')),
  url text not null,
  source text not null check (source = 'glints'),
  is_active boolean not null default true,
  last_scraped_at timestamptz,
  last_status text,
  last_error text,
  jobs_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, url)
);

alter table public.saved_links enable row level security;
revoke all on public.saved_links from public, anon, authenticated;
grant all on public.saved_links to service_role;

alter table public.jobs add column if not exists link_id uuid
  references public.saved_links(id) on delete set null;
alter table public.jobs add column if not exists source text;
alter table public.jobs add column if not exists job_link text;
alter table public.jobs add column if not exists job_title text;
alter table public.jobs add column if not exists company_name text;
alter table public.jobs add column if not exists employment_type text;
alter table public.jobs add column if not exists job_description text;
alter table public.jobs add column if not exists posted_at timestamptz;
alter table public.jobs add column if not exists posted_at_source text not null default 'unknown';
alter table public.jobs add column if not exists posted_at_hint timestamptz;
alter table public.jobs add column if not exists detail_status text not null default 'pending';
alter table public.jobs add column if not exists detail_attempts integer not null default 0;
alter table public.jobs add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_source_check' and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs add constraint jobs_source_check
      check (source is null or source = 'glints');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_posted_at_source_check' and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs add constraint jobs_posted_at_source_check
      check (posted_at_source in ('exact', 'estimated', 'unknown'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_detail_status_check' and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs add constraint jobs_detail_status_check
      check (detail_status in ('pending', 'ok', 'failed', 'expired'));
  end if;
end
$$;

create index if not exists jobs_detail_status_idx on public.jobs (detail_status);
create index if not exists jobs_last_seen_at_idx on public.jobs (last_seen_at);
create index if not exists jobs_posted_at_idx on public.jobs (posted_at);
create unique index if not exists jobs_owner_job_link_uidx on public.jobs (owner_id, job_link)
  where job_link is not null;
create index if not exists jobs_link_id_idx on public.jobs (link_id);

create or replace function public.replace_source_jobs(
  p_owner_id text,
  p_source_url text,
  p_job_urls text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_relations integer;
begin
  delete from public.job_sources relation
  where relation.owner_id = p_owner_id
    and relation.source_url = p_source_url
    and not relation.job_url = any(coalesce(p_job_urls, array[]::text[]));

  get diagnostics deleted_relations = row_count;

  delete from public.jobs job
  where job.owner_id = p_owner_id
    and not exists (
      select 1
      from public.job_sources relation
      where relation.owner_id = job.owner_id
        and relation.job_url = job.job_url
    );

  return deleted_relations;
end;
$$;

revoke all on function public.replace_source_jobs(text, text, text[]) from public, anon, authenticated;
grant execute on function public.replace_source_jobs(text, text, text[]) to service_role;

-- Migrate saved search URLs and their current status without deleting legacy rows.
insert into public.saved_links (
  owner_id, url, source, last_scraped_at, last_status, last_error, jobs_count, created_at
)
select
  source_row.owner_id,
  source_row.url,
  'glints',
  source_row.last_scraped_at,
  case
    when source_row.auto_scrape_status = 'success' then 'berhasil diperbarui'
    when source_row.auto_scrape_status = 'failed' then 'gagal diperbarui'
    when source_row.last_scraped_at is not null then 'berhasil diperbarui'
    else null
  end,
  source_row.auto_scrape_error,
  0,
  source_row.created_at
from public.sources source_row
where lower(source_row.url) ~ '(^|[./])glints\.com([/:]|$)'
on conflict (owner_id, url) do nothing;

update public.jobs job
set
  job_link = coalesce(job.job_link, job.job_url),
  job_title = coalesce(job.job_title, job.title),
  company_name = coalesce(job.company_name, job.company),
  job_description = coalesce(job.job_description, job.description),
  source = coalesce(
    job.source,
    'glints'
  ),
  link_id = coalesce(job.link_id, saved.id),
  detail_status = case
    when job.detail_status = 'pending' and (job.description is not null or job.job_description is not null)
      then 'ok'
    else job.detail_status
  end
from public.saved_links saved
where saved.owner_id = job.owner_id
  and saved.url = job.source_url;

update public.saved_links saved
set jobs_count = counts.job_count
from (
  select link_id, count(*)::integer as job_count
  from public.jobs
  where link_id is not null
  group by link_id
) counts
where saved.id = counts.link_id;

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
    or p_new_source is distinct from 'glints' then
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
      last_status = null,
      last_error = null,
      jobs_count = 0
  where owner_id = p_owner_id and url = p_old_url;
end
$$;

create or replace function public.delete_saved_link(
  p_owner_id text,
  p_source_url text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  if p_owner_id is null or p_owner_id not in ('taufik', 'alya')
    or p_source_url is null or p_source_url = '' then
    raise exception 'Data URL sumber tidak valid';
  end if;
  if not exists (
    select 1 from public.saved_links
    where owner_id = p_owner_id and url = p_source_url
  ) then
    raise exception 'Tautan tidak ditemukan';
  end if;

  deleted_count := public.delete_jobs_by_source(p_owner_id, p_source_url);
  delete from public.saved_links
  where owner_id = p_owner_id and url = p_source_url;
  return deleted_count;
end
$$;

revoke all on function public.replace_saved_link_url(text, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_saved_link_url(text, text, text, text) to service_role;
revoke all on function public.delete_saved_link(text, text) from public, anon, authenticated;
grant execute on function public.delete_saved_link(text, text) to service_role;
