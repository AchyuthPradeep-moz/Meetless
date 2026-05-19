import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { slackClient } from '@/lib/slack'

// POST — sends a Slack DM to the user with a link to their meeting summary
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id } = await req.json()

  const [{ data: user }, { data: meeting }] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id, slack_user_id')
      .eq('email', session.user.email)
      .single(),
    supabaseAdmin.from('meetings').select('title').eq('id', meeting_id).single(),
  ])

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!user.slack_user_id) {
    return NextResponse.json({ ok: true, slackSkipped: true })
  }

  const title = meeting?.title ?? 'your meeting'
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  await slackClient.chat.postMessage({
    channel: user.slack_user_id,
    text: `✅ Your summary for *${title}* is ready!`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ Your summary for *${title}* is ready!`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View Summary →' },
          url: `${baseUrl}/summaries/${meeting_id}`,
          action_id: 'view_summary',
        },
      },
    ],
  })

  return NextResponse.json({ ok: true })
}
