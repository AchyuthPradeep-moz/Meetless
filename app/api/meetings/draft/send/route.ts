import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { sendDM, sendOutcomeTracking } from '@/lib/slack'

// POST — saves the (possibly edited) draft and sends it directly to the organiser via Slack DM.
// Also sends outcome-tracking buttons to the current user's Slack.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { meeting_id, draft_message } = body
  if (!meeting_id) return NextResponse.json({ error: 'Missing meeting_id' }, { status: 400 })
  if (!draft_message?.trim()) return NextResponse.json({ error: 'Missing draft_message' }, { status: 400 })

  // Look up the current user (sender)
  const { data: senderUser } = await supabaseAdmin
    .from('users')
    .select('id, slack_user_id')
    .eq('email', session.user.email)
    .single()

  // Look up the meeting to get organiser email and title
  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('id, title, organiser_email, classification')
    .eq('id', meeting_id)
    .single()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })

  // Save the (edited) draft to DB
  await supabaseAdmin
    .from('meetings')
    .update({ draft_message: draft_message.trim() })
    .eq('id', meeting_id)

  let sentToOrganiser = false
  let organiserSlackUserId: string | null = null

  // Find organiser's Slack and send DM directly
  if (meeting.organiser_email) {
    const { data: organiserUser } = await supabaseAdmin
      .from('users')
      .select('slack_user_id')
      .eq('email', meeting.organiser_email)
      .single()

    if (organiserUser?.slack_user_id) {
      await sendDM(organiserUser.slack_user_id, draft_message.trim())
      organiserSlackUserId = organiserUser.slack_user_id
      sentToOrganiser = true
      console.log(`Draft sent directly to organiser ${meeting.organiser_email}`)
    } else {
      console.log(`Organiser ${meeting.organiser_email} not on Meetless — cannot send via Slack`)
    }
  }

  // Mark draft as sent in DB
  await supabaseAdmin
    .from('meetings')
    .update({
      draft_sent: true,
      draft_sent_to_slack_user_id: organiserSlackUserId,
      draft_sent_by_user_id: senderUser?.id ?? null,
    })
    .eq('id', meeting_id)

  // Send outcome-tracking buttons to the sender's Slack
  if (senderUser?.slack_user_id && meeting.title) {
    await sendOutcomeTracking(senderUser.slack_user_id, meeting.title, meeting_id)
  }

  return NextResponse.json({ ok: true, sent: sentToOrganiser })
}
