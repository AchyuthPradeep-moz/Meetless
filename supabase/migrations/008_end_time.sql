ALTER TABLE meetings ADD COLUMN IF NOT EXISTS end_time timestamptz;

-- Backfill end_time for existing rows that have both start_time and duration
UPDATE meetings
SET end_time = start_time + (duration * interval '1 minute')
WHERE end_time IS NULL
  AND start_time IS NOT NULL
  AND duration IS NOT NULL;
