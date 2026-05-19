-- Prevents the board-link cron from posting the same meeting more than once
alter table meetings
  add column if not exists board_link_sent boolean default false;
