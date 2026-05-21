import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendDM, sendBoardToChannel } from '@/lib/slack'

// Vercel cron — runs every minute. At meeting start time:
//   1. Posts the status board summary to the shared #meeting channel
//   2. DMs the meeting owner separately with a direct link
//
// ?test=true — bypasses time window and board_link_sent guard,
//              sends for ALL async meetings immediately
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const testMode = req.nextUrl.searchParams.get('test') === 'true'
  const channelId = process.env.SLACK_MEETING_CHANNEL_ID ?? ''

  console.log('board-link cron fired | testMode:', testMode, '| now:', new Date().toISOString())
  console.log('Channel ID:', channelId || 'MISSING')

  const now = new Date()
  // Send only AFTER start_time so all pre-meeting submissions are already in DB.
  // 10-minute backward window catches missed/delayed cron ticks.
  // board_link_sent = false prevents double-sends across the full window.
  const windowStart = new Date(now.getTime() - 10 * 60 * 1000)
  const windowEnd = now

  // Select without join — meetings has two FK to users (user_id + draft_sent_by_user_id)
  // which causes Supabase to throw an ambiguous relationship error. Fetch owner separately.
  let query = supabaseAdmin
    .from('meetings')
    .select('id, google_event_id, title, start_time, board_link_sent, user_id, attendee_emails, organiser_email, async_summary')
    .eq('classification', 'async')

  if (!testMode) {
    query = query
      .eq('board_link_sent', false)
      .gte('start_time', windowStart.toISOString())
      .lte('start_time', windowEnd.toISOString())
  }

  const { data: meetings, error: meetingsError } = await query

  if (meetingsError) {
    console.error('Failed to query meetings:', meetingsError.message)
    return NextResponse.json({ ok: false, error: meetingsError.message }, { status: 500 })
  }

  console.log('Async meetings found:', meetings?.length ?? 0)

  if (!meetings?.length) {
    console.log('No meetings to process — returning early')
    return NextResponse.json({
      ok: true,
      sent: 0,
      meetings_found: 0,
      testMode,
      channel_id: channelId,
    })
  }

  // Deduplicate by google_event_id — each calendar event has one row per user.
  // Without this, a 3-person meeting fires sendBoardToChannel 3 times.
  const seen = new Set<string>()
  const uniqueMeetings: typeof meetings = []
  for (const m of meetings as any[]) {
    const key = m.google_event_id ?? m.id
    if (seen.has(key)) continue
    seen.add(key)
    uniqueMeetings.push(m)
  }

  console.log(`Unique events after dedup: ${uniqueMeetings.length}`)

  let sent = 0
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  for (const m of uniqueMeetings as any[]) {
    console.log(`\nProcessing meeting: "${m.title}"`)
    console.log(`  google_event_id: ${m.google_event_id}`)
    console.log(`  representative id: ${m.id}`)
    console.log(`  start_time: ${m.start_time}`)

    // Find ALL sibling meeting rows for this event so we can count submissions correctly
    const { data: siblingRows } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('google_event_id', m.google_event_id)

    const allMeetingIds = (siblingRows ?? []).map((r: any) => r.id)

    // Count submissions across ALL sibling rows — each attendee may have submitted
    // against their own meeting row (the one in the URL they opened)
    const { count, error: countError } = await supabaseAdmin
      .from('status_updates')
      .select('id', { count: 'exact', head: true })
      .in('meeting_id', allMeetingIds)

    if (countError) console.error(`  Failed to count submissions:`, countError.message)

    const submittedCount = count ?? 0
    // Exclude organiser from total — they don't submit status updates (same logic as GET handler)
    const attendeeEmails: string[] = m.attendee_emails ?? []
    const organiserEmail: string | null = m.organiser_email ?? null
    const totalCount = attendeeEmails.filter(
      (e: string) => e.toLowerCase() !== organiserEmail?.toLowerCase()
    ).length || attendeeEmails.length
    console.log(`  Submissions: ${submittedCount}/${totalCount} (across ${allMeetingIds.length} meeting rows)`)

    // Post to channel once for the event
    console.log(`  Posting to channel ${channelId || 'MISSING'}…`)
    try {
      await sendBoardToChannel(m.id, m.title, submittedCount, totalCount, m.async_summary ?? null)
      console.log(`  Channel post: OK`)
    } catch (err: any) {
      console.error(`  Channel post FAILED:`, err?.message ?? err)
    }

    // Fetch the meeting owner separately to avoid the ambiguous FK error
    const { data: owner } = await supabaseAdmin
      .from('users')
      .select('slack_user_id')
      .eq('id', m.user_id)
      .single()

    // DM meeting owner
    const slackUserId = owner?.slack_user_id
    if (slackUserId) {
      console.log(`  Sending DM to owner ${slackUserId}…`)
      try {
        await sendDM(
          slackUserId,
          `📋 *${m.title}* is starting now. ${submittedCount}/${totalCount} submitted. View board: ${baseUrl}/async/${m.id}`
        )
        console.log(`  Owner DM: OK`)
      } catch (err: any) {
        console.error(`  Owner DM FAILED:`, err?.message ?? err)
      }
    } else {
      console.log(`  Owner has no Slack connected — skipping DM`)
    }

    // Mark ALL sibling rows as sent — prevents any other row from triggering a re-send
    if (!testMode) {
      const { error: updateError } = await supabaseAdmin
        .from('meetings')
        .update({ board_link_sent: true })
        .eq('google_event_id', m.google_event_id)

      if (updateError) {
        console.error(`  Failed to mark board_link_sent:`, updateError.message)
      } else {
        console.log(`  Marked board_link_sent = true on ${allMeetingIds.length} rows`)
      }
    } else {
      console.log(`  Test mode — skipping board_link_sent update`)
    }

    sent++
  }

  console.log(`\nboard-link cron done | sent: ${sent}`)

  return NextResponse.json({
    ok: true,
    sent,
    meetings_found: meetings.length,
    testMode,
    channel_id: channelId,
  })
}
