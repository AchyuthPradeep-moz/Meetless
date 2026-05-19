# Meetless — Architecture

## 1. System Overview

```mermaid
graph TB
    subgraph Client["Browser"]
        U[User]
    end

    subgraph Vercel["Vercel (Next.js 14)"]
        FE["Frontend Pages<br/>(App Router)"]
        API["API Routes<br/>/api/**"]
        CRON["Vercel Cron Jobs"]
    end

    subgraph Local["Local Dev"]
        DEVCRON["dev-cron.ts<br/>(mirrors Vercel schedule)"]
    end

    subgraph External["External Services"]
        GCAL["Google Calendar API"]
        GDRIVE["Google Drive API"]
        SLACK["Slack Bot / Web API"]
        CLAUDE["Claude AI<br/>(Haiku)"]
    end

    subgraph DB["Supabase (Postgres)"]
        SUPA[("Database")]
    end

    U -->|"page navigation"| FE
    U -->|"fetch / form submit"| API
    FE -->|"reads session"| API

    API -->|"OAuth tokens, meetings,<br/>status updates, summaries"| SUPA
    SUPA -->|"rows"| API

    API -->|"fetchUpcomingMeetings<br/>refreshToken"| GCAL
    GCAL -->|"events"| API

    API -->|"search recordings<br/>extractTranscript"| GDRIVE
    GDRIVE -->|"transcript text"| API

    API -->|"postMessage<br/>interactive buttons"| SLACK
    SLACK -->|"button actions<br/>/api/slack/actions"| API

    API -->|"classifyMeetings<br/>generateSummary<br/>generateDraft"| CLAUDE
    CLAUDE -->|"JSON response"| API

    CRON -->|"HTTP GET /api/cron/*"| API
    DEVCRON -->|"HTTP GET /api/cron/*"| API
```

---

## 2. Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant NextAuth as NextAuth.js<br/>/api/auth
    participant Google as Google OAuth
    participant DB as Supabase users

    Note over User,DB: Google Calendar connection
    User->>Browser: click "Sign in with Google"
    Browser->>NextAuth: signIn('google', {access_type:'offline', prompt:'consent'})
    NextAuth->>Google: redirect OAuth consent screen
    Google-->>NextAuth: code → access_token + refresh_token
    NextAuth->>DB: upsert users row<br/>(email, google_id, access_token,<br/>refresh_token, token_expiry)
    NextAuth-->>Browser: session cookie set

    Note over User,DB: Slack connection (separate flow)
    User->>Browser: click "Connect Slack" in Settings
    Browser->>NextAuth: GET /api/slack/oauth
    NextAuth->>Google: Slack OAuth redirect
    Google-->>NextAuth: Slack code → slack_user_id
    NextAuth->>DB: UPDATE users SET slack_user_id = ?<br/>WHERE email = session.email
    NextAuth-->>Browser: redirect back to /settings

    Note over User,DB: Token refresh (every API call)
    NextAuth->>DB: read token_expiry
    alt token expired
        NextAuth->>Google: POST /oauth2/token (refresh_token)
        Google-->>NextAuth: new access_token + expiry
        NextAuth->>DB: UPDATE users SET access_token, token_expiry
    end
```

---

## 3. Meeting Classification Flow

```mermaid
flowchart TD
    GCAL["Google Calendar API"]
    FETCH["lib/google.ts<br/>fetchUpcomingMeetings()"]
    DB_CHECK{"Already in DB?"}
    SKIP["Skip — use cached<br/>classification"]
    BATCH["lib/classifier.ts<br/>batchClassify() — ONE Claude API call<br/>for all new meetings"]
    CLAUDE["Claude Haiku"]
    SAVE["INSERT into meetings<br/>(classification, confidence, reason)"]
    DASH["Dashboard<br/>reads from DB"]
    USER["User sees classified<br/>meeting list"]

    GCAL -->|"raw events"| FETCH
    FETCH -->|"normalized meetings"| DB_CHECK

    DB_CHECK -->|"yes"| SKIP
    DB_CHECK -->|"no — send all new meetings"| BATCH

    BATCH -->|"title, desc ≤200 chars,<br/>duration, attendee_count,<br/>is_organiser, is_recurring"| CLAUDE
    CLAUDE -->|"important / async / passive<br/>+ confidence + reason"| SAVE

    SAVE --> DASH
    SKIP --> DASH
    DASH --> USER
