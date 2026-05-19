-- Columns for two-way relay and outcome tracking

alter table meetings
  add column if not exists outcome text,
  add column if not exists draft_sent_to_slack_user_id text,
  add column if not exists draft_sent_by_user_id uuid references users(id);
