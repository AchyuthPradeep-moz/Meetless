# Meetless — Project Documentation

---

## 1. Project Overview

### What Meetless Does

Meetless is a meeting management assistant that connects to a user's Google Calendar and Slack account to analyse their upcoming meetings, classify each one by type, and automate workflows that reduce unnecessary meeting load.

Every meeting is put into one of three buckets:

| Classification | Meaning | What Meetless does |
|---|---|---|
| **Important** | Requires your active participation | Sends a Slack reminder before it starts |
| **Async Candidate** | Could be a written status update instead | Nudges attendees to submit updates; posts a board summary to the team channel |
| **Passive** | You only need to be informed of the outcome | Fetches the meeting recording from Drive, generates a Claude summary, DMs it to you |

### The Problem It Solves

Knowledge workers spend a large portion of their week in meetings that don't need their real-time presence. A status standup could be a shared doc. A review meeting could be an email. A recurring sync could be a thread. Meetless makes this visible — surfacing which meetings are actually worth attending and automating the alternatives so opting out requires zero friction.

### Who It's For

Small engineering teams (3–15 people) who use Google Workspace and Slack and want to reduce synchronous meeting overhead without losing team coordination. Currently scoped to desktop-only, single-organisation deployments.

---

## 2. Tech Stack

### Next.js 16 (App Router)

**What it is:** A React meta-framework that handles routing, server-side rendering, API routes, and deployment configuration in one package.

**Why not Express + separate React frontend?** With Express you need to manage two deployments, two dev servers, CORS, separate build pipelines, and cookie/session sharing across origins. Next.js collapses all of this — API routes live alongside pages, sessions work out of the box, and Vercel deploys the whole thing from one repo.

**Why not Vite + React?** Vite is a client-side bundler. It doesn't provide server-side rendering, API routes, or server components. You'd need to add a separate backend. Next.js App Router gives us React Server Components (RSC) for zero-JS page loads on the dashboard, API routes for backend logic, and middleware for auth — all from one codebase.

**How it's used here:**
- `app/(app)/` — authenticated pages using RSC for initial data load; client components for interactive state
- `app/(auth)/` — login and onboarding pages with no sidebar
- `app/api/` — all backend logic lives here, imported from `lib/`
- Server components fetch directly from Supabase and pass data as props to client components — no client-side loading states for initial render

### TypeScript

**Why not plain JavaScript?** The project has deeply nested data shapes — meeting rows with 20+ columns, Slack Block Kit payloads, Google Calendar event objects, Claude API responses. Without types, a misnamed field or wrong assumption about nullability is a runtime error in production. With TypeScript, it's a compile error at development time.

**How it's used:** Strict mode is on. All API response shapes are typed in `types/`. All function signatures are typed. `any` is used only where Slack Block Kit or Google API response shapes are genuinely dynamic (and annotated with eslint-disable comments).

### Tailwind CSS

**Why not CSS modules or styled-components?** CSS modules require a separate `.module.css` file per component and context-switching between files. Styled-components adds a runtime overhead and client-side style injection. Tailwind co-locates styles with markup (no file switching), purges unused classes at build time (zero unused CSS in production), and enforces a consistent design system through its spacing/color/typography scale.

**Design system in use:** White cards with `border-gray-200`, flat buttons, no gradients, no heavy shadows. Classification colours: `green` = Important, `purple` = Async, `blue` = Passive. Confidence bars: green above 70%, amber 50–70%, red below 50%.

### Supabase

**What it is:** A hosted Postgres database with a JavaScript client, REST API, real-time subscriptions, and Auth built on top.

**Why not Firebase?** Firebase uses a NoSQL document model (Firestore). Meetless has relational data — meetings reference users, status_updates reference meetings and users, overrides reference meetings. Joins and foreign key constraints are natural in Postgres, awkward in Firestore.

**Why not raw Postgres + Prisma?** Supabase adds the REST/JS client, connection pooling, and hosted infrastructure. Prisma adds type-safe queries. For a project this size, Supabase's auto-generated client and the `supabaseAdmin` pattern are faster to work with than maintaining Prisma schema migrations alongside SQL migrations.

**How it's used:**
- `lib/supabase.ts` exports two clients: `supabase` (anon key, for any future client-side reads) and `supabaseAdmin` (service role key, used in all API routes — bypasses RLS)
- All database access goes through `supabaseAdmin` on the server — the service role key is never sent to the browser

### NextAuth.js

**Why not custom auth?** Building OAuth flows from scratch means handling state parameters, PKCE, token exchange, cookie signing, session serialisation, and CSRF protection. NextAuth handles all of this and supports Google OAuth as a built-in provider.

**Why not Clerk?** Clerk is a hosted auth service that charges per monthly active user. NextAuth is open-source and runs entirely within our Next.js app with no external auth dependency.

**How it's used:**
- Configured in `app/api/auth/[...nextauth]/route.ts`
- Google provider with `access_type: offline` and `prompt: consent` to force refresh token issuance
- Custom `signIn` callback stores `access_token`, `refresh_token`, and `token_expiry` in the `users` Supabase table
- Sessions are JWT-based; `getServerSession(authOptions)` is called at the top of every protected API route

### Google Calendar API

**How OAuth works:** The user clicks "Sign in with Google" which triggers NextAuth's Google provider. NextAuth redirects to Google's consent screen with `scope=calendar.readonly`. Google issues an authorization code which NextAuth exchanges for `access_token` and `refresh_token`. Both are stored in the `users` table.

**Why `access_type=offline` and `prompt=consent` are critical:** `access_type=offline` tells Google to issue a refresh token alongside the access token. Without it, the access token expires in 1 hour and there's no way to get a new one without the user re-authenticating. `prompt=consent` forces the consent screen to appear even if the user has already connected — without it, Google only issues a refresh token on the first authorisation and subsequent logins return no refresh token.

**Token refresh:** `lib/auth.ts` exports `getValidAccessToken(user)`. Before every Google API call, this function checks `user.token_expiry`. If expired (or within 60 seconds of expiry), it calls `https://oauth2.googleapis.com/token` with the stored refresh token, gets a new access token, updates the DB, and returns the fresh token.

