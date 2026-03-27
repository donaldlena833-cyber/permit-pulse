alter table if exists public.automation_jobs
  add column if not exists run_id uuid,
  add column if not exists parent_job_id uuid,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists input_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists output_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists next_retry_at timestamptz;

create index if not exists automation_jobs_run_idx
  on public.automation_jobs (run_id, created_at desc);

create index if not exists automation_jobs_parent_idx
  on public.automation_jobs (parent_job_id, created_at desc);

create index if not exists automation_jobs_retry_idx
  on public.automation_jobs (status, next_retry_at, created_at desc);