```

---

## 4. Async Status Board Flow

```mermaid
sequenceDiagram
    participant Cron as Cron: /api/cron/nudge<br/>(every minute)
    participant Scheduler as lib/scheduler.ts<br/>runAsyncNudge()
    participant DB as Supabase
    participant Slack as Slack Bot
    participant Attendee as Attendee
    participant Board as /async/[id] page
    participant Claude as Claude Haiku

    Note over Cron,DB: 29–31 min before meeting
    Cron->>Scheduler: trigger
    Scheduler->>DB: SELECT async meetings starting in 29-31 min<br/>WHERE nudge_sent = false<br/>GROUP by google_event_id
    DB-->>Scheduler: unique meetings
    Scheduler->>DB: SELECT users matching attendee_emails<br/>WITH slack_user_id
    Scheduler->>Slack: sendAsyncNudge() DM per attendee
    Scheduler->>DB: UPDATE meetings SET nudge_sent = true<br/>WHERE google_event_id = ?

    Note over Attendee,Board: Attendee fills status board
    Attendee->>Board: clicks link in Slack DM
    Board->>DB: GET status_updates across all sibling meeting rows<br/>(by google_event_id)
    Attendee->>Board: submits completed / plan / blockers
    Board->>DB: INSERT status_updates

    Note over Cron,Slack: At meeting start time
    Cron->>DB: SELECT async meetings started ≤ 1 min ago<br/>WHERE board_link_sent = false
    DB-->>Cron: unique meetings (deduped by google_event_id)
    Cron->>DB: COUNT status_updates across all sibling rows
    Cron->>Claude: generateAsyncSummary(all updates)
    Claude-->>Cron: summary text
    Cron->>Slack: sendBoardToChannel() → #meeting channel
    Cron->>Slack: DM meeting owner with board link
    Cron->>DB: UPDATE meetings SET board_link_sent = true<br/>WHERE google_event_id = ?
```

---

## 5. Draft Message Flow

```mermaid
sequenceDiagram
    actor User
    participant Page as Meeting Detail Page
    participant API as /api/meetings/[id]/draft
    participant Claude as Claude Haiku
    participant DB as Supabase
    participant Slack as Slack Bot
    participant Actions as /api/slack/actions

    User->>Page: click "Generate draft to organiser"
    Page->>API: POST (meeting_id)
    API->>Claude: generateDraftMessage(title, classification, reason)
    Claude-->>API: draft message text
    API->>DB: UPDATE meetings SET draft_message = ?
    API->>Slack: sendDraftMessageForApproval()<br/>DM with Approve / Discard buttons
    API-->>Page: { ok: true }

    Note over User,Actions: User reviews draft in Slack
    alt User clicks "Send to organiser"
        User->>Slack: clicks Approve button
        Slack->>Actions: POST action_id=approve_draft
        Actions->>DB: read organiser_email, draft_message
        Actions->>Slack: DM organiser with draft
        Actions->>DB: UPDATE meetings SET draft_sent = true
        Actions->>Slack: sendOutcomeTracking() DM to user<br/>(cancelled / async / happened)
    else User clicks "Discard"
        User->>Slack: clicks Discard button
        Slack->>Actions: POST action_id=discard_draft
        Actions-->>Slack: update message "Draft discarded"
    end

    Note over User,DB: Outcome tracking
    User->>Slack: clicks outcome button
    Slack->>Actions: POST action_id=outcome_*
    Actions->>DB: UPDATE meetings SET outcome = ?
```

---

## 6. Passive Meeting Flow

```mermaid
flowchart TD
    CRON["Cron: /api/cron/transcripts<br/>every 5 min"]
    QUERY["SELECT passive meetings<br/>ended in last 24 hrs<br/>WHERE summary IS NULL"]
    DRIVE["lib/drive.ts<br/>fetchMeetingTranscript()"]

    subgraph DriveSearch["Drive Search (4 strategies)"]
        S1["1. Exact title match"]
        S2["2. First 3 words partial"]
        S3["3. Same-day transcript"]
        S4["4. Meet Recordings folder"]
        S1 --> S2 --> S3 --> S4
    end

    EXTRACT["extractText()<br/>Google Doc or VTT"]
    CLAUDE["Claude Haiku<br/>generatePassiveSummary()"]
    STRUCT["{ summary, decisions[], actionItems[] }"]
    SAVE["INSERT summaries table"]
    DELIVER["lib/summaries.ts<br/>deliverSummaryToPassiveAttendees()"]

    subgraph Lookup["Attendee lookup"]
        ATT1["meeting_attendees table"]
        ATT2["fallback: attendee_emails array"]
        ATT1 --> ATT2
    end

    SLACK_DM["sendPassiveSummary() DM<br/>per attendee with slack_user_id"]
    CONFIRM["sendSummaryConfirmation()<br/>DM to host"]
    SUMPAGE["/summaries/[id] page"]

    CRON --> QUERY
    QUERY --> DRIVE
    DRIVE --> DriveSearch
    DriveSearch --> EXTRACT
    EXTRACT --> CLAUDE
    CLAUDE --> STRUCT
    STRUCT --> SAVE
    SAVE --> DELIVER
    DELIVER --> Lookup
    Lookup --> SLACK_DM
    DELIVER --> CONFIRM
    SLACK_DM -->|"'View full summary' button"| SUMPAGE
