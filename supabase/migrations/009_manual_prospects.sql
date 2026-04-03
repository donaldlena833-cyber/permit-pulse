create table if not exists public.v2_prospect_import_batches (
  id uuid default gen_random_uuid() primary key,
  filename text not null,
  category text not null check (category in ('interior_designer', 'gc', 'property_manager', 'project_manager', 'architect')),
  row_count integer default 0,
  imported_count integer default 0,
  skipped_count integer default 0,
  actor_id text,
  created_at timestamptz default timezone('utc', now())
);

create table if not exists public.v2_prospects (
  id uuid default gen_random_uuid() primary key,
  category text not null check (category in ('interior_designer', 'gc', 'property_manager', 'project_manager', 'architect')),
  company_name text,
  contact_name text,
  contact_role text,
  email_address text not null,
  email_normalized text not null unique,
  phone text,
  website text,
  city text,
  state text,
  source text not null default 'csv_import',
  import_batch_id uuid references public.v2_prospect_import_batches(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'drafted', 'sent', 'replied', 'archived')),
  draft_subject text,
  draft_body text,
  notes text,
  gmail_thread_id text,
  sent_count integer default 0,
  last_sent_at timestamptz,
  last_replied_at timestamptz,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_prospects_status on public.v2_prospects(status);
create index if not exists idx_v2_prospects_category on public.v2_prospects(category);
create index if not exists idx_v2_prospects_updated on public.v2_prospects(updated_at desc);
create index if not exists idx_v2_prospects_import_batch on public.v2_prospects(import_batch_id);

create table if not exists public.v2_prospect_events (
  id uuid default gen_random_uuid() primary key,
  prospect_id uuid not null references public.v2_prospects(id) on delete cascade,
  actor_type text default 'system' check (actor_type in ('system', 'operator', 'schedule')),
  actor_id text,
  event_type text not null,
  detail jsonb,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_prospect_events_prospect on public.v2_prospect_events(prospect_id);
create index if not exists idx_v2_prospect_events_created on public.v2_prospect_events(created_at desc);

create table if not exists public.v2_prospect_outcomes (
  id uuid default gen_random_uuid() primary key,
  prospect_id uuid not null references public.v2_prospects(id) on delete cascade,
  email_address text not null,
  outcome text not null check (outcome in ('sent', 'replied', 'bounced', 'archived')),
  gmail_message_id text,
  gmail_thread_id text,
  detail jsonb,
  sent_at timestamptz,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_v2_prospect_outcomes_prospect on public.v2_prospect_outcomes(prospect_id);
create index if not exists idx_v2_prospect_outcomes_sent_at on public.v2_prospect_outcomes(sent_at desc);
