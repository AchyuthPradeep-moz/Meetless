# Meetless — Claude Code Project Guide

## What is Meetless?
A meeting management web app that connects to Google Calendar and Slack to help users reduce unnecessary meeting load. The system classifies meetings as Important, Async Candidate, or Passive and provides workflows for each.

## Tech Stack
- Frontend: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Database: Supabase (Postgres)
- Auth: NextAuth.js (Google OAuth)
- Slack: Slack Bolt SDK
- Google: Google Calendar API + Google Drive API
- AI: Anthropic Claude API (Haiku) — claude-haiku-4-5-20251001
- Scheduler: Vercel Cron Jobs
- Deployment: Vercel

## Project Structure
- app/(auth)/ — login and onboarding pages, no sidebar layout
- app/(app)/ — main app pages with sidebar layout
- app/api/ — all backend API routes
- lib/ — core logic, never put business logic in API routes
- components/ — reusable UI components
- types/ — TypeScript types
- supabase/migrations/ — database schema

## Core Business Logic

### Meeting Classification
Three categories:
- Important — active participation required
- Async Candidate — could be a status update or doc
- Passive — user only needs to be informed

Each classification has a one-line reason, a confidence score (0-100), and an override button.

### Classification Strategy (lib/classifier.ts)
Always run rule-based filter first — only send ambiguous meetings to Claude:
- title contains "standup", "status", "sync", "all-hands" → async
- attendee_count > 15 → passive
- is_organiser is true → important
- is_recurring and no description → async
- Anything ambiguous → batch send to Claude in ONE single API call

### Token Optimisation Rules
- Never classify the same meeting twice — cache in DB
- Always batch ambiguous meetings into one Claude API call
- Strip meeting data before sending — only title, description (max 200 chars), duration, attendee_count, is_organiser, is_recurring
- Keep all Claude system prompts under 100 tokens
- Use claude-haiku-4-5-20251001 for ALL Claude API calls — never use Sonnet

### Two-Surface Rule
- Website — everything interactive: dashboard, detail, async boards, summaries, settings
- Slack — lightweight only: reminders, notifications, one-click approvals
- Slack never shows full details — always links back to the website

### AI Draft Messages — Critical Rule
AI-generated messages to organisers are NEVER sent automatically.
They always appear in Slack as drafts with Approve and Discard buttons.
Only the status board link is sent automatically at meeting time.

## Google OAuth — Critical Rules
- Always use access_type=offline and prompt=consent to get refresh token
- Always store both access_token and refresh_token in users table
- Before EVERY Google API call, check token_expiry and refresh if expired
- Token refresh logic lives in lib/auth.ts — always use this, never inline it

## Database Tables
- users — google_id, slack_user_id, access_token, refresh_token, token_expiry, digest_time
- meetings — user_id, google_event_id, title, classification, confidence, reason, start_time
- overrides — meeting_id, user_id, original_classification, new_classification
- status_updates — meeting_id, user_id, completed, plan, blockers, status_tag
- summaries — meeting_id, user_id, transcript_text, summary, action_items

## Slack Integration
- Bot token starts with xoxb-
- Users connect Slack from Settings page via OAuth
- After OAuth, store slack_user_id in users table alongside google_id

## Cron Jobs (vercel.json)
- /api/cron/digest — daily 9am UTC
- /api/cron/reminder — every 5 min
- /api/cron/nudge — every 5 min
- /api/cron/board-link — every 1 min

## UI Design Rules
- Clean minimal flat UI — no gradients, no heavy shadows
- White cards with 0.5px light borders
- Color system: green = Important, purple = Async, blue = Passive
- Confidence bar: green above 70%, amber 50-70%, red below 50%
- Desktop only — no mobile responsive needed

## Phase Plan
- Phase I — Classification + dashboard + morning digest + override
- Phase II — 10 min Slack reminders for Important meetings
- Phase III — Async status board + nudge + board link + draft messages
- Phase IV — Passive meeting transcript fetch + Claude summary

## What NOT to do
- Never send AI-generated messages automatically without user approval
- Never reclassify a meeting already in DB unless user overrides
- Never use Sonnet — always Haiku
- Never put business logic directly in API routes — always use lib/ functions
- Never expose SUPABASE_SERVICE_ROLE_KEY to the frontend
- Never add analytics, history, or classification sensitivity settings
