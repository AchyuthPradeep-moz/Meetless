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
  const testMode = req.nextUrl.searchParams.get('test') === 'true'
  const channelId = process.env.SLACK_MEETING_CHANNEL_ID ?? ''

  console.log('board-link cron fired | testMode:', testMode)
  console.log('Channel ID:', channelId || 'MISSING')

  const now = new Date()
  const oneMinAgo = new Date(now.getTime() - 60 * 1000)

  // Select without join — meetings has two FK to users (user_id + draft_sent_by_user_id)
  // which causes Supabase to throw an ambiguous relationship error. Fetch owner separately.
  let query = supabaseAdmin
    .from('meetings')
    .select('id, title, start_time, board_link_sent, user_id, attendee_count, async_summary')
    .eq('classification', 'async')

  if (!testMode) {
    // Normal mode: only meetings that just started and haven't been sent yet
    query = query
      .eq('board_link_sent', false)
      .gte('start_time', oneMinAgo.toISOString())
      .lte('start_time', now.toISOString())
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

  let sent = 0
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  for (const m of meetings as any[]) {
    console.log(`\nProcessing meeting: "${m.title}"`)
    console.log(`  id: ${m.id}`)
    console.log(`  start_time: ${m.start_time}`)
    console.log(`  board_link_sent: ${m.board_link_sent}`)

    // Count submissions for this meeting
    const { count, error: countError } = await supabaseAdmin
      .from('status_updates')
      .select('id', { count: 'exact', head: true })
      .eq('meeting_id', m.id)

    if (countError) {
      console.error(`  Failed to count submissions:`, countError.message)
    }

    const submittedCount = count ?? 0
    const totalCount = m.attendee_count ?? 0
    console.log(`  Submissions: ${submittedCount}/${totalCount}`)

    // Post to channel
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

    // Mark as sent (skipped in test mode so repeated test runs still fire)
    if (!testMode) {
      const { error: updateError } = await supabaseAdmin
        .from('meetings')
        .update({ board_link_sent: true })
        .eq('id', m.id)

      if (updateError) {
        console.error(`  Failed to mark board_link_sent:`, updateError.message)
      } else {
        console.log(`  Marked board_link_sent = true`)
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
