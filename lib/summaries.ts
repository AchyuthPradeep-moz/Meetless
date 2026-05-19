import { supabaseAdmin } from './supabase'
import { sendMeetingSummary } from './slack'

// Delivers the meeting summary to ALL attendees (including the organiser) who have a
// Meetless account with Slack connected, AND inserts a summaries row for each attendee
// so the summary appears in their dashboard. Being in the attendee list is enough —
// no classification check, no calendar sync required.
export async function deliverSummaryToAllAttendees(
  hostMeetingId: string,
  hostUserId: string,
  googleEventId: string,
  meetingTitle: string,
  summaryText: string,
  decisions: string[],
  actionItems: string[],
  organiserEmail?: string | null
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
    const { data: hostMeeting } = await supabaseAdmin
      .from('meetings')
      .select('attendee_emails')
      .eq('id', hostMeetingId)
      .single()

    console.log('Fallback attendee_emails from meetings row:', hostMeeting?.attendee_emails)
    attendeeEmails = hostMeeting?.attendee_emails ?? []
  }

  // Explicitly include the organiser — they may not be in their own attendee list
  if (organiserEmail && !attendeeEmails.some((e) => e.toLowerCase() === organiserEmail.toLowerCase())) {
    attendeeEmails = [...attendeeEmails, organiserEmail]
    console.log('Organiser added to delivery list:', organiserEmail)
  }

  console.log('Final attendee list:', attendeeEmails)

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
      console.log(`  SKIP ${user.email} — no Slack connected`)
      continue
    }

    // Use their own meeting row for the summary link if they've synced;
    // fall back to the host meeting row so the link still works.
    const { data: theirMeeting } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId)
      .maybeSingle()

    const summaryMeetingId = theirMeeting?.id ?? hostMeetingId
    const summaryUrl = `${baseUrl}/summaries/${summaryMeetingId}`

    console.log(`  Sending to ${user.email} | URL: ${summaryUrl}`)

    // Insert a summaries row for this attendee so it appears in their dashboard.
    // Skip if they're the host (already has a row) or if a row already exists.
    if (user.id !== hostUserId) {
      const { data: existing } = await supabaseAdmin
        .from('summaries')
        .select('id')
        .eq('meeting_id', summaryMeetingId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existing) {
        const summaryJson = JSON.stringify({
          summary: summaryText,
          decisions,
          keyPoints: [],
          actionItems,
        })
        const { error: insertErr } = await supabaseAdmin.from('summaries').insert({
          meeting_id: summaryMeetingId,
          user_id: user.id,
          summary: summaryJson,
          transcript_text: null,
          action_items: null,
        })
        if (insertErr) {
          console.error(`  Failed to insert summary row for ${user.email}:`, insertErr)
        } else {
          console.log(`  Summary row inserted for ${user.email}`)
        }
      } else {
        console.log(`  Summary row already exists for ${user.email} — skipping insert`)
      }
    }

    try {
      await sendMeetingSummary(
        user.slack_user_id,
        meetingTitle,
        summaryText,
        decisions,
        actionItems,
        summaryUrl
      )
      console.log(`  Slack DM OK`)
      delivered++
    } catch (err) {
      console.error(`  Slack DM FAILED for ${user.email}:`, err)
    }
  }

  console.log(`deliverSummaryToAllAttendees done: delivered=${delivered} for "${meetingTitle}"`)
  return { delivered }
}
