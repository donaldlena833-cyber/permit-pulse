create table if not exists public.resolution_candidates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  candidate_type text not null,
  role text not null default '',
  label text not null,
  url text not null default '',
  domain text not null default '',
  source text not null default '',
  confidence numeric(5,2) not null default 0,
  status text not null default 'candidate',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists resolution_candidates_lead_idx
  on public.resolution_candidates (lead_id, candidate_type, confidence desc);

grant select, insert, update, delete on public.resolution_candidates to service_role;
revoke select, insert, update, delete on public.resolution_candidates from anon, authenticated;

alter table public.resolution_candidates enable row level security;
