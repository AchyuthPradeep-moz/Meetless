import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchMeetingTranscript } from '@/lib/drive'
import { generatePassiveSummary } from '@/lib/claude'
import { deliverSummaryToAllAttendees } from '@/lib/summaries'
import type { User } from '@/types/user'

// Polls organiser Google Drive for transcripts of recently-ended passive meetings.
// Looks back 3 hours by end_time. Falls back to computing end_time from start_time + duration
// if the end_time column is not yet populated.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const lookback = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  console.log(`\n=== /api/cron/transcripts | ${now.toISOString()} ===`)
  console.log('Looking for meetings ended after:', lookback.toISOString())

  // Extend start_time lookback by 8h to catch long meetings that started before the 7-day window
  // but ended within it. Real end-time filtering happens in-memory below.
  const extendedLookback = new Date(lookback.getTime() - 8 * 60 * 60 * 1000)

  const { data: meetings, error: meetingsErr } = await supabaseAdmin
    .from('meetings')
    .select('id, google_event_id, title, start_time, end_time, duration, user_id, organiser_email')
    .eq('classification', 'passive')
    .gte('start_time', extendedLookback.toISOString())
    .lt('start_time', now.toISOString())

  if (meetingsErr) console.error('Meetings query error:', meetingsErr)
  console.log('Passive meetings found in DB (broad window):', meetings?.length ?? 0)

  if (!meetings?.length) {
    console.log('No passive meetings found — exiting')
    return NextResponse.json({ processed: 0 })
  }

  // Check which meetings already have a summary
  const { data: existingSummaries } = await supabaseAdmin
    .from('summaries')
    .select('meeting_id')
    .in('meeting_id', meetings.map((m) => m.id))

  const summarisedIds = new Set((existingSummaries ?? []).map((s) => s.meeting_id))

  // Filter to meetings that ended within the 3-hour window and have no summary yet
  const pending = meetings.filter((m) => {
    if (summarisedIds.has(m.id)) {
      console.log(`  SKIP "${m.title}" — summary already exists`)
      return false
    }

    // Resolve end_time: use stored column if available, fall back to start + duration
    let endTime: Date
    if (m.end_time) {
      endTime = new Date(m.end_time)
    } else if (m.duration) {
      endTime = new Date(new Date(m.start_time).getTime() + m.duration * 60 * 1000)
      console.log(`  NOTE "${m.title}" — end_time missing in DB, computed from start + duration`)
    } else {
      console.log(`  SKIP "${m.title}" — no end_time and no duration, cannot determine end`)
      return false
    }

    if (endTime >= now) {
      console.log(`  SKIP "${m.title}" — meeting hasn't ended yet (ends ${endTime.toISOString()})`)
      return false
    }

    if (endTime < lookback) {
      console.log(`  SKIP "${m.title}" — ended ${endTime.toISOString()}, which is outside the 7-day window`)
      return false
    }

    console.log(`  PENDING "${m.title}" — ended ${endTime.toISOString()}, no summary yet`)
    return true
  })

  console.log(`Pending meetings to process: ${pending.length}`)

  if (!pending.length) {
    return NextResponse.json({ processed: 0 })
  }

  let processed = 0

  for (const meeting of pending) {
    console.log(`\n--- Processing "${meeting.title}" (${meeting.id}) ---`)
    console.log('Checking meeting:', {
      title: meeting.title,
      start_time: meeting.start_time,
      end_time: meeting.end_time ?? `(computed) ${new Date(new Date(meeting.start_time).getTime() + (meeting.duration ?? 60) * 60 * 1000).toISOString()}`,
      user_id: meeting.user_id,
      has_summary: summarisedIds.has(meeting.id),
    })

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', meeting.user_id)
      .single<User>()

    if (!user) {
      console.log(`  SKIP — user ${meeting.user_id} not found`)
      continue
    }
    if (!user.refresh_token) {
      console.log(`  SKIP — user ${user.email} has no refresh_token (Google not connected)`)
      continue
    }
    console.log(`  User: ${user.email} | has refresh_token: true`)

    let transcript: string | null = null
    try {
      transcript = await fetchMeetingTranscript(
        user,
        meeting.title ?? '',
        meeting.start_time,
        meeting.duration ?? 60
      )
    } catch (err) {
      console.error(`  Drive fetch threw error for "${meeting.title}":`, err)
    }

    if (!transcript) {
      console.log(`  No transcript returned from Drive — skipping`)
      continue
    }
    console.log(`  Transcript fetched — length: ${transcript.length} chars`)

    let parsed: { summary: string; decisions: string[]; actionItems: string[] }
    try {
      parsed = await generatePassiveSummary(transcript, meeting.title ?? 'Meeting')
      console.log(`  Summary generated | decisions: ${parsed.decisions.length} | actionItems: ${parsed.actionItems.length}`)
    } catch (err) {
      console.error(`  Summary generation failed for "${meeting.title}":`, err)
      continue
    }

    const { error: insertErr } = await supabaseAdmin.from('summaries').insert({
      meeting_id: meeting.id,
      user_id: meeting.user_id,
      transcript_text: transcript,
      summary: JSON.stringify({
        summary: parsed.summary,
        decisions: parsed.decisions,
        keyPoints: [],
        actionItems: parsed.actionItems,
      }),
      action_items: null,
    })

    if (insertErr) {
      console.error(`  Failed to insert summary:`, insertErr)
      continue
    }
    console.log(`  Summary saved to DB`)

    const { delivered } = await deliverSummaryToAllAttendees(
      meeting.id,
      meeting.user_id,
      meeting.google_event_id,
      meeting.title ?? 'Meeting',
      parsed.summary,
      parsed.decisions,
      parsed.actionItems,
      meeting.organiser_email ?? null
    )

    console.log(`  Delivered to ${delivered} passive attendees`)
    processed++
  }

  console.log(`\n=== Done | processed=${processed} ===`)
  return NextResponse.json({ processed })
}
