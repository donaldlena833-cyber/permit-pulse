create table if not exists public.v2_prospect_companies (
  id uuid default gen_random_uuid() primary key,
  normalized_name text not null,
  name text not null,
  domain text,
  website text,
  category text check (category in ('interior_designer', 'gc', 'property_manager', 'project_manager', 'architect')),
  suppressed boolean not null default false,
  suppressed_reason text,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create unique index if not exists idx_v2_prospect_companies_domain
  on public.v2_prospect_companies(domain)
  where domain is not null;

create unique index if not exists idx_v2_prospect_companies_name
  on public.v2_prospect_companies(normalized_name);

create table if not exists public.v2_prospect_campaigns (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  category text not null check (category in ('interior_designer', 'gc', 'property_manager', 'project_manager', 'architect')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  template_variant text not null default 'default',
  daily_cap integer not null default 10,
  send_time_local text not null default '11:00',
  timezone text not null default 'America/New_York',
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create unique index if not exists idx_v2_prospect_campaigns_active_category
  on public.v2_prospect_campaigns(category, template_variant, status);

create table if not exists public.v2_prospect_suppressions (
  id uuid default gen_random_uuid() primary key,
  scope_type text not null check (scope_type in ('email', 'domain', 'company')),
  scope_value text not null,
  company_id uuid references public.v2_prospect_companies(id) on delete set null,
  prospect_id uuid references public.v2_prospects(id) on delete set null,
  reason text not null,
  source text not null default 'system',
  active boolean not null default true,
  created_by text,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create unique index if not exists idx_v2_prospect_suppressions_scope
  on public.v2_prospect_suppressions(scope_type, scope_value)
  where active = true;

create table if not exists public.v2_outreach_review_queue (
  id uuid default gen_random_uuid() primary key,
  review_kind text not null check (review_kind in ('reply', 'bounce')),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'ignored')),
  gmail_message_id text not null,
  gmail_thread_id text,
  sender_email text,
  target_email text,
  classification text,
  reason text,
  subject text,
  snippet text,
  payload jsonb,
  resolved_action text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create unique index if not exists idx_v2_outreach_review_queue_message
  on public.v2_outreach_review_queue(gmail_message_id);

create index if not exists idx_v2_outreach_review_queue_status
  on public.v2_outreach_review_queue(status, created_at desc);

alter table public.v2_prospects
  add column if not exists company_id uuid references public.v2_prospect_companies(id) on delete set null,
  add column if not exists campaign_id uuid references public.v2_prospect_campaigns(id) on delete set null,
  add column if not exists personalization_summary text;

alter table public.v2_prospect_import_batches
  add column if not exists campaign_id uuid references public.v2_prospect_campaigns(id) on delete set null,
  add column if not exists skipped_by_reason jsonb default '{}'::jsonb;

insert into public.v2_prospect_campaigns (name, category, status, template_variant, daily_cap, send_time_local, timezone)
values
  ('Architect Outreach', 'architect', 'active', 'default', 10, '11:00', 'America/New_York'),
  ('Interior Designer Outreach', 'interior_designer', 'active', 'default', 10, '11:00', 'America/New_York'),
  ('Property Manager Outreach', 'property_manager', 'active', 'default', 10, '11:00', 'America/New_York'),
  ('Project Manager Outreach', 'project_manager', 'active', 'default', 10, '11:00', 'America/New_York'),
  ('GC Outreach', 'gc', 'active', 'default', 10, '11:00', 'America/New_York')
on conflict do nothing;

grant select, insert, update, delete on public.v2_prospect_companies to service_role;
grant select, insert, update, delete on public.v2_prospect_campaigns to service_role;
grant select, insert, update, delete on public.v2_prospect_suppressions to service_role;
grant select, insert, update, delete on public.v2_outreach_review_queue to service_role;

revoke select, insert, update, delete on public.v2_prospect_companies from anon, authenticated;
revoke select, insert, update, delete on public.v2_prospect_campaigns from anon, authenticated;
revoke select, insert, update, delete on public.v2_prospect_suppressions from anon, authenticated;
revoke select, insert, update, delete on public.v2_outreach_review_queue from anon, authenticated;

alter table public.v2_prospect_companies enable row level security;
alter table public.v2_prospect_campaigns enable row level security;
alter table public.v2_prospect_suppressions enable row level security;
alter table public.v2_outreach_review_queue enable row level security;

notify pgrst, 'reload schema';