**How Calendar data is fetched:** `lib/google.ts` `fetchUpcomingMeetings(user)` calls the Google Calendar `events.list` API for the next 7 days, maps each event to a normalised object (`title`, `start_time`, `duration`, `attendee_count`, `attendee_emails`, `is_organiser`, `is_recurring`, `meet_link`, `google_event_id`).

### Google Drive API

**How transcript fetch works:** `lib/drive.ts` `fetchMeetingTranscript(user, meetingTitle, startTime, durationMins)` searches the user's Drive for a recording file from the meeting. It tries four strategies in order, stopping at the first match:

1. **Exact title match** — `name contains 'EXACT_TITLE'`
2. **First 3 words partial** — `name contains 'FIRST THREE WORDS'`
3. **Same-day transcript** — any `name contains 'transcript'` created on the same day
4. **Meet Recordings folder** — any file in a folder named `Meet Recordings` created on the meeting day

Text is extracted via the Google Docs API if the file is a Google Doc, or read directly if it's a `.vtt` or `.txt` file.

### Slack Bolt + Web API

**Bolt vs Web API — the difference:**

- `@slack/web-api` (`WebClient`) — makes outbound REST calls to Slack: sending messages, posting to channels, opening DMs. Used throughout `lib/slack.ts`.
- `@slack/bolt` — listens for inbound events from Slack: slash commands, button clicks (interactive components), event subscriptions. Used in `app/api/slack/actions/route.ts` for handling approve/discard button clicks.

**When each is used:**
- Sending a morning digest, reminder, nudge, or board link → `WebClient.chat.postMessage`
- User clicks "Send to organiser" or "Discard" in Slack → Bolt's `app.action()` handler in the actions route

**Slack OAuth:** Separate from Google OAuth. The user connects Slack via `/api/slack/oauth` which redirects to Slack's OAuth screen, exchanges the code for a `slack_user_id`, and saves it to the `users` table alongside the existing Google identity.

### Claude AI (Haiku)

**Why Haiku not Sonnet?** `claude-haiku-4-5-20251001` is 10× cheaper and significantly faster than Sonnet. For the tasks here — classify a list of meeting titles, generate a short draft message, summarise a transcript — Haiku performs equivalently to Sonnet. The CLAUDE.md rule is explicit: never use Sonnet in this project.

**Token optimisation strategy:**
- System prompts are kept under 100 tokens
- Meeting data sent for classification is stripped to: `title`, `description` (max 200 chars), `duration`, `attendee_count`, `is_organiser`, `is_recurring` — no raw attendee lists, no full descriptions
- All meetings are batched into a **single** API call rather than one call per meeting
- Classifications are cached in the DB — a meeting is never sent to Claude twice unless the user manually overrides

**How it's used in `lib/claude.ts`:**
- `classifyMeetings(meetings)` — sends all meetings in one batched request, returns `{ classification, confidence, reason }[]`
- `generateDraftMessage(title, classification, reason)` — generates the organiser email draft
- `generateAsyncSummary(updates)` — summarises all status updates into one paragraph
- `generatePassiveSummary(transcript, title)` — generates `{ summary, decisions[], actionItems[] }` from a transcript
- All calls use a `withRetry` wrapper that retries on HTTP 429 and 529 with exponential backoff

### Vercel Cron Jobs

**How it works in production:** `vercel.json` defines cron paths and schedules. Vercel's infrastructure sends an authenticated HTTP GET to each path on schedule. The cron secret (`CRON_SECRET`) should be validated in production to prevent anyone from triggering crons externally.

**Current schedules:**
```
/api/cron/digest      — * * * * *     (every minute, guards with per-user digest_time + last_digest_sent)
/api/cron/reminder    — */5 * * * *   (every 5 minutes)
/api/cron/nudge       — */5 * * * *   (every 5 minutes)
/api/cron/board-link  — * * * * *     (every minute)
/api/cron/transcripts — */5 * * * *   (every 5 minutes)
```

### dev-cron.ts

**Why it's needed locally:** Vercel Cron only runs in production. In development, cron endpoints exist but nothing calls them. `scripts/dev-cron.ts` fills this gap — it runs as a second process alongside `next dev` (via `concurrently` in `npm run dev`) and calls the same HTTP endpoints on the same schedule.

