alter table public.v2_prospects
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists opted_out_at timestamptz,
  add column if not exists first_sent_at timestamptz,
  add column if not exists last_follow_up_at timestamptz;

alter table public.v2_prospects
  drop constraint if exists v2_prospects_status_check;

alter table public.v2_prospects
  add constraint v2_prospects_status_check
  check (status in ('new', 'drafted', 'sent', 'replied', 'opted_out', 'archived'));

create table if not exists public.v2_prospect_follow_ups (
  id uuid default gen_random_uuid() primary key,
  prospect_id uuid not null references public.v2_prospects(id) on delete cascade,
  step_number integer not null default 1,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'cancelled')),
  slot_key text,
  draft_subject text,
  draft_body text,
  sent_at timestamptz,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now()),
  unique (prospect_id, step_number)
);

create index if not exists idx_v2_prospect_followups_pending
  on public.v2_prospect_follow_ups(scheduled_at)
  where status = 'pending';

create index if not exists idx_v2_prospect_followups_prospect
  on public.v2_prospect_follow_ups(prospect_id);

grant select, insert, update, delete on public.v2_prospect_follow_ups to service_role;
revoke select, insert, update, delete on public.v2_prospect_follow_ups from anon, authenticated;
alter table public.v2_prospect_follow_ups enable row level security;

insert into public.v2_app_config (key, value) values
  ('prospect_pilot_enabled', 'true'),
  ('prospect_initial_daily_per_category', '10'),
  ('prospect_follow_up_daily_per_category', '10'),
  ('prospect_timezone', 'America/New_York'),
  ('prospect_initial_send_time', '11:00'),
  ('prospect_follow_up_send_time', '23:30'),
  ('prospect_follow_up_delay_days', '3'),
  ('permit_auto_send_enabled', 'false')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
