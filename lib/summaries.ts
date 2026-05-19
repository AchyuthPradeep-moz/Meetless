import { supabaseAdmin } from './supabase'
import { sendPassiveSummary, sendSummaryConfirmation } from './slack'

// Finds all attendees for a meeting and delivers the summary to any who have a Meetless
// account with Slack connected. Does NOT require the attendee to have synced their calendar
// or to have classified the meeting as passive — being in the attendee list is enough.
export async function deliverSummaryToPassiveAttendees(
  hostMeetingId: string,
  googleEventId: string,
  meetingTitle: string,
  summaryText: string,
  decisions: string[],
  actionItems: string[],
  hostSlackId?: string | null
): Promise<{ delivered: number }> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  console.log('Delivering summary for meeting:', meetingTitle)
  console.log('Host meeting ID:', hostMeetingId, '| Google event ID:', googleEventId)

  // ── Step 1: collect attendee emails ──────────────────────────────────────
  // Try meeting_attendees table first (populated during calendar sync).
  // Fall back to the attendee_emails array on the host meeting row.

  const { data: attendeeRows } = await supabaseAdmin
    .from('meeting_attendees')
    .select('email, response_status')
    .eq('meeting_id', hostMeetingId)

  console.log('meeting_attendees rows found:', attendeeRows?.length ?? 0)

  let attendeeEmails: string[]

  if (attendeeRows?.length) {
    const nonDeclined = attendeeRows.filter((a) => a.response_status !== 'declined')
    console.log(`Attendees from meeting_attendees (excl. declined): ${nonDeclined.length} of ${attendeeRows.length}`)
    attendeeEmails = nonDeclined.map((a) => a.email)
  } else {
    // Fallback: attendee_emails column on the host's meetings row
    const { data: hostMeeting } = await supabaseAdmin
      .from('meetings')
      .select('attendee_emails')
      .eq('id', hostMeetingId)
      .single()

    console.log('Fallback attendee_emails from meetings row:', hostMeeting?.attendee_emails)
    attendeeEmails = hostMeeting?.attendee_emails ?? []
  }

  console.log('Attendee emails from meeting:', attendeeEmails)

  if (!attendeeEmails.length) {
    console.log('No attendee emails found — aborting delivery')
    return { delivered: 0 }
  }

  // ── Step 2: find which attendees have Meetless accounts ──────────────────

  const { data: matchedUsers } = await supabaseAdmin
    .from('users')
    .select('id, email, slack_user_id')
    .in('email', attendeeEmails)

  console.log(`Meetless users matched: ${matchedUsers?.length ?? 0} of ${attendeeEmails.length} attendees`)

  if (!matchedUsers?.length) {
    console.log('No attendees have Meetless accounts — nothing to deliver')
    return { delivered: 0 }
  }

  let delivered = 0

  for (const user of matchedUsers) {
    console.log('Checking attendee:', user.email, '| slack_user_id:', user.slack_user_id ?? 'none')

    if (!user.slack_user_id) {
      console.log(`  SKIP ${user.email} — no Slack ID (summary visible on dashboard when they log in)`)
      continue
    }

    // Determine the summary link: use their own meeting row if it exists,
    // otherwise fall back to the host's meeting row so the link still works.
    const { data: theirMeeting } = await supabaseAdmin
      .from('meetings')
      .select('id, classification')
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId)
      .maybeSingle()

    console.log(
      `  Their meeting row:`,
      theirMeeting
        ? `id=${theirMeeting.id} classification=${theirMeeting.classification}`
        : 'NOT FOUND (they haven\'t synced their calendar)'
    )

    // Use their meeting ID for the summary link if available, host meeting as fallback
    const summaryMeetingId = theirMeeting?.id ?? hostMeetingId
    const summaryUrl = `${baseUrl}/summaries/${summaryMeetingId}`

    console.log('Sending Slack notification to:', user.slack_user_id, '| URL:', summaryUrl)

    try {
      await sendPassiveSummary(
        user.slack_user_id,
        meetingTitle,
        summaryText,
        decisions,
        actionItems,
        summaryUrl
      )
      console.log('Slack send result: OK for', user.email)
      delivered++
    } catch (err) {
      console.error('Slack send result: FAILED for', user.email, err)
    }
  }

  // ── Step 3: confirm to host ───────────────────────────────────────────────

  if (hostSlackId && delivered > 0) {
    await sendSummaryConfirmation(hostSlackId, meetingTitle, delivered)
    console.log('Host confirmation sent to:', hostSlackId)
  } else if (hostSlackId && delivered === 0) {
    console.log('Host confirmation skipped — 0 delivered')
  }

  console.log(`deliverSummaryToPassiveAttendees done: delivered=${delivered} for "${meetingTitle}"`)
  return { delivered }
}
