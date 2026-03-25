create table if not exists public.domain_health (
  domain text primary key,
  has_mx boolean default false,
  has_website boolean default false,
  is_parked boolean default false,
  mx_records jsonb,
  health_score integer default 0,
  checked_at timestamptz default timezone('utc', now()),
  expires_at timestamptz default timezone('utc', now()) + interval '7 days'
);

create table if not exists public.email_outcomes (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  email_address text not null,
  domain text not null,
  local_part text not null,
  email_pattern text,
  outcome text not null check (outcome in ('delivered', 'bounced', 'opened', 'replied', 'opted_out', 'unknown')),
  bounce_type text,
  bounce_reason text,
  sent_at timestamptz not null,
  outcome_at timestamptz default timezone('utc', now()),
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_email_outcomes_domain on public.email_outcomes(domain);
create index if not exists idx_email_outcomes_pattern on public.email_outcomes(email_pattern);
create index if not exists idx_email_outcomes_outcome on public.email_outcomes(outcome);

create table if not exists public.domain_reputation (
  domain text primary key,
  total_sent integer default 0,
  total_delivered integer default 0,
  total_bounced integer default 0,
  total_replied integer default 0,
  delivery_rate float,
  last_bounce_at timestamptz,
  last_success_at timestamptz,
  reputation_score float default 50,
  updated_at timestamptz default timezone('utc', now())
);

create table if not exists public.person_verification (
  id uuid default gen_random_uuid() primary key,
  person_name text not null,
  company_name text not null,
  verified boolean default false,
  confidence float default 0,
  signals jsonb,
  search_results_summary text,
  checked_at timestamptz default timezone('utc', now()),
  expires_at timestamptz default timezone('utc', now()) + interval '30 days'
);

create index if not exists idx_person_verification_lookup on public.person_verification(person_name, company_name);

alter table public.leads add column if not exists relevance_score float default 0.3;
alter table public.leads add column if not exists relevance_keyword text;
alter table public.leads add column if not exists primary_email text;
alter table public.leads add column if not exists fallback_email text;
alter table public.leads add column if not exists primary_email_trust float;
alter table public.leads add column if not exists fallback_email_trust float;
alter table public.leads add column if not exists active_email_role text default 'primary'
  check (active_email_role in ('primary', 'fallback'));
alter table public.leads add column if not exists primary_bounced_at timestamptz;
alter table public.leads add column if not exists operator_vouched boolean default false;
alter table public.leads add column if not exists operator_vouched_at timestamptz;
alter table public.leads add column if not exists email_verified_by text
  check (email_verified_by in ('operator', 'reply_detected', 'delivery_confirmed', 'bounce_detected'));
