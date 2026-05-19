-- Disable RLS on all tables — all access goes through supabaseAdmin (service role) on the server.
-- This prevents any silent insert failures if RLS was enabled without policies.
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE meetings DISABLE ROW LEVEL SECURITY;
ALTER TABLE overrides DISABLE ROW LEVEL SECURITY;
ALTER TABLE status_updates DISABLE ROW LEVEL SECURITY;
ALTER TABLE summaries DISABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendees DISABLE ROW LEVEL SECURITY;