```

---

## 7. Cron Jobs

```mermaid
flowchart LR
    subgraph Schedules["Vercel Cron Schedules"]
        D["digest<br/>every minute*<br/>/api/cron/digest"]
        R["reminder<br/>every 5 min<br/>/api/cron/reminder"]
        N["nudge<br/>every 5 min<br/>/api/cron/nudge"]
        B["board-link<br/>every minute<br/>/api/cron/board-link"]
        T["transcripts<br/>every 5 min<br/>/api/cron/transcripts"]
    end

    subgraph Actions["What each job does"]
        DA["Filter users where<br/>digest_time = current IST HH:MM<br/>AND last_digest_sent ≠ today<br/>→ sendMorningDigest() DM"]

        RA["Find important meetings<br/>starting in [user.reminder_minutes ± 1] min<br/>WHERE reminder_sent = false<br/>→ sendMeetingReminder() DM<br/>→ reminder_sent = true"]

        NA["Find async meetings<br/>starting in 29–31 min<br/>WHERE nudge_sent = false<br/>(dedup by google_event_id)<br/>→ sendAsyncNudge() per attendee<br/>→ nudge_sent = true"]

        BA["Find async meetings<br/>started in last 0–60 sec<br/>WHERE board_link_sent = false<br/>(dedup by google_event_id)<br/>→ sendBoardToChannel() once<br/>→ DM owner board link<br/>→ board_link_sent = true"]

        TA["Find passive meetings<br/>ended in last 24 hrs<br/>WHERE summary IS NULL<br/>→ Drive transcript search<br/>→ Claude summary<br/>→ DM passive attendees"]
    end

    D --> DA
    R --> RA
    N --> NA
    B --> BA
    T --> TA
```

> \* digest runs every minute but each user's digest fires once per day at their configured IST time, guarded by `last_digest_sent`.

---

## 8. Database Schema

```mermaid
erDiagram
    users {
        uuid id PK
        text email UK
        text google_id UK
        text slack_user_id
        text access_token
        text refresh_token
        timestamptz token_expiry
        text digest_time
        integer reminder_minutes
        date last_digest_sent
        timestamptz created_at
    }

    meetings {
        uuid id PK
        uuid user_id FK
        text google_event_id
        text title
        text description
        timestamptz start_time
        timestamptz end_time
        integer duration
        integer attendee_count
        text attendee_emails
        text organiser_email
        boolean is_organiser
        boolean is_recurring
        text meet_link
        text classification
        integer confidence
        text reason
        text draft_message
        boolean draft_sent
        text outcome
        text async_summary
        boolean reminder_sent
        boolean board_link_sent
        boolean nudge_sent
        uuid draft_sent_by_user_id FK
        text draft_sent_to_slack_user_id
        timestamptz created_at
    }

    status_updates {
        uuid id PK
        uuid meeting_id FK
        uuid user_id FK
        text completed
        text plan
        text blockers
        text status_tag
        timestamptz submitted_at
    }

    summaries {
        uuid id PK
        uuid meeting_id FK
        uuid user_id FK
        text transcript_text
        text summary
        text action_items
        timestamptz created_at
    }

    overrides {
        uuid id PK
        uuid meeting_id FK
        uuid user_id FK
        text original_classification
        text new_classification
        timestamptz overridden_at
    }

    meeting_attendees {
        uuid id PK
        uuid meeting_id FK
        text email
        text response_status
    }

    users ||--o{ meetings : "user_id"
    users ||--o{ status_updates : "user_id"
    users ||--o{ summaries : "user_id"
    users ||--o{ overrides : "user_id"
    users ||--o{ meetings : "draft_sent_by_user_id"
    meetings ||--o{ status_updates : "meeting_id"
    meetings ||--o{ summaries : "meeting_id"
    meetings ||--o{ overrides : "meeting_id"
    meetings ||--o{ meeting_attendees : "meeting_id"
```

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| One meetings row per user per event | Each user's `is_organiser`, `classification`, `reminder_sent` etc. are personal — not shared |
| `google_event_id` as cross-user key | All cron jobs deduplicate by this to fire once per calendar event |
| `status_updates` queried across sibling rows | Attendees may submit via different meeting row URLs — GET uses `.in('meeting_id', allSiblingIds)` |
| `supabaseAdmin` (service role) for all server writes | Bypasses RLS; never exposed to the client |
| Claude Haiku only | Cost and latency optimised; system prompts kept under 100 tokens |
| Slack = lightweight surface | Links back to website for all detail; no full data in DMs |
| AI drafts always need approval | `sendDraftMessageForApproval()` — never auto-sent to organiser |
