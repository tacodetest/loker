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
  posted_text text,
  posted_at timestamptz,
  source_url text,
  site text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists jobs_posted_idx on jobs (posted_at desc);
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

drop function if exists public.refresh_source_jobs(text, jsonb, timestamptz);

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

  insert into sources (url)
  values (p_source_url)
  on conflict (url) do nothing;

  insert into jobs (
    job_url, title, company, location, salary, description, posted_text,
    posted_at, source_url, site, last_seen_at
  )
  select
    incoming.job_url, incoming.title, incoming.company, incoming.location,
    incoming.salary, incoming.description, incoming.posted_text,
    incoming.posted_at, p_source_url, incoming.site, incoming.last_seen_at
  from jsonb_to_recordset(p_jobs) as incoming(
    job_url text,
    title text,
    company text,
    location text,
    salary text,
    description text,
    posted_text text,
    posted_at timestamptz,
    source_url text,
    site text,
    last_seen_at timestamptz
  )
  on conflict (job_url) do update set
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    salary = excluded.salary,
    description = excluded.description,
    posted_text = excluded.posted_text,
    posted_at = excluded.posted_at,
    source_url = excluded.source_url,
    site = excluded.site,
    last_seen_at = excluded.last_seen_at;
  get diagnostics saved_count = row_count;

  with removed_links as (
    delete from job_sources existing
    where existing.source_url = p_source_url
      and not exists (
        select 1
        from jsonb_to_recordset(p_jobs) as incoming(job_url text)
        where incoming.job_url = existing.job_url
      )
    returning existing.job_url
  )
  delete from jobs old_job
  using removed_links
  where old_job.job_url = removed_links.job_url
    and not exists (
      select 1 from job_sources linked where linked.job_url = old_job.job_url
    );

  insert into job_sources (source_url, job_url)
  select p_source_url, incoming.job_url
  from jsonb_to_recordset(p_jobs) as incoming(job_url text)
  on conflict (source_url, job_url) do nothing;

  update sources
  set last_scraped_at = now()
  where url = p_source_url;

  return saved_count;
end;
$$;

create or replace function public.delete_source_with_orphans(p_source_url text)
returns integer
language plpgsql
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

  return deleted_count;
end;
$$;

revoke all on function public.refresh_source_jobs(text, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_source_jobs(text, jsonb) to service_role;
revoke all on function public.delete_source_with_orphans(text) from public, anon, authenticated;
grant execute on function public.delete_source_with_orphans(text) to service_role;
