create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  permit_key text not null unique,
  source text not null default 'dob_now',
  address text not null,
  normalized_address text not null,
  borough text not null,
  description text not null default '',
  score integer not null default 0,
  status text not null default 'new',
  lead_tier text not null default 'cold',
  priority_label text not null default 'Monitor',
  priority_score integer not null default 0,
  contactability_score integer not null default 0,
  contactability_label text not null default 'Weak',
  outreach_readiness_score integer not null default 0,
  outreach_readiness_label text not null default 'Needs Review',
  linkedin_worthy boolean not null default false,
  best_channel text not null default 'email',
  best_next_action jsonb not null default '{}'::jsonb,
  score_breakdown jsonb not null default '{}'::jsonb,
  contactability_breakdown jsonb not null default '{}'::jsonb,
  enrichment_summary jsonb not null default '{}'::jsonb,
  raw_permit jsonb not null default '{}'::jsonb,
  project_tags text[] not null default '{}',
  work_type text,
  filing_reason text,
  issued_date timestamptz,
  approved_date timestamptz,
  expiry_date timestamptz,
  estimated_cost numeric(14,2) not null default 0,
  owner_name text,
  owner_business_name text,
  applicant_name text,
  applicant_business_name text,
  filing_rep_name text,
  company_match_strength text not null default 'weak',
  company_domain text,
  property_confidence numeric(5,2) not null default 0,
  enrichment_confidence numeric(5,2) not null default 0,
  auto_send_eligible boolean not null default false,
  auto_send_reason text,
  duplicate_guard_until timestamptz,
  last_scanned_at timestamptz,
  last_enriched_at timestamptz,
  last_contacted_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_score_idx on public.leads (score desc);
create index if not exists leads_borough_idx on public.leads (borough);
create index if not exists leads_last_contacted_idx on public.leads (last_contacted_at desc);
create index if not exists leads_auto_send_idx on public.leads (auto_send_eligible, score desc);

create table if not exists public.property_profiles (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  bin text,
  bbl text,
  block text,
  lot text,
  building_type text,
  property_class text,
  neighborhood text,
  community_district text,
  place_id text,
  maps_url text,
  hpd_summary jsonb not null default '{}'::jsonb,
  pluto_payload jsonb not null default '{}'::jsonb,
  acris_payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (lead_id)
);

create table if not exists public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  role text not null default 'owner',
  company_name text not null,
  normalized_name text not null,
  description text,
  website text,
  domain text,
  linked_in_url text,
  instagram_url text,
  search_query text,
  search_results jsonb not null default '[]'::jsonb,
  social_links jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) not null default 0,
  match_strength text not null default 'weak',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (lead_id)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  company_profile_id uuid references public.company_profiles(id) on delete set null,
  name text,
  role text,
  email text,
  phone text,
  website_url text,
  linkedin_url text,
  instagram_url text,
  contact_form_url text,
  type text not null default 'public',
  confidence numeric(5,2) not null default 0,
  source text not null,
  verified boolean not null default false,
  verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists contacts_lead_idx on public.contacts (lead_id, is_primary desc, confidence desc);
create index if not exists contacts_email_idx on public.contacts (email);

create table if not exists public.enrichment_facts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  field text not null,
  value text not null,
  source text not null,
  confidence numeric(5,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists enrichment_facts_lead_idx on public.enrichment_facts (lead_id, field);

create table if not exists public.outreach (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null default 'email',
  recipient text,
  recipient_type text,
  subject text,
  draft text,
  plugin_line text,
  call_opener text,
  follow_up_note text,
  status text not null default 'draft',
  scheduled_for timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists outreach_lead_idx on public.outreach (lead_id, created_at desc);
create index if not exists outreach_status_idx on public.outreach (status, scheduled_for);
create index if not exists outreach_sent_idx on public.outreach (sent_at desc);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,
  summary text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists activity_log_lead_idx on public.activity_log (lead_id, created_at desc);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

drop trigger if exists property_profiles_set_updated_at on public.property_profiles;
create trigger property_profiles_set_updated_at
before update on public.property_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists company_profiles_set_updated_at on public.company_profiles;
create trigger company_profiles_set_updated_at
before update on public.company_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
before update on public.contacts
for each row
execute function public.set_updated_at();

drop trigger if exists outreach_set_updated_at on public.outreach;
create trigger outreach_set_updated_at
before update on public.outreach
for each row
execute function public.set_updated_at();

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.leads to anon, authenticated;
grant select, insert, update, delete on public.property_profiles to anon, authenticated;
grant select, insert, update, delete on public.company_profiles to anon, authenticated;
grant select, insert, update, delete on public.contacts to anon, authenticated;
grant select, insert, update, delete on public.enrichment_facts to anon, authenticated;
grant select, insert, update, delete on public.outreach to anon, authenticated;
grant select, insert, update, delete on public.activity_log to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;
