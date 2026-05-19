-- Columns required for draft-message-to-organiser feature (Phase III)

alter table meetings
  add column if not exists organiser_email text,
  add column if not exists draft_message text,
  add column if not exists draft_sent boolean default false;
