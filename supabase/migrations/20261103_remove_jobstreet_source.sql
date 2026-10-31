begin;

do $$
declare
  saved_link record;
  source_constraint record;
begin
  for saved_link in
    select owner_id, url
    from public.saved_links
    where source = 'jobstreet'
       or lower(url) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
  loop
    perform public.delete_saved_link(saved_link.owner_id, saved_link.url);
  end loop;

  for source_constraint in
    select constraint_row.conname, relation.relname
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('saved_links', 'jobs')
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%jobstreet%'
  loop
    execute format(
      'alter table public.%I drop constraint %I',
      source_constraint.relname,
      source_constraint.conname
    );
  end loop;

  delete from public.job_sources
  where lower(source_url) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)';

  update public.jobs job
  set source = 'glints',
      site = 'glints'
  where (
      lower(coalesce(job.source, '')) = 'jobstreet'
      or lower(coalesce(job.site, '')) like '%jobstreet%'
      or lower(coalesce(job.job_url, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
      or lower(coalesce(job.job_link, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
      or lower(coalesce(job.source_url, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
    )
    and exists (
      select 1
      from public.job_sources relation
      where relation.owner_id = job.owner_id
        and relation.job_url = job.job_url
        and lower(relation.source_url) ~ '(^|[./])glints\.com([/:?#]|$)'
    );

  update public.jobs job
  set source = null,
      site = null
  where (
      lower(coalesce(job.source, '')) = 'jobstreet'
      or lower(coalesce(job.site, '')) like '%jobstreet%'
      or lower(coalesce(job.job_url, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
      or lower(coalesce(job.job_link, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
      or lower(coalesce(job.source_url, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
    )
    and exists (
      select 1
      from public.job_sources relation
      where relation.owner_id = job.owner_id
        and relation.job_url = job.job_url
    );

  delete from public.jobs job
  where (
      lower(coalesce(job.source, '')) = 'jobstreet'
      or lower(coalesce(job.site, '')) like '%jobstreet%'
      or lower(coalesce(job.job_url, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
      or lower(coalesce(job.job_link, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
      or lower(coalesce(job.source_url, '')) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)'
    )
    and not exists (
      select 1
      from public.job_sources relation
      where relation.owner_id = job.owner_id
        and relation.job_url = job.job_url
    );

  delete from public.sources
  where lower(url) ~ '(^|[./])jobstreet\.(com(\.(au|hk|my|ph|sg|vn))?|co\.(id|th|nz))([/:?#]|$)';

  update public.cv_analyses analysis_row
  set analysis = (analysis_row.analysis - '_cacheKey') || jsonb_build_object(
    'matches',
    (
      select coalesce(jsonb_agg(match_item), '[]'::jsonb)
      from jsonb_array_elements(
        case
          when jsonb_typeof(analysis_row.analysis->'matches') = 'array'
            then analysis_row.analysis->'matches'
          else '[]'::jsonb
        end
      ) as match_rows(match_item)
      where match_item::text not ilike '%jobstreet%'
    )
  )
  where jsonb_typeof(analysis_row.analysis) = 'object'
    and exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(analysis_row.analysis->'matches') = 'array'
            then analysis_row.analysis->'matches'
          else '[]'::jsonb
        end
      ) as match_rows(match_item)
      where match_item::text ilike '%jobstreet%'
    );
end
$$;

alter table public.saved_links drop constraint if exists saved_links_source_check;
alter table public.saved_links
  add constraint saved_links_source_check check (source = 'glints');
alter table public.jobs drop constraint if exists jobs_source_check;
alter table public.jobs
  add constraint jobs_source_check check (source is null or source = 'glints');

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
      source = 'glints',
      last_scraped_at = null,
      last_status = null,
      last_error = null,
      jobs_count = 0
  where owner_id = p_owner_id and url = p_old_url;
end
$$;

revoke all on function public.replace_saved_link_url(text, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_saved_link_url(text, text, text, text) to service_role;

commit;
