import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { slackClient } from '@/lib/slack'

// Handles Slack Events API webhooks.
// Supported events:
//   url_verification — Slack challenge handshake
//   message (message.im) — relay organiser replies back to the original sender
export async function POST(req: NextRequest) {
  const text = await req.text()

  // Interactivity payloads (button clicks) are form-encoded — they belong at /api/slack/actions
  if (text.startsWith('payload=')) {
    console.warn('Received interactivity payload at /events — check Slack app Interactivity URL setting')
    return NextResponse.json({ ok: true })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(text)
  } catch {
    console.error('Failed to parse Slack event body:', text.slice(0, 120))
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('Slack event received:', JSON.stringify(body, null, 2))

  // Slack URL verification — must echo the challenge back exactly
  if (body.type === 'url_verification') {
    console.log('Slack URL verification challenge received — responding')
    return NextResponse.json({ challenge: body.challenge })
  }

  if (body.type !== 'event_callback') {
    console.log('Ignoring non-event_callback type:', body.type)
    return NextResponse.json({ ok: true })
  }

  const event = body.event
  if (!event) {
    console.log('No event in payload')
    return NextResponse.json({ ok: true })
  }

  console.log('Event type:', event.type, '| user:', event.user, '| bot_id:', event.bot_id ?? 'none', '| subtype:', event.subtype ?? 'none')

  // Relay plain human DMs — ignore bot messages, message edits/deletes, and app-own messages
  const isHumanMessage =
    event.type === 'message' &&
    !event.bot_id &&
    !event.bot_profile &&
    !event.subtype &&
    !!event.user

  if (isHumanMessage) {
    console.log('Message from:', event.user)
    console.log('Message text:', event.text)
    console.log('Checking for draft sent to:', event.user)
    // Fire-and-forget: return 200 immediately so Slack does not retry,
    // then complete the relay in the background
    relayOrganiserReply(event.user, event.text ?? '').catch((err) =>
      console.error('Relay failed:', err)
    )
  } else {
    console.log('Skipping — not a qualifying human message')
  }

  return NextResponse.json({ ok: true })
}

async function relayOrganiserReply(senderSlackUserId: string, messageText: string) {
  console.log('relayOrganiserReply called for sender:', senderSlackUserId)

  // Find a meeting where this Slack user is the organiser we sent a draft to
  const { data: meeting, error: meetingErr } = await supabaseAdmin
    .from('meetings')
    .select('id, title, draft_sent_by_user_id')
    .eq('draft_sent_to_slack_user_id', senderSlackUserId)
    .eq('draft_sent', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (meetingErr) {
    console.log('No matching meeting found for sender', senderSlackUserId, '— Supabase error:', meetingErr.message)
    return
  }
  if (!meeting) {
    console.log('No matching meeting found for sender', senderSlackUserId)
    return
  }
  console.log('Meeting found for relay:', meeting.title)
  if (!meeting.draft_sent_by_user_id) {
    console.log('Meeting found but draft_sent_by_user_id is null — cannot relay')
    return
  }

  console.log('Matched meeting:', meeting.id, '| title:', meeting.title, '| forwarding to user id:', meeting.draft_sent_by_user_id)

  // Look up the original sender's Slack user ID
  const { data: originalSender, error: userErr } = await supabaseAdmin
    .from('users')
    .select('slack_user_id')
    .eq('id', meeting.draft_sent_by_user_id)
    .single()

  if (userErr) {
    console.error('Failed to look up original sender:', userErr.message)
    return
  }
  if (!originalSender?.slack_user_id) {
    console.log('Original sender has no Slack connected — cannot relay')
    return
  }

  console.log('Relaying to original sender slack_user_id:', originalSender.slack_user_id)

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  await slackClient.chat.postMessage({
    channel: originalSender.slack_user_id,
    text: `📩 Reply from meeting organiser for "${meeting.title}"`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📩 *Reply from meeting organiser* for _${meeting.title}_:\n\n> ${messageText.replace(/\n/g, '\n> ')}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Meeting →' },
            url: `${baseUrl}/meetings/${meeting.id}`,
            action_id: 'view_meeting_from_relay',
          },
        ],
      },
    ],
  })

  console.log('Relay complete — message forwarded to', originalSender.slack_user_id)
}
