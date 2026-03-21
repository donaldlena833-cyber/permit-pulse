create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  job_type text not null,
  status text not null default 'queued',
  provider text not null default 'worker',
  summary text not null default '',
  detail text not null default '',
  attempt_count integer not null default 1,
  retryable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists automation_jobs_created_idx
  on public.automation_jobs (created_at desc);

create index if not exists automation_jobs_status_idx
  on public.automation_jobs (status, created_at desc);

create index if not exists automation_jobs_lead_idx
  on public.automation_jobs (lead_id, created_at desc);

grant select, insert, update, delete on public.automation_jobs to service_role;
revoke select, insert, update, delete on public.automation_jobs from anon, authenticated;

alter table public.automation_jobs enable row level security;

drop trigger if exists automation_jobs_set_updated_at on public.automation_jobs;
create trigger automation_jobs_set_updated_at
before update on public.automation_jobs
for each row execute function public.set_updated_at();
