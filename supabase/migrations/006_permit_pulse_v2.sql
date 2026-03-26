create extension if not exists pgcrypto;

create table if not exists public.v2_leads (
  id uuid default gen_random_uuid() primary key,
  permit_number text not null,
  permit_key text not null,
  source text not null default 'nyc_dob',
  address text,
  borough_or_municipality text,
  state text default 'NY',
  work_description text,
  filing_date date,
  permit_type text,
  applicant_name text,
  owner_name text,
  relevance_score float default 0.3,
  relevance_keyword text,
  company_name text,
  company_domain text,
  company_website text,
  company_confidence float default 0,
  contact_name text,
  contact_role text check (contact_role in ('gc_applicant', 'owner', 'filing_rep', 'unknown')),
  contact_email text,
  contact_email_trust float default 0,
  contact_phone text,
  fallback_email text,
  fallback_email_trust float default 0,
  active_email_role text default 'primary' check (active_email_role in ('primary', 'fallback')),
  status text not null default 'new' check (status in ('new', 'ready', 'review', 'sent', 'archived')),
  quality_tier text default 'warm' check (quality_tier in ('hot', 'warm', 'cold')),
  draft_subject text,
  draft_body text,
  draft_cta_type text,
  operator_vouched boolean default false,
  operator_notes text,
  enriched_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_leads_status on public.v2_leads(status);
create index if not exists idx_v2_leads_quality on public.v2_leads(quality_tier);
create index if not exists idx_v2_leads_relevance on public.v2_leads(relevance_score);
create index if not exists idx_v2_leads_source on public.v2_leads(source);
create index if not exists idx_v2_leads_permit on public.v2_leads(permit_number);
create unique index if not exists idx_v2_leads_permit_key on public.v2_leads(permit_key);

create table if not exists public.v2_automation_runs (
  id uuid default gen_random_uuid() primary key,
  trigger_type text not null check (trigger_type in ('operator', 'schedule', 'retry')),
  triggered_by text,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  current_stage text,
  source_scope jsonb,
  permits_found integer default 0,
  permits_skipped_low_relevance integer default 0,
  permits_deduplicated integer default 0,
  leads_created integer default 0,
  leads_enriched integer default 0,
  leads_ready integer default 0,
  leads_review integer default 0,
  drafts_generated integer default 0,
  sends_attempted integer default 0,
  sends_succeeded integer default 0,
  sends_failed integer default 0,
  error_count integer default 0,
  last_error text,
  errors jsonb,
  config_snapshot jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_runs_status on public.v2_automation_runs(status);

create table if not exists public.v2_company_candidates (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.v2_leads(id) on delete cascade,
  run_id uuid references public.v2_automation_runs(id) on delete set null,
  company_name text not null,
  domain text,
  website text,
  source text,
  confidence float default 0,
  reasons jsonb,
  is_current boolean default true,
  is_chosen boolean default false,
  rejected_reason text,
  discovered_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_company_candidates_lead on public.v2_company_candidates(lead_id);
create index if not exists idx_v2_company_candidates_current on public.v2_company_candidates(lead_id) where is_current = true;

create table if not exists public.v2_email_candidates (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.v2_leads(id) on delete cascade,
  run_id uuid references public.v2_automation_runs(id) on delete set null,
  email_address text not null,
  domain text not null,
  local_part text not null,
  person_name text,
  person_role text,
  person_name_match boolean default false,
  person_token_in_local boolean default false,
  company_token_in_domain boolean default false,
  provenance_source text not null,
  provenance_url text,
  provenance_page_type text,
  provenance_extraction_method text,
  provenance_page_title text,
  provenance_page_heading text,
  provenance_raw_context text,
  provenance_crawl_ref text,
  provenance_stale_penalty integer default 0,
  provenance_stale_reasons jsonb,
  provenance_domain_health_at_discovery integer,
  trust_score float default 0,
  trust_reasons jsonb,
  is_auto_sendable boolean default false,
  is_manual_sendable boolean default false,
  is_research_only boolean default true,
  is_current boolean default true,
  is_primary boolean default false,
  is_fallback boolean default false,
  selection_reason text,
  rejected_reason text,
  superseded_at timestamptz,
  discovered_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_email_candidates_lead on public.v2_email_candidates(lead_id);
create index if not exists idx_v2_email_candidates_current on public.v2_email_candidates(lead_id) where is_current = true;

create table if not exists public.v2_lead_events (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.v2_leads(id) on delete cascade,
  run_id uuid references public.v2_automation_runs(id) on delete set null,
  event_type text not null,
  actor_type text default 'system' check (actor_type in ('system', 'operator', 'schedule')),
  actor_id text,
  detail jsonb,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_lead_events_lead on public.v2_lead_events(lead_id);
create index if not exists idx_v2_lead_events_type on public.v2_lead_events(event_type);

create table if not exists public.v2_lead_jobs (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.v2_leads(id) on delete cascade,
  run_id uuid references public.v2_automation_runs(id) on delete set null,
  job_type text not null check (job_type in (
    'ingest',
    'resolve_company',
    'discover_contacts',
    'check_domain_health',
    'score_emails',
    'select_route',
    'generate_draft',
    'send',
    'bounce_check',
    'follow_up'
  )),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'retrying')),
  provider text,
  attempt_count integer default 0,
  max_attempts integer default 3,
  error_message text,
  error_code text,
  input_snapshot jsonb,
  output_snapshot jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_jobs_lead on public.v2_lead_jobs(lead_id);
create index if not exists idx_v2_jobs_run on public.v2_lead_jobs(run_id);
create index if not exists idx_v2_jobs_status on public.v2_lead_jobs(status);

create table if not exists public.v2_domain_health (
  domain text primary key,
  has_mx boolean default false,
  has_website boolean default false,
  is_parked boolean default false,
  mx_records jsonb,
  health_score integer default 0,
  checked_at timestamptz default timezone('utc', now()),
  expires_at timestamptz default timezone('utc', now()) + interval '7 days'
);

create table if not exists public.v2_domain_reputation (
  domain text primary key,
  total_sent integer default 0,
  total_delivered integer default 0,
  total_bounced integer default 0,
  total_replied integer default 0,
  delivery_rate float,
  reputation_score float default 50,
  last_bounce_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz default timezone('utc', now())
);

create table if not exists public.v2_email_outcomes (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.v2_leads(id) on delete cascade,
  run_id uuid references public.v2_automation_runs(id) on delete set null,
  email_address text not null,
  domain text not null,
  local_part text not null,
  email_pattern text,
  outcome text not null check (outcome in ('sent', 'delivered', 'bounced', 'opened', 'replied', 'opted_out')),
  bounce_type text,
  bounce_reason text,
  sent_at timestamptz not null,
  outcome_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_outcomes_domain on public.v2_email_outcomes(domain);
create index if not exists idx_v2_outcomes_outcome on public.v2_email_outcomes(outcome);

create table if not exists public.v2_follow_ups (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.v2_leads(id) on delete cascade,
  step_number integer not null,
  scheduled_at timestamptz not null,
  channel text not null check (channel in ('email', 'phone')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'cancelled')),
  cancelled_reason text,
  draft_content text,
  phone_script text,
  sent_at timestamptz,
  outcome_notes text,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_followups_pending on public.v2_follow_ups(scheduled_at) where status = 'pending';

create table if not exists public.v2_related_permits (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.v2_leads(id) on delete cascade,
  permit_number text not null,
  work_description text,
  address text,
  relevance_score float,
  relevance_keyword text,
  raw_data jsonb,
  discovered_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_related_permits_lead on public.v2_related_permits(lead_id);

create table if not exists public.v2_app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default timezone('utc', now())
);

insert into public.v2_app_config (key, value)
values
  ('daily_send_cap', '20'),
  ('min_relevance_threshold', '0.15'),
  ('auto_send_trust_threshold', '50'),
  ('manual_send_trust_threshold', '25'),
  ('follow_up_enabled', 'true'),
  ('follow_up_sequence', '["email:0","email:4","phone:7","email:14"]'),
  ('active_sources', '["nyc_dob"]'),
  ('warm_up_mode', 'false'),
  ('warm_up_daily_cap', '5')
on conflict (key) do nothing;
