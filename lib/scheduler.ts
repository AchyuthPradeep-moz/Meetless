import { supabaseAdmin } from './supabase'
import { sendDM, sendMeetingReminder, sendMorningDigest, sendAsyncNudge, sendFocusSuggestion } from './slack'
import { fetchUpcomingMeetings } from './google'
import { classifyMeetings } from './classifier'
import { findFocusGaps } from './focus'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function fmtIST(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const h = ist.getUTCHours()
  const m = ist.getUTCMinutes()
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`
}

// Sends the morning digest to all Slack-connected users.
// Normal mode: only users whose digest_time (stored as IST HH:MM) matches current IST time.
// Test mode: sends to all connected users immediately.
export async function runDailyDigest(testMode = false): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  // Compare IST time so digest_time in the DB is always stored as local IST HH:MM
  const hhmm = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).slice(0, 5)

  let usersQuery = supabaseAdmin
    .from('users')
    .select('*')
    .not('slack_user_id', 'is', null)
    .not('refresh_token', 'is', null)

  if (!testMode) {
    usersQuery = usersQuery.eq('digest_time', hhmm)
  }

  const { data: users } = await usersQuery
  if (!users?.length) return { sent: 0, failed: 0 }

  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

  // Today's date in IST as "YYYY-MM-DD" (en-CA locale produces this format)
  const istDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  let sent = 0
  let failed = 0

  for (const user of users as User[]) {
    // Skip if digest already sent today (IST date) — bypassed in test mode
    if (!testMode && (user as any).last_digest_sent === istDate) {
      console.log(`Digest already sent today for ${user.email} — skipping`)
      continue
    }

    try {
      // Prefer DB — avoids redundant Google API calls if meetings already classified
      let { data: meetings } = await supabaseAdmin
        .from('meetings')
        .select('id, title, start_time, duration, classification')
        .eq('user_id', user.id)
        .gte('start_time', todayStart.toISOString())
        .lt('start_time', todayEnd.toISOString())
        .order('start_time')

      // Nothing in DB for today → fetch from Google Calendar, classify, and persist
      if (!meetings?.length) {
        try {
          const googleMeetings = await fetchUpcomingMeetings(user)
          const todayFromGoogle = googleMeetings.filter((m) => {
            const t = new Date(m.start_time)
            return t >= todayStart && t < todayEnd
          })

          if (todayFromGoogle.length > 0) {
            const { data: existing } = await supabaseAdmin
              .from('meetings')
              .select('google_event_id')
              .eq('user_id', user.id)

            const existingIds = new Set((existing ?? []).map((m) => m.google_event_id))
            const newMeetings = todayFromGoogle.filter((m) => !existingIds.has(m.google_event_id))

            if (newMeetings.length > 0) {
              const classifications = await classifyMeetings(newMeetings)
              const rows = newMeetings.map((m, i) => ({
                user_id: user.id,
                google_event_id: m.google_event_id,
                title: m.title,
                description: m.description,
                start_time: m.start_time,
                end_time: new Date(new Date(m.start_time).getTime() + m.duration * 60 * 1000).toISOString(),
                duration: m.duration,
                attendee_count: m.attendee_count,
                attendee_emails: m.attendee_emails,
                is_organiser: m.is_organiser,
                is_recurring: m.is_recurring,
                meet_link: m.meet_link,
                classification: classifications[i].classification,
                confidence: classifications[i].confidence,
                reason: classifications[i].reason,
              }))
              await supabaseAdmin.from('meetings').insert(rows)
            }

            const { data: fresh } = await supabaseAdmin
              .from('meetings')
              .select('id, title, start_time, duration, classification')
              .eq('user_id', user.id)
              .gte('start_time', todayStart.toISOString())
              .lt('start_time', todayEnd.toISOString())
              .order('start_time')

            meetings = fresh
          }
        } catch (gcErr) {
          console.error(`Google Calendar fetch failed for ${user.email}:`, gcErr)
        }
      }

      const localPart = user.email.split('@')[0].split('.')[0]
      const firstName = localPart.charAt(0).toUpperCase() + localPart.slice(1)

      await sendMorningDigest(user.slack_user_id!, firstName, meetings ?? [])

      // Send focus suggestion alongside the digest
      try {
        const gaps = await findFocusGaps(user as User, { daysAhead: 1, minGapMins: 60 })
        if (gaps.length > 0) {
          const [y, mo, d] = gaps[0].date.split('-').map(Number)
          const dateLabel = new Date(Date.UTC(y, mo - 1, d) + IST_OFFSET_MS)
            .toLocaleDateString('en-IN', {
              weekday: 'long', day: 'numeric', month: 'long',
              timeZone: 'Asia/Kolkata',
            })
          const formattedGaps = gaps.map(g => ({
            startLabel: fmtIST(g.startTime),
            endLabel: fmtIST(new Date(g.startTime.getTime() + g.durationMins * 60 * 1000)),
            isoStart: g.startTime.toISOString(),
            durationMins: g.durationMins,
          }))
          await sendFocusSuggestion(user.slack_user_id!, user.id, dateLabel, formattedGaps)
        }
      } catch (focusErr) {
        console.error(`Focus suggestion failed for ${user.email}:`, focusErr)
      }

      await supabaseAdmin
        .from('users')
        .update({ last_digest_sent: istDate })
        .eq('id', user.id)
      sent++
    } catch (err) {
      console.error(`Digest failed for ${user.email}:`, err)
      failed++
    }
  }

  console.log(`Daily digest: sent=${sent}, failed=${failed}${testMode ? ' (test mode)' : ''}`)
  return { sent, failed }
}

// Sends a 10-min reminder for Important meetings to users with Slack connected.
// testMode: skips the time window and reminder_sent update, but still filters classification=important.
export async function runReminder(testMode = false): Promise<{ sent: number; debug: object }> {
  const now = new Date()

  console.log(`\n=== runReminder | testMode=${testMode} | now=${now.toISOString()} ===`)

  // Step 1: find all users with Slack connected.
  // Separate query — avoids the ambiguous FK error (meetings has two FKs to users).
  const { data: slackUsers, error: usersErr } = await supabaseAdmin
    .from('users')
    .select('id, email, slack_user_id, reminder_minutes')
    .not('slack_user_id', 'is', null)

  if (usersErr) console.error('Users query failed:', usersErr)
  console.log(`Step 1 — users with slack_user_id: ${slackUsers?.length ?? 0}`)
  for (const u of slackUsers ?? []) {
    console.log(`  user: ${u.email} | slack_user_id: ${u.slack_user_id}`)
  }

  if (!slackUsers?.length) return { sent: 0, debug: { slackUsers: 0 } }

  let sent = 0

  for (const user of slackUsers) {
    console.log(`\nStep 2 — all meetings for user: ${user.email}`)

    // Fetch ALL meetings for this user so we can log their classifications for debugging
    const { data: allMeetings, error: allErr } = await supabaseAdmin
      .from('meetings')
      .select('id, title, meet_link, classification, reminder_sent, start_time')
      .eq('user_id', user.id)
      .order('start_time')

    if (allErr) {
      console.error(`  All-meetings query failed:`, allErr)
      continue
    }

    console.log('All meetings for user:', allMeetings?.map((m) => ({
      title: m.title,
      classification: m.classification,
      reminder_sent: m.reminder_sent,
    })))

    // Filter to important only — both in test and production mode
    const importantMeetings = (allMeetings ?? []).filter(
      (m) => m.classification === 'important'
    )
    console.log(`  Important meetings: ${importantMeetings.length} of ${allMeetings?.length ?? 0} total`)

    if (!importantMeetings.length) {
      console.log(`  No important meetings — skipping user`)
      continue
    }

    // Per-user reminder window based on their preference (default 10 min)
    const buffer = (user as any).reminder_minutes ?? 10
    const windowEnd = new Date(now.getTime() + (buffer + 1) * 60 * 1000)

    // In production, further filter by time window and reminder_sent
    let targets = importantMeetings
    if (!testMode) {
      targets = importantMeetings.filter((m) => {
        const meetingTime = new Date(m.start_time)
        const inWindow = meetingTime >= now && meetingTime <= windowEnd
        console.log(`  Now: ${now.toISOString()} | Meeting time: ${meetingTime.toISOString()} | Window end: ${windowEnd.toISOString()} (${buffer}min pref) | In window: ${inWindow} | reminder_sent: ${m.reminder_sent}`)
        return !m.reminder_sent && inWindow
      })
      console.log(`  After time filter (${now.toISOString()} → ${windowEnd.toISOString()}) + reminder_sent=false: ${targets.length} meetings`)
    } else {
      console.log(`  Test mode — skipping time filter, using all ${targets.length} important meetings`)
    }

    if (!targets.length) {
      console.log(`  No meetings pass filters — skipping user`)
      continue
    }

    for (const m of targets) {
      console.log(`  Sending reminder to ${user.slack_user_id} for "${m.title}" (start=${m.start_time})`)
      try {
        await sendMeetingReminder(user.slack_user_id!, m.title, m.meet_link, buffer)
        sent++
        console.log(`  Reminder sent OK`)
      } catch (err) {
        console.error(`  Reminder send failed:`, err)
      }

      if (!testMode) {
        await supabaseAdmin
          .from('meetings')
          .update({ reminder_sent: true })
          .eq('id', m.id)
      }
    }
  }

  console.log(`\n=== runReminder done | sent=${sent} ===`)
  return { sent, debug: { slackUserCount: slackUsers.length } }
}

// Sends async nudges to meeting attendees who have Meetless + Slack connected and haven't submitted yet.
// Normal mode: async meetings starting in 29–31 minutes.
// Test mode: any async meeting (no time filter).
// Deduplicates by google_event_id — one event shared across multiple users is only one nudge run.
export async function runAsyncNudge(testMode = false): Promise<{ sent: number }> {
  const now = new Date()
  const in29 = new Date(now.getTime() + 29 * 60 * 1000)
  const in31 = new Date(now.getTime() + 31 * 60 * 1000)

  let query = supabaseAdmin
    .from('meetings')
    .select('id, google_event_id, title, attendee_emails')
    .eq('classification', 'async')

  if (!testMode) {
    query = query
      .gte('start_time', in29.toISOString())
      .lte('start_time', in31.toISOString())
      .eq('nudge_sent', false)
  }

  const { data: meetings } = await query
  if (!meetings?.length) return { sent: 0 }

  // Deduplicate by google_event_id — pick one representative row per event.
  // The attendee_emails array is the same on all rows for the same event.
  const seen = new Set<string>()
  const uniqueMeetings: typeof meetings = []
  for (const m of meetings as any[]) {
    const key = m.google_event_id ?? m.id
    if (seen.has(key)) continue
    seen.add(key)
    uniqueMeetings.push(m)
  }

  let sent = 0
  for (const meeting of uniqueMeetings as any[]) {
    const attendeeEmails: string[] = meeting.attendee_emails ?? []
    if (!attendeeEmails.length) continue

    const { data: connectedUsers } = await supabaseAdmin
      .from('users')
      .select('id, slack_user_id')
      .in('email', attendeeEmails)
      .not('slack_user_id', 'is', null)

    let nudgedCount = 0
    for (const user of connectedUsers ?? []) {
      const { data: existing } = await supabaseAdmin
        .from('status_updates')
        .select('id')
        .eq('meeting_id', meeting.id)
        .eq('user_id', user.id)
        .limit(1)

      if (existing?.length) continue

      await sendAsyncNudge(user.slack_user_id!, meeting.title, meeting.id)
      sent++
      nudgedCount++
    }

    console.log(`Nudge sent for "${meeting.title}" to ${nudgedCount} attendees`)

    if (!testMode) {
      // Mark nudge_sent = true on ALL rows for this google_event_id to prevent re-send
      await supabaseAdmin
        .from('meetings')
        .update({ nudge_sent: true })
        .eq('google_event_id', meeting.google_event_id)
    }
  }

  console.log(`Async nudges sent: ${sent}${testMode ? ' (test mode)' : ''}`)
  return { sent }
}
