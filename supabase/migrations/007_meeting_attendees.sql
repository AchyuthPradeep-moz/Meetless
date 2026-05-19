create table meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade,
  email text not null,
  response_status text default 'accepted',
  unique(meeting_id, email)
);
create index on meeting_attendees(meeting_id);
create index on meeting_attendees(email);
