create table if not exists sources (
  url text primary key,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists jobs (
  job_url text primary key,
  title text not null,
  company text,
  location text,
  salary text,
  description text,
  posted_time text,
  source_url text,
  site text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table jobs add column if not exists scraped_at timestamptz not null default now();
alter table jobs add column if not exists posted_time text;
drop function if exists public.get_jobs_page(text, text, timestamptz, text, integer);
drop function if exists public.get_jobs_page(text, text, timestamptz, text, integer, integer, text);
drop function if exists public.get_jobs_page(text, text, timestamptz, text, integer, text, integer);
drop index if exists public.jobs_posted_cursor_idx;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'posted_text'
  ) then
    execute 'update jobs set posted_time = coalesce(posted_time, posted_text)';
    execute 'alter table jobs drop column posted_text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'posted_at'
  ) then
    execute 'update jobs set posted_time = coalesce(posted_time, posted_at::text)';
    execute 'alter table jobs drop column posted_at';
  end if;
end
$$;
create index if not exists jobs_source_url_idx on jobs (source_url);
create index if not exists jobs_scraped_at_idx on jobs (scraped_at);
drop function if exists public.refresh_source_jobs(text, jsonb, timestamptz);
alter table sources enable row level security;
alter table jobs enable row level security;

create table if not exists job_sources (
  source_url text not null references sources(url) on delete cascade,
  job_url text not null references jobs(job_url) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_url, job_url)
);
create index if not exists job_sources_job_url_idx on job_sources (job_url);
alter table job_sources enable row level security;

drop policy if exists jobs_public_read on jobs;
create policy jobs_public_read on jobs
  for select to anon, authenticated
  using (true);

revoke all on jobs from public, anon, authenticated;
grant select on jobs to anon, authenticated;
grant all on jobs to service_role;
revoke all on sources, job_sources from public, anon, authenticated;
grant all on sources, job_sources to service_role;

insert into sources (url)
select distinct source_url
from jobs
where source_url is not null
on conflict (url) do nothing;

insert into job_sources (source_url, job_url)
select source_url, job_url
from jobs
where source_url is not null
on conflict (source_url, job_url) do nothing;

