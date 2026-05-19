ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_minutes integer DEFAULT 10;
