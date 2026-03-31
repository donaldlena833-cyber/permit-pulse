alter table public.v2_leads
  drop constraint if exists v2_leads_status_check;

alter table public.v2_leads
  add constraint v2_leads_status_check
  check (status in ('new', 'ready', 'review', 'email_required', 'sent', 'archived'));

update public.v2_leads
set
  status = 'email_required',
  operator_notes = nullif(
    btrim(
      regexp_replace(coalesce(operator_notes, ''), '\[email_required\]\s*', '', 'gi')
    ),
    ''
  ),
  updated_at = timezone('utc', now())
where status = 'review'
  and coalesce(operator_notes, '') ilike '%[email_required]%';