**How it works:**
- Loads `.env.local` via `process.loadEnvFile()` (Node 20.6+ built-in — no dotenv dependency)
- Creates a direct Supabase client for smart pre-checks (avoids calling nudge/board-link when there's nothing to do)
- Calls `/api/cron/reminder` every minute unconditionally
- Before calling `/api/cron/nudge`: queries async meetings starting in 29–31 min; only calls if count > 0
- Before calling `/api/cron/board-link`: queries async meetings starting in 0–60 sec; only calls if count > 0
- Calls `/api/cron/transcripts` every minute
- Checks per-user digest timing: compares current IST HH:MM against each user's `digest_time`; calls `/api/cron/digest` only when a match is found and `last_digest_sent ≠ today`

---

## 3. Authentication & Authorisation

### Google OAuth — Step by Step

1. User visits `/login` and clicks "Sign in with Google"
2. NextAuth redirects to `https://accounts.google.com/o/oauth2/v2/auth` with:
   - `client_id` = Google OAuth client ID
   - `scope` = `openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly`
   - `access_type=offline` — requests a refresh token
   - `prompt=consent` — forces consent screen even for returning users (critical for refresh token)
   - `redirect_uri` = `{NEXTAUTH_URL}/api/auth/callback/google`
3. User grants permission on Google's consent screen
4. Google redirects back with an authorization code
5. NextAuth exchanges the code for `access_token`, `refresh_token`, `token_expiry`
6. NextAuth's `signIn` callback fires:
   - Upserts the `users` table row with `email`, `google_id`, `access_token`, `refresh_token`, `token_expiry`
   - Uses `onConflict('email')` to update tokens if the user already exists
7. NextAuth sets an encrypted session cookie
8. User is redirected to `/dashboard` (or `/onboarding` if Slack isn't connected yet)

### Token Refresh — Before Every Google API Call

```ts
// lib/auth.ts
export async function getValidAccessToken(user: User): Promise<string> {
  const now = new Date()
  const expiry = user.token_expiry ? new Date(user.token_expiry) : null

  // Refresh if expired or within 60 seconds of expiry
  if (!expiry || expiry.getTime() - now.getTime() < 60_000) {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: user.refresh_token!,
      grant_type: 'refresh_token',
    })
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: params,
    })
    const data = await res.json()
    // Update DB with new token + expiry
    await supabaseAdmin.from('users').update({
      access_token: data.access_token,
      token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    }).eq('id', user.id)
    return data.access_token
  }
  return user.access_token!
}
```

### Slack OAuth — Step by Step

1. User visits Settings and clicks "Connect Slack"
2. Browser is redirected to `/api/slack/oauth`
3. The route redirects to Slack's OAuth URL with `scope=chat:write im:write` and `redirect_uri={NEXTAUTH_URL}/api/slack/callback`
4. User approves the Slack app in their workspace
5. Slack redirects back with a code
6. The callback route exchanges the code for a user token, extracting `authed_user.id` (the `slack_user_id`)
7. The route updates `users SET slack_user_id = ? WHERE email = session.email`
8. User is redirected back to `/settings`

### How Google and Slack Identities Are Linked

Both are stored on the same `users` row. Google login populates `google_id`, `access_token`, `refresh_token`. Slack OAuth populates `slack_user_id`. The `email` field is the shared key — Google provides it at login, and Slack OAuth updates the row matched by `session.user.email`.

### How API Routes Are Protected

Every API route calls `getServerSession(authOptions)` at the top. If the session is missing or expired, the route returns `401 Unauthorized`. No middleware is used — auth is checked per-route. The `supabaseAdmin` client used in API routes uses the service role key which bypasses Supabase RLS entirely.

---

## 4. Database Tables

### `users`

Stores Google OAuth credentials and Slack identity for each authenticated user.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Internal user ID |
| `email` | text UNIQUE | Google account email — shared key linking Google and Slack identity |
| `google_id` | text UNIQUE | Google OAuth subject ID (`sub` claim) |
| `slack_user_id` | text | Slack user ID (`Uxxx...`). Null until Slack is connected |
| `access_token` | text | Current Google OAuth access token |
| `refresh_token` | text | Google OAuth refresh token — never expires unless revoked |
| `token_expiry` | timestamptz | When `access_token` expires |
| `digest_time` | text | IST HH:MM when the morning digest should fire (default `09:00`) |
| `reminder_minutes` | integer | How many minutes before an Important meeting to send a reminder (default 10) |
| `last_digest_sent` | date | IST date of last digest send — prevents double-sending |
| `created_at` | timestamptz | Row creation time |

**Key queries:**
```sql
-- Find users due for digest
SELECT * FROM users WHERE slack_user_id IS NOT NULL AND digest_time = '09:00';

-- Update Slack identity after OAuth
UPDATE users SET slack_user_id = ? WHERE email = ?;
```

---

### `meetings`

One row per user per Google Calendar event. The same calendar event appears as multiple rows if multiple Meetless users attend it — each user's row stores their personal flags (`is_organiser`, `reminder_sent`, etc.).

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Internal meeting ID |
| `user_id` | uuid FK → users | Whose calendar this meeting came from |
| `google_event_id` | text | Google Calendar event ID — same across all users for the same event |
| `title` | text | Meeting title |
| `description` | text | Meeting description (raw from Calendar) |
| `start_time` | timestamptz | Meeting start (UTC) |
| `end_time` | timestamptz | Meeting end (UTC) — computed as `start_time + duration` |
| `duration` | integer | Duration in minutes |
| `attendee_count` | integer | Number of attendees |
| `attendee_emails` | text[] | Array of attendee email addresses |
| `organiser_email` | text | Email of the meeting organiser |
| `is_organiser` | bool | Whether this user organised this meeting |
| `is_recurring` | bool | Whether this is a recurring event |
| `meet_link` | text | Google Meet URL if present |
| `classification` | text | `important` / `async` / `passive` |
| `confidence` | integer | 0–100 confidence from Claude |
| `reason` | text | One-line explanation of the classification |
| `draft_message` | text | Claude-generated draft to the organiser |
| `draft_sent` | bool | Whether the draft has been sent to the organiser |
| `draft_sent_by_user_id` | uuid FK → users | Which user approved and sent the draft |
| `draft_sent_to_slack_user_id` | text | Slack user ID the draft was sent to (for reply relay) |
| `outcome` | text | `cancelled` / `async` / `happened` — recorded after draft sent |
| `async_summary` | text | Claude-generated summary of all status updates |
| `reminder_sent` | bool | Whether a 10-min reminder has been sent for this meeting |
| `board_link_sent` | bool | Whether the status board has been posted to the team channel |
| `nudge_sent` | bool | Whether the 30-min async nudge has been sent |

**Unique constraint:** `(user_id, google_event_id)` — each user can only have one row per Calendar event.

**Cross-user queries use `google_event_id`:**
```sql
-- Find all meeting rows for the same calendar event
SELECT id FROM meetings WHERE google_event_id = ?;

-- Mark nudge_sent across all attendees' rows
UPDATE meetings SET nudge_sent = true WHERE google_event_id = ?;
```

---

### `status_updates`

One row per attendee submission for an async meeting. Attendees may submit against different `meeting_id` values (their own row vs the board URL's row) — queries always join via `google_event_id` to collect all submissions.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `meeting_id` | uuid FK → meetings | Which meeting row this was submitted against |
| `user_id` | uuid FK → users | Who submitted |
| `completed` | text | What they completed since last meeting |
| `plan` | text | What they plan to do today |
| `blockers` | text | Any blockers (nullable) |
| `status_tag` | text | `done` / `in-progress` / `blocked` |
| `submitted_at` | timestamptz | Submission timestamp |

---

### `summaries`

Stores AI-generated post-meeting summaries for passive meetings.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `meeting_id` | uuid FK → meetings | Which meeting this summary is for |
| `user_id` | uuid FK → users | Whose meeting row (the host who recorded) |
| `transcript_text` | text | Raw transcript fetched from Drive |
| `summary` | text | Claude-generated summary paragraph |
| `action_items` | text | JSON-stringified array of action items |
| `created_at` | timestamptz | |

---

### `overrides`

Records user-initiated reclassifications. The `meetings.classification` column is updated directly; this table provides an audit trail.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `meeting_id` | uuid FK → meetings | Which meeting was overridden |
| `user_id` | uuid FK → users | Who overrode it |
| `original_classification` | text | What Claude originally said |
| `new_classification` | text | What the user changed it to |
| `overridden_at` | timestamptz | |

---

### `meeting_attendees`

Normalised attendee list for a meeting, populated from Google Calendar `event.attendees`. Used as a more reliable source than the `attendee_emails` array when delivering passive summaries.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `meeting_id` | uuid FK → meetings | |
| `email` | text | Attendee email |
| `response_status` | text | `accepted` / `tentative` / `declined` / `needsAction` |

**Unique constraint:** `(meeting_id, email)` — one row per attendee per meeting.

---

## 5. Feature Implementation

### 5.1 Meeting Classification

**Fetching Google Calendar data — `lib/google.ts`**

`fetchUpcomingMeetings(user)` calls the Google Calendar `events.list` API for the primary calendar, requesting the next 7 days of events. For each event it extracts:

```ts
{
  google_event_id: event.id,
  title: event.summary,
  description: event.description,
  start_time: event.start.dateTime,
  duration: Math.round((end - start) / 60000),
  attendee_count: event.attendees?.length ?? 1,
  attendee_emails: event.attendees?.map(a => a.email) ?? [],
  is_organiser: event.organizer?.email === calendarEmail,
  is_recurring: !!event.recurringEventId,
  meet_link: // extracted from conferenceData or description
  organiser_email: event.organizer?.email,
}
```

**Batched Claude call — `lib/classifier.ts` + `lib/claude.ts`**

All meetings go directly to Claude — there is no rule-based pre-filter. `classifyMeetings(meetings)` calls `batchClassify(meetings)` which sends every meeting to Claude in a single `messages.create` call:

```
System (< 100 tokens):
  Classify meetings. Return JSON array with classification, confidence (0-100), reason (one line).

User:
  [{"title":"...", "description":"...(max 200 chars)", "duration":60, "attendee_count":5,
    "is_organiser":false, "is_recurring":true}, ...]
```

Claude returns a JSON array in the same order. If Claude returns an invalid classification value, `classifyMeetings` defaults it to `async` with confidence 50 and logs an error. Meetings already in the DB with a classification are skipped by the caller — never re-sent to Claude.

**Confidence score:** Returned directly from Claude (0–100). The UI shows it as a coloured bar: green ≥70, amber 50–69, red <50.

**Storing overrides — `app/api/meetings/override/route.ts`**

```ts
// PATCH — updates meetings.classification + inserts into overrides
await supabaseAdmin.from('meetings').update({ classification: newClassification }).eq('id', meetingId)
await supabaseAdmin.from('overrides').insert({ meeting_id, user_id, original_classification, new_classification })
```

Overrides are permanent — the next classification run skips any meeting already in the DB.

---

### 5.2 Morning Digest

**Per-user timing:** Each user stores `digest_time` as an IST HH:MM string (e.g. `"08:30"`). The digest cron runs every minute. The server-side handler computes the current IST time, queries users whose `digest_time` matches, and skips users whose `last_digest_sent` equals today's IST date.

**Dev-cron check:**
```ts
const currentHHMM = new Date().toLocaleTimeString('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata'
}).slice(0, 5) // "HH:MM"
const due = users.filter(u => (u.digest_time ?? '09:00') === currentHHMM && u.last_digest_sent !== today)
```

**Slack Block Kit message — `lib/slack.ts` `sendMorningDigest()`:**

1. Computes IST-aware greeting: `Good morning` (before 12), `Good afternoon` (12–17), `Good evening` (17+)
2. For zero meetings: sends a plain "Enjoy the focus time!" message
3. For meetings: builds a Block Kit array with:
   - Header: `Good morning {firstName}! ☀️`
   - Section: date string (IST)
   - Divider
   - One Section block per meeting: `*Title*\n{emoji} {label} • {time} • {duration} min` with a "View Details" button
   - Async count summary if any
   - "Open Dashboard →" action button

**Duplicate prevention:** After sending, `last_digest_sent` is set to today's IST date (`en-CA` locale gives `YYYY-MM-DD`). The next minute's cron run skips this user.

---

### 5.3 Meeting Reminders

**Per-user timing:** `users.reminder_minutes` stores the preferred lead time (5, 10, 15, or 30 minutes). The reminder cron runs every 5 minutes and builds a per-user window of `[now, now + reminder_minutes + 1 minute]`.

**Window logic in `lib/scheduler.ts` `runReminder()`:**
```ts
const buffer = user.reminder_minutes ?? 10
const windowEnd = new Date(now.getTime() + (buffer + 1) * 60 * 1000)
// Filter: important, not reminder_sent, start_time in [now, windowEnd]
```

The `+1 minute` buffer ensures a meeting that starts at exactly the window edge is still caught even if the cron fires slightly late.

**Duplicate prevention:** After sending, `meetings.reminder_sent = true`. The query filters `WHERE reminder_sent = false`, so each meeting gets exactly one reminder.

**Slack message — `lib/slack.ts` `sendMeetingReminder(slackUserId, title, meetLink, minutes)`:**
```
⏰ Your meeting *{title}* starts in {minutes} minutes!
[Join Meeting button — only shown if meet_link exists]
```

---

### 5.4 Async Status Board

**Attendee identification:** When `GET /api/meetings` syncs from Google Calendar, it upserts `meeting_attendees` rows for each event using `event.attendees[].email` and `responseStatus`. This is the canonical attendee list. The `attendee_emails` array on the `meetings` row is also populated as a fallback.

**Status form UX state machine** (`app/(app)/async/[id]/AsyncBoardClient.tsx`):

```
State 1: Not submitted + meeting not started + not organiser
  → Show full submission form

State 2: Submitted OR organiser OR meeting already started
  → Show dashboard (all updates, pending members, AI summary)
  → If meeting started but not submitted → amber "Add my update" bar with inline form
```

**Real-time updates:** On entering the dashboard state, a `setInterval(fetchBoard, 30_000)` effect fires every 30 seconds and re-fetches `/api/async/status?meeting_id={id}`. A manual "Refresh" button also calls `fetchBoard()` immediately.

**Cross-user data collection:** The GET handler resolves `google_event_id` from the URL's meeting ID, finds all sibling meeting rows (`WHERE google_event_id = ?`), then queries `status_updates.in('meeting_id', allSiblingIds)`. This ensures all attendees see all submissions regardless of which meeting row ID they submitted against.

**AI summary — `lib/claude.ts` `generateAsyncSummary(updates)`:**
Called after the first submission. Sends all `completed` + `plan` + `blockers` fields to Claude Haiku with the prompt: "Summarise these team status updates in 2-3 sentences. Be concise and focus on what the team accomplished and what they're working on." Saved to `meetings.async_summary`.

**Nudge flow — `lib/scheduler.ts` `runAsyncNudge()`:**
1. Query async meetings starting in 29–31 minutes, `nudge_sent = false`
2. Deduplicate by `google_event_id` (one entry per calendar event, not per user row)
3. For each unique meeting: find Meetless users whose email is in `attendee_emails`, filter to those with `slack_user_id`
4. For each user: skip if they already submitted; otherwise call `sendAsyncNudge()`
5. Update `nudge_sent = true WHERE google_event_id = ?` (marks all sibling rows)

**Board link to #meeting channel — `app/api/cron/board-link/route.ts`:**
1. Query async meetings that started in the last 0–60 seconds, `board_link_sent = false`
2. Deduplicate by `google_event_id`
3. For each event: find all sibling meeting IDs, count `status_updates.in('meeting_id', allIds)`
4. Call `sendBoardToChannel(meetingId, title, submittedCount, totalCount, summary)`
5. DM the meeting owner with a direct board link
6. Update `board_link_sent = true WHERE google_event_id = ?`

---

### 5.5 Draft Messages

**Claude generates the draft — `app/api/meetings/draft/route.ts`:**

```ts
// Calls lib/claude.ts generateDraftMessage()
const draft = await generateDraftMessage(meeting.title, meeting.classification, meeting.reason)
// Saves to meetings.draft_message
// Calls sendDraftMessageForApproval() — sends to user's Slack DM
```

The Claude prompt varies by classification:
- `async` → draft asks the organiser if the meeting could be replaced with a status doc/async update
- `passive` → draft asks the organiser if passive attendees could receive a summary instead

**Slack approval flow — `lib/slack.ts` `sendDraftMessageForApproval()`:**

Sends a Block Kit message to the user's Slack DM with:
- The draft text rendered as a blockquote
- "Send to organiser" button (`action_id: approve_draft`, `value: approve_{meetingId}`)
- "Discard" button (`action_id: discard_draft`, `value: discard_{meetingId}`)

**AI-generated messages are NEVER sent automatically.** The user must click "Send to organiser" in Slack.

**Approve/discard handler — `app/api/slack/actions/route.ts`:**

```ts
app.action('approve_draft', async ({ body, ack, respond }) => {
  await ack()
  // Look up meeting from value: "approve_{meetingId}"
  // DM the organiser via their slack_user_id (if they have Meetless)
  // OR send via email relay (if organiser has no Slack)
  // Update meetings.draft_sent = true
  // Call sendOutcomeTracking() — sends three outcome buttons to the user
})

app.action('discard_draft', async ({ body, ack, respond }) => {
  await ack()
  await respond({ text: 'Draft discarded.' })
})
```

**Outcome tracking — `app/api/meetings/outcomes/route.ts`:**

When the user clicks an outcome button in Slack (`outcome_cancelled`, `outcome_async`, `outcome_happened`), the action handler updates `meetings.outcome`. This data can be used to measure the impact of async/passive nudges over time.

---

### 5.6 Passive Meeting Summaries

**Cron trigger — `app/api/cron/transcripts/route.ts`:**

Runs every 5 minutes. Queries passive meetings with `end_time` in the last 24 hours where no summary exists yet. For each meeting, fetches user credentials from the DB, calls `fetchMeetingTranscript()`, generates a summary, saves it, and delivers to attendees.

**Drive transcript search — `lib/drive.ts` `fetchMeetingTranscript()`:**

Four strategies tried in order:
```ts
// Strategy 1: exact title
q = `name contains '${meetingTitle}' and mimeType contains 'video'`

// Strategy 2: first 3 words
const words = meetingTitle.split(' ').slice(0, 3).join(' ')
q = `name contains '${words}'`

// Strategy 3: same-day transcript
q = `name contains 'transcript' and createdTime >= '${startOfDay}' and createdTime <= '${endOfDay}'`

// Strategy 4: Meet Recordings folder
q = `'Meet Recordings' in parents and createdTime >= '${startOfDay}'`
```

Text is extracted via `extractText(fileId, mimeType)`:
- Google Docs → Google Docs API `documents.get`, extracts all paragraph text
- Other (`.vtt`, `.txt`) → Drive API `files.export` or `files.get` with `alt=media`

**Claude summary — `lib/claude.ts` `generatePassiveSummary(transcript, title)`:**

```
System: "You are a meeting summariser. Extract key information from this meeting transcript."
User: "Meeting: {title}\nTranscript:\n{transcript}\n\nProvide: summary (2-3 sentences), decisions (bullet list), action items (bullet list). Return as JSON."
```

Returns `{ summary: string, decisions: string[], actionItems: string[] }`.

**Delivery — `lib/summaries.ts` `deliverSummaryToPassiveAttendees()`:**

1. Look up attendees from `meeting_attendees` table; fall back to `attendee_emails` array
2. Find Meetless users with those emails (`SELECT * FROM users WHERE email IN (...)`)
3. For each user with `slack_user_id`: call `sendPassiveSummary()` with summary, decisions, action items, and a link to `/summaries/{meetingId}`
4. Call `sendSummaryConfirmation()` to the host's Slack to confirm dispatch

---

## 6. File Structure

### `lib/`

| File | Purpose | Key exports |
|---|---|---|
| `auth.ts` | Google OAuth token management | `getValidAccessToken(user)` — checks expiry, refreshes if needed, updates DB |
| `classifier.ts` | Meeting classification orchestrator | `classifyMeetings(meetings)` — sends all meetings to Claude in one batch, validates results |
| `claude.ts` | All Claude Haiku API calls | `classifyMeetings`, `generateDraftMessage`, `generateAsyncSummary`, `generatePassiveSummary`, `withRetry` |
| `drive.ts` | Google Drive transcript fetching | `fetchMeetingTranscript(user, title, startTime, duration)`, `searchDrive(auth, q)`, `extractText(auth, fileId, mimeType)` |
| `google.ts` | Google Calendar data fetch | `fetchUpcomingMeetings(user)` — normalises Calendar events to internal shape |
| `scheduler.ts` | Cron job logic | `runDailyDigest`, `runReminder`, `runAsyncNudge` |
| `slack.ts` | All Slack message sending | `sendDM`, `sendMorningDigest`, `sendMeetingReminder`, `sendAsyncNudge`, `sendBoardToChannel`, `sendPassiveSummary`, `sendSummaryConfirmation`, `sendDraftMessageForApproval`, `sendOutcomeTracking` |
| `supabase.ts` | Supabase client setup | `supabase` (anon), `supabaseAdmin` (service role) |
| `summaries.ts` | Passive summary delivery orchestrator | `deliverSummaryToPassiveAttendees(hostMeetingId, googleEventId, title, summary, decisions, actionItems, hostSlackId)` |

### `app/api/`

| Route | Method | Purpose |
|---|---|---|
| `auth/[...nextauth]` | GET/POST | NextAuth handler — Google OAuth, session |
| `meetings` | GET | Sync from Google Calendar, classify new meetings, return list |
| `meetings/classify` | POST | Re-classify a single meeting on demand |
| `meetings/override` | PATCH | Store user reclassification |
| `meetings/draft` | POST | Generate Claude draft + send to user's Slack for approval |
| `meetings/draft/send` | POST | Programmatic draft send (non-Slack path) |
| `meetings/outcomes` | PATCH | Record meeting outcome after draft approval |
| `async/status` | GET | Fetch all submissions for a meeting (cross-user via google_event_id) |
| `async/status` | POST | Save one attendee's status update |
| `async/summary` | POST | Generate/regenerate async AI summary |
| `async/nudge/[userId]` | POST | Manual nudge from organiser's board view |
| `slack/oauth` | GET | Initiate Slack OAuth flow |
| `slack/actions` | POST | Handle Slack interactive button clicks (approve/discard/outcome) |
| `slack/events` | POST | Handle Slack event subscriptions (message replies) |
| `google/calendar` | GET | Direct calendar proxy (used in onboarding) |
| `google/drive` | GET | Direct Drive proxy |
| `summaries` | GET | List all summaries for the current user |
| `summaries/generate` | POST | Manually trigger passive summary generation |
| `summaries/notify` | POST | Manually trigger summary delivery |
| `user/preferences` | PATCH | Update `digest_time` and `reminder_minutes` |
| `user/status` | GET | Check connection status (Google + Slack) |
| `settings/disconnect-google` | POST | Clear Google tokens from users row |
| `settings/disconnect-slack` | POST | Clear `slack_user_id` from users row |
| `cron/digest` | GET | Morning digest cron handler |
| `cron/reminder` | GET | Meeting reminder cron handler |
| `cron/nudge` | GET | Async nudge cron handler |
| `cron/board-link` | GET | Status board channel post cron handler |
| `cron/transcripts` | GET | Passive transcript + summary cron handler |

### `app/(auth)/`

| File | Purpose |
|---|---|
| `login/page.tsx` | Login page — "Sign in with Google" button, no sidebar layout |
| `onboarding/page.tsx` | Post-login setup — prompt to connect Slack before going to dashboard |

### `app/(app)/`

| File | Purpose |
|---|---|
| `layout.tsx` | App shell — wraps all app pages with `Sidebar` + `Topbar` |
| `dashboard/page.tsx` | Server component — fetches meetings from DB, passes to client |
| `dashboard/DashboardClient.tsx` | Client component — sync button, meeting cards, classification filters |
| `meetings/[id]/page.tsx` | Server component — single meeting detail view with classification, confidence, draft controls |
| `async/[id]/page.tsx` | Server component — resolves all sibling meeting rows, checks submission state, initial SSR data |
| `async/[id]/AsyncBoardClient.tsx` | Client component — status form state machine, dashboard, auto-refresh, AI summary |
| `settings/page.tsx` | Server component — reads connection state from DB |
| `settings/SettingsClient.tsx` | Client component — connect/disconnect Google/Slack, digest time, reminder minutes |
| `summaries/page.tsx` | Server component — lists all summaries for user |
| `summaries/SummariesClient.tsx` | Client component — summary list UI |
| `summaries/[meetingId]/page.tsx` | Server component — loads one summary |
| `summaries/[meetingId]/SummaryDetailClient.tsx` | Client component — summary, decisions, action items, share button |

### `components/`

| File | Purpose |
|---|---|
| `layout/Sidebar.tsx` | Left nav: Dashboard, Summaries, Settings links + active state |
| `layout/Topbar.tsx` | Top bar: page title + user avatar/email |
| `meetings/ClassificationBadge.tsx` | Coloured pill: Important (green), Async (purple), Passive (blue) |
| `meetings/ConfidenceBar.tsx` | Horizontal bar with green/amber/red colour based on confidence score |
| `meetings/MeetingCard.tsx` | Single meeting row in dashboard list |
| `meetings/DraftMessage.tsx` | Draft message textarea + send button in meeting detail |
| `meetings/OverrideButton.tsx` | Three-button reclassification control |
| `async/StatusBoard.tsx` | Status board container (used in shared views) |
| `async/StatusCard.tsx` | One attendee's submitted update card |

### `types/`

| File | Exports |
|---|---|
| `user.ts` | `User` — matches the `users` table schema |
| `meeting.ts` | `Meeting` — matches the `meetings` table schema including all phase columns |
| `classification.ts` | `Classification` (`'important' \| 'async' \| 'passive'`), `ClassificationResult` |
| `slack.ts` | Slack action payload types for the actions route |

### `scripts/`

| File | Purpose |
|---|---|
| `dev-cron.ts` | Local cron simulator. Runs as a second process via `concurrently`. Smart pre-checks before calling nudge/board-link. Per-user digest timing. |

---

## 7. Environment Variables

| Variable | Service | How to obtain | Where used | Frontend safe? |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Project Settings → API → Project URL | `lib/supabase.ts` — both clients | Yes (`NEXT_PUBLIC_`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Project Settings → API → `anon public` key | `lib/supabase.ts` — anon client | Yes (`NEXT_PUBLIC_`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Project Settings → API → `service_role` key | `lib/supabase.ts` — admin client only | **No — never expose** |
| `GOOGLE_CLIENT_ID` | Google OAuth | GCP Console → APIs & Services → Credentials | `app/api/auth/[...nextauth]/route.ts`, `lib/auth.ts` | No |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | GCP Console → APIs & Services → Credentials | `app/api/auth/[...nextauth]/route.ts`, `lib/auth.ts` | No |
| `NEXTAUTH_SECRET` | NextAuth | Generate: `openssl rand -base64 32` | NextAuth session encryption | No |
| `NEXTAUTH_URL` | NextAuth | Your deployment URL (e.g. `https://meetless.vercel.app`) | NextAuth callbacks, Slack URLs, async board links in DMs | No |
| `SLACK_BOT_TOKEN` | Slack | Slack App → OAuth & Permissions → Bot User OAuth Token (starts `xoxb-`) | `lib/slack.ts` — `WebClient` | No |
| `SLACK_SIGNING_SECRET` | Slack | Slack App → Basic Information → Signing Secret | `app/api/slack/actions/route.ts` — Bolt signature verification | No |
| `SLACK_CLIENT_ID` | Slack | Slack App → Basic Information → App Credentials | `/api/slack/oauth` redirect URL | No |
| `SLACK_CLIENT_SECRET` | Slack | Slack App → Basic Information → App Credentials | `/api/slack/oauth` code exchange | No |
| `SLACK_MEETING_CHANNEL_ID` | Slack | Channel settings → copy channel ID (starts `C`) | `lib/slack.ts` `sendBoardToChannel()` | No |
| `ANTHROPIC_API_KEY` | Anthropic | console.anthropic.com → API Keys | `lib/claude.ts` — all Claude calls | No |

---

## 8. Cron Jobs

### `/api/cron/digest` — Morning Digest

**Schedule:** Every minute in production (`* * * * *`); per-user IST time match in dev-cron.

**Step by step:**
1. Compute current IST HH:MM
2. Query `users WHERE slack_user_id IS NOT NULL AND refresh_token IS NOT NULL AND digest_time = {currentHHMM}`
3. For each user: skip if `last_digest_sent = today (IST)`
4. Query today's meetings from DB (UTC window for IST day)
5. If no DB meetings: fetch from Google Calendar, classify new ones, persist
6. Call `sendMorningDigest(slackUserId, firstName, meetings)`
7. Update `last_digest_sent = today` on the user row

**Duplicate prevention:** `last_digest_sent` date check. Even if the cron fires every minute, only the first match of the day goes through.

**Manual test:** `GET /api/cron/digest?test=true` — sends to all connected users immediately, ignores `digest_time` and `last_digest_sent`.

---

### `/api/cron/reminder` — Meeting Reminder

**Schedule:** Every 5 minutes (`*/5 * * * *`).

**Step by step:**
1. Query all users with `slack_user_id`
2. For each user: fetch their important meetings that haven't had a reminder sent
3. Filter to meetings whose `start_time` is within `[now, now + reminder_minutes + 1 min]`
4. Call `sendMeetingReminder(slackUserId, title, meetLink, reminderMinutes)`
5. Update `reminder_sent = true` on each sent meeting

**Duplicate prevention:** `reminder_sent = false` filter. Each meeting gets exactly one reminder.

**Manual test:** `GET /api/cron/reminder?test=true` — sends for all important meetings ignoring time window and `reminder_sent`.

---

### `/api/cron/nudge` — Async Nudge

**Schedule:** Every 5 minutes (`*/5 * * * *`).

**Step by step:**
1. Query async meetings with `start_time` in `[now + 29min, now + 31min]` and `nudge_sent = false`
2. Deduplicate by `google_event_id` — one calendar event = one nudge run regardless of how many user rows exist
3. For each unique event: find Meetless users whose email is in `attendee_emails` with `slack_user_id`
4. For each user: skip if they already submitted; call `sendAsyncNudge(slackUserId, title, meetingId)`
5. Update `nudge_sent = true WHERE google_event_id = ?` — marks all sibling rows at once

**Duplicate prevention:** `nudge_sent` flag + dedup by `google_event_id`.

**Manual test:** `GET /api/cron/nudge?test=true` — sends for all async meetings regardless of time.

---

### `/api/cron/board-link` — Status Board to Channel

**Schedule:** Every minute (`* * * * *`).

**Step by step:**
1. Query async meetings with `start_time` in `[now - 60sec, now]` and `board_link_sent = false`
2. Deduplicate by `google_event_id`
3. For each unique event: find all sibling meeting IDs, count `status_updates` across all of them
4. Call `sendBoardToChannel(meetingId, title, submittedCount, totalCount, summary)` — posts to `#SLACK_MEETING_CHANNEL_ID`
5. DM the meeting owner with board link + submitted/total count
6. Update `board_link_sent = true WHERE google_event_id = ?`

**Duplicate prevention:** `board_link_sent` flag + dedup by `google_event_id`.

**Manual test:** `GET /api/cron/board-link?test=true`.

---

### `/api/cron/transcripts` — Passive Meeting Summaries

**Schedule:** Every 5 minutes (`*/5 * * * *`).

**Step by step:**
1. Query passive meetings with `end_time` in the last 24 hours where no summary row exists
2. For each meeting: load user credentials via `getValidAccessToken(user)`
3. Try all four Drive search strategies to find the recording
4. If transcript found: call `generatePassiveSummary(transcript, title)` → Claude Haiku
5. Insert row into `summaries` table
6. Call `deliverSummaryToPassiveAttendees()` → DMs each passive attendee who has Slack
7. DM the host with a confirmation

**Duplicate prevention:** The query filters to meetings with no existing `summaries` row. Processed meetings won't appear on the next run.

**Manual test:** `GET /api/cron/transcripts?include_past=true` — extends the lookback window.

---

## 9. Deployment Guide

### Step 1 — Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Run all migrations in order from `supabase/migrations/` using the Supabase SQL editor:
   ```
   001_initial.sql → 002_async_columns.sql → 003_draft_columns.sql →
   004_outcome_columns.sql → 005_board_link_sent.sql → 006_last_digest_sent.sql →
   007_meeting_attendees.sql → 008_end_time.sql → 009_reminder_minutes.sql →
   010_nudge_sent.sql → 011_disable_rls.sql
   ```
3. Copy the project URL, anon key, and service role key from Project Settings → API

### Step 2 — Google OAuth Setup

1. Go to GCP Console → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Under "Authorised redirect URIs" add:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://your-domain.vercel.app/api/auth/callback/google` (production)
4. Enable the **Google Calendar API** and **Google Drive API** in APIs & Services → Library
5. Copy Client ID and Client Secret

### Step 3 — Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. Under **OAuth & Permissions** → Bot Token Scopes, add: `chat:write`, `im:write`, `channels:read`
3. Under **Interactivity & Shortcuts** → enable and set Request URL to:
   `https://your-domain.vercel.app/api/slack/actions`
4. Under **Event Subscriptions** → enable and set Request URL to:
   `https://your-domain.vercel.app/api/slack/events`
5. Under **OAuth & Permissions** → Redirect URLs, add:
   `https://your-domain.vercel.app/api/slack/callback`
6. Install the app to your workspace
7. Copy: Bot User OAuth Token (`xoxb-...`), Signing Secret, Client ID, Client Secret
8. Create or find the `#meeting` channel and copy its channel ID

### Step 4 — Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key
2. Copy the key (`sk-ant-api03-...`)

### Step 5 — Deploy to Vercel

1. Push the repo to GitHub
2. Import the repo in Vercel dashboard
3. Set all environment variables in Vercel → Project → Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET           ← generate: openssl rand -base64 32
NEXTAUTH_URL              ← https://your-domain.vercel.app
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_MEETING_CHANNEL_ID
ANTHROPIC_API_KEY
```

4. Deploy — Vercel reads `vercel.json` and automatically registers the 5 cron jobs

### Step 6 — Update Redirect URIs for Production

After your Vercel URL is assigned:
- **Google:** GCP Console → Credentials → your OAuth client → add the production callback URI
- **Slack:** api.slack.com → your app → Interactivity → update Request URL; OAuth → update Redirect URL
- **NextAuth:** Update `NEXTAUTH_URL` environment variable in Vercel to your production domain

### Supabase RLS

RLS is disabled on all tables via `011_disable_rls.sql`. All database access goes through `supabaseAdmin` (service role) in API routes — the service role bypasses RLS regardless. If you add client-side Supabase calls in the future, you'll need to add RLS policies before re-enabling.

---

## 10. Known Limitations & Future Improvements

### Current Limitations

**Drive transcript detection is heuristic.** The four-strategy search works well for Google Meet recordings saved to Drive with default naming, but will miss recordings saved with custom names, in non-default folders, or on third-party platforms (Zoom, Teams).

**One meeting row per user creates complexity.** Because each user has their own `meetings` row for the same Calendar event, queries that need cross-user data must first resolve `google_event_id` and then find all sibling rows. The status board, nudge, and board-link cron all do this correctly, but any new feature touching multi-user meeting data must follow the same pattern.

**IST timezone is hardcoded.** All digest timing, date formatting, and greeting logic uses `Asia/Kolkata`. The system would need a `users.timezone` column and dynamic `Intl.DateTimeFormat` calls to support other timezones.

**No mobile responsive layout.** The UI is desktop-only by design. A mobile layout would require significant component changes, particularly the dashboard grid and async board.

**Slack nudge sends one DM per attendee who has Meetless.** If an attendee connects Meetless after the nudge fires, they won't receive one. There's no retroactive nudge for late joiners.

**Transcript quality depends on recording settings.** If the meeting host doesn't record, or doesn't save to Drive, the passive summary cron finds nothing and silently skips the meeting. There's no fallback and no user notification.

**No rate limiting on API routes.** A user could spam the draft generation endpoint or the sync endpoint. For an internal team tool this is acceptable; a multi-tenant product would need rate limiting per user.

### What Phase V Could Include

- **Timezone support** — `users.timezone` column, dynamic digest scheduling
- **Meeting trends dashboard** — charts showing how many meetings were cancelled/async'd/happened, time saved per week
- **Multi-calendar support** — sync from multiple Google Calendar accounts per user
- **Slack thread relay** — capture the organiser's Slack reply to a draft and display it in the web UI
- **Direct calendar write** — decline a meeting directly from the Meetless UI using the Calendar `events.patch` API
- **Classification sensitivity settings** — per-user prompt tuning or confidence thresholds for Claude's classification
- **Zapier/webhook integration** — fire a webhook when a meeting is classified, so teams can route to their own tooling

### Scalability Considerations

**Database:** Supabase's free tier supports 500MB storage and unlimited API requests. At 50 users with 10 meetings/day, the `meetings` table grows by ~500 rows/day — well within free tier. The first pressure point is the `status_updates` table if async boards scale to large teams.

**Cron frequency:** The digest and board-link crons run every minute on Vercel. Vercel's free tier allows 2 cron jobs; the Pro plan allows unlimited. With 5 cron jobs, the Pro plan is required.

**Google API quotas:** The Calendar API has a default limit of 1,000,000 queries/day and 100 queries/100 seconds/user. At current scale this is not a concern. The `fetchUpcomingMeetings` call is cached in the DB for the day — the cron only calls Google if the DB is empty for the day.

**Claude API:** Haiku is charged per token. The batch classification call for a user with 10 meetings sends roughly 500 input tokens and receives ~200 output tokens — about $0.001 per user per day at current Haiku pricing. Passive transcript summaries are longer but still sub-cent per meeting.

**Slack rate limits:** Slack allows 1 message/second per channel and 20,000 messages/day per workspace. Even at 100 users all receiving a morning digest simultaneously, that's well within limits.
