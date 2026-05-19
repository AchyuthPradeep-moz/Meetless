-- Add columns required for Phase II/III async features

alter table meetings
  add column if not exists attendee_emails text[] default '{}',
  add column if not exists async_summary text,
  add column if not exists reminder_sent bool default false;
