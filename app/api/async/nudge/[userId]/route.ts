import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { slackClient } from '@/lib/slack'

interface Props {
  params: Promise<{ userId: string }>
}

// POST — sends a Slack nudge DM to a specific attendee who hasn't submitted yet.
// Only callable by authenticated Meetless users.
export async function POST(req: NextRequest, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { userId } = await params
  const { meeting_id } = await req.json()

  if (!meeting_id) return NextResponse.json({ error: 'Missing meeting_id' }, { status: 400 })

  const [{ data: targetUser }, { data: meeting }] = await Promise.all([
    supabaseAdmin.from('users').select('slack_user_id').eq('id', userId).single(),
    supabaseAdmin.from('meetings').select('title').eq('id', meeting_id).single(),
  ])

  if (!targetUser?.slack_user_id) {
    return NextResponse.json({ error: 'User has no Slack connected' }, { status: 400 })
  }
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  await slackClient.chat.postMessage({
    channel: targetUser.slack_user_id,
    text: `👋 Hey! *${meeting.title}* starts soon. Your teammates are waiting for your status update.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `👋 Hey! *${meeting.title}* starts soon.\nYour teammates are waiting for your status update.`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Add my status →' },
          url: `${baseUrl}/async/${meeting_id}`,
          action_id: 'add_status_from_nudge',
        },
      },
    ],
  })

  return NextResponse.json({ ok: true })
}