create or replace function public.cleanup_source_jobs(
  p_source_url text,
  p_keep_job_urls text[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed_job_urls text[];
  deleted_count integer;
begin
  if p_source_url is null or p_source_url = '' then
    raise exception 'Source URL is required';
  end if;
  if p_keep_job_urls is null or cardinality(p_keep_job_urls) = 0 then
    raise exception 'Keep list cannot be empty; existing source data was not changed';
  end if;

  with removed as (
    delete from job_sources
    where source_url = p_source_url
      and not (job_url = any(p_keep_job_urls))
    returning job_url
  )
  select array_agg(job_url) into removed_job_urls from removed;

  delete from jobs job
  where job.job_url = any(coalesce(removed_job_urls, array[]::text[]))
    and not exists (
      select 1 from job_sources linked where linked.job_url = job.job_url
    );
  get diagnostics deleted_count = row_count;

  return deleted_count;
end;
$$;

create or replace function public.refresh_source_jobs(
  p_source_url text,
  p_jobs jsonb
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  saved_count integer;
  keep_job_urls text[];
begin
  if p_source_url is null or p_source_url = '' then
    raise exception 'Source URL is required';
  end if;
  if jsonb_typeof(p_jobs) is distinct from 'array' then
    raise exception 'At least one valid job is required; existing source data was not changed';
  end if;
  if jsonb_array_length(p_jobs) = 0 then
    raise exception 'At least one valid job is required; existing source data was not changed';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_jobs) as incoming(job_url text, title text)
    where incoming.job_url is null or incoming.title is null or incoming.title = ''
  ) then
    raise exception 'Every job must include a URL and title';
  end if;

  insert into sources (url)
  values (p_source_url)
  on conflict (url) do nothing;

  insert into jobs (
    job_url, title, company, location, salary, description, posted_time,
    source_url, site, last_seen_at, scraped_at
  )
  select
    incoming.job_url, incoming.title, incoming.company, incoming.location,
    incoming.salary, incoming.description, incoming.posted_time,
    p_source_url, incoming.site,
    coalesce(incoming.last_seen_at, now()), coalesce(incoming.scraped_at, now())
  from jsonb_to_recordset(p_jobs) as incoming(
    job_url text,
    title text,
    company text,
    location text,
    salary text,
    description text,
    posted_time text,
    source_url text,
    site text,
    last_seen_at timestamptz,
    scraped_at timestamptz
  )
  on conflict (job_url) do update set
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    salary = excluded.salary,
    posted_time = excluded.posted_time,
    source_url = excluded.source_url,
    site = excluded.site,
    last_seen_at = excluded.last_seen_at,
    scraped_at = excluded.scraped_at,
    description = left(excluded.description, 2000);
  get diagnostics saved_count = row_count;

  insert into job_sources (source_url, job_url)
  select p_source_url, incoming.job_url
  from jsonb_to_recordset(p_jobs) as incoming(job_url text)
  on conflict (source_url, job_url) do nothing;

  select array_agg(distinct incoming.job_url)
  into keep_job_urls
  from jsonb_to_recordset(p_jobs) as incoming(job_url text);
  perform public.cleanup_source_jobs(p_source_url, keep_job_urls);

  update sources
  set last_scraped_at = now()
  where url = p_source_url;

  return saved_count;
end;
$$;

create or replace function public.delete_jobs_by_source(p_source_url text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_job_urls text[];
  deleted_count integer;
begin
  if p_source_url is null or p_source_url = '' then
    raise exception 'Source URL is required';
  end if;

  select array_agg(affected.job_url)
  into affected_job_urls
  from (
    select job_url
    from job_sources
    where source_url = p_source_url
    union
    select job_url
    from jobs
    where source_url = p_source_url
  ) as affected;

  delete from sources where url = p_source_url;

  delete from jobs job
  where job.job_url = any(coalesce(affected_job_urls, array[]::text[]))
    and not exists (
      select 1
      from job_sources linked
      where linked.job_url = job.job_url
    );
  get diagnostics deleted_count = row_count;

  update jobs job
  set source_url = linked.source_url
  from (
    select distinct on (job_url) job_url, source_url
    from job_sources
    order by job_url, created_at desc
  ) linked
  where job.job_url = linked.job_url
    and job.source_url = p_source_url;

  return deleted_count;
end;
$$;

create or replace function public.delete_source_with_orphans(p_source_url text)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.delete_jobs_by_source(p_source_url);
$$;

create table if not exists scrape_batches (
  id uuid primary key,
  firecrawl_batch_id text unique,
  requested_urls text[] not null,
  replacements jsonb not null default '[]'::jsonb,
  status text not null check (status in ('pending', 'scraping', 'done', 'failed')),
  total integer not null default 0,
  completed integer not null default 0,
  outcome jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table scrape_batches enable row level security;
revoke all on scrape_batches from public, anon, authenticated;
grant all on scrape_batches to service_role;

create table if not exists scrape_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null
);
alter table scrape_rate_limits enable row level security;
revoke all on scrape_rate_limits from public, anon, authenticated;
grant all on scrape_rate_limits to service_role;

create or replace function public.consume_scrape_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
begin
  if p_rate_key is null or p_rate_key = '' or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit parameters';
  end if;

  insert into scrape_rate_limits (rate_key, window_started_at, request_count)
  values (p_rate_key, now(), 1)
  on conflict (rate_key) do update
  set window_started_at = case
        when scrape_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then now()
        else scrape_rate_limits.window_started_at
      end,
      request_count = case
        when scrape_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then 1
        else scrape_rate_limits.request_count + 1
      end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

create or replace function public.cleanup_expired_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from jobs
  where scraped_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;

  delete from scrape_rate_limits
  where window_started_at < now() - interval '1 day';
  delete from scrape_batches
  where created_at < now() - interval '7 days';

  return deleted_count;
end;
$$;

revoke all on function public.cleanup_source_jobs(text, text[]) from public, anon, authenticated;
grant execute on function public.cleanup_source_jobs(text, text[]) to service_role;
revoke all on function public.refresh_source_jobs(text, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_source_jobs(text, jsonb) to service_role;
revoke all on function public.delete_jobs_by_source(text) from public, anon, authenticated;
grant execute on function public.delete_jobs_by_source(text) to service_role;
revoke all on function public.delete_source_with_orphans(text) from public, anon, authenticated;
grant execute on function public.delete_source_with_orphans(text) to service_role;
revoke all on function public.consume_scrape_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_scrape_rate_limit(text, integer, integer) to service_role;
revoke all on function public.cleanup_expired_jobs() from public, anon, authenticated;
grant execute on function public.cleanup_expired_jobs() to service_role;

notify pgrst, 'reload schema';

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'loker-daily-cleanup';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'loker-daily-cleanup',
    '15 3 * * *',
    'select public.cleanup_expired_jobs();'
  );
end;
$$;
