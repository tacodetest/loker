create or replace function public.cleanup_expired_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.jobs job
  where job.detail_status in ('expired', 'failed')
    and coalesce(job.last_seen_at, job.scraped_at, job.first_seen_at)
      < now() - interval '14 days'
    and not exists (
      select 1
      from public.job_sources relation
      join public.saved_links link
        on link.owner_id = relation.owner_id
        and link.url = relation.source_url
        and link.is_active
      where relation.owner_id = job.owner_id
        and relation.job_url = job.job_url
    );
  get diagnostics deleted_count = row_count;

  delete from public.scrape_rate_limits
  where window_started_at < now() - interval '1 day';
  delete from public.scrape_batches
  where created_at < now() - interval '7 days';

  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_jobs() from public, anon, authenticated;
grant execute on function public.cleanup_expired_jobs() to service_role;
