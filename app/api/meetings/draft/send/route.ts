import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { sendDraftMessageForApproval } from '@/lib/slack'
import type { Meeting } from '@/types/meeting'

// POST — sends the saved draft message to the user's Slack as an interactive approval message.
// The draft is never forwarded to the organiser until the user clicks "Send to organiser" in Slack.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id } = await req.json()
  if (!meeting_id) return NextResponse.json({ error: 'Missing meeting_id' }, { status: 400 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, slack_user_id')
    .eq('email', session.user.email)
    .single()

  if (!user?.slack_user_id) {
    return NextResponse.json({ error: 'Slack not connected. Connect Slack in Settings first.' }, { status: 400 })
  }

  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('*')
    .eq('id', meeting_id)
    .single<Meeting>()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  if (!meeting.draft_message) return NextResponse.json({ error: 'No draft message found. Generate one first.' }, { status: 400 })

  await sendDraftMessageForApproval(
    user.slack_user_id,
    meeting.id,
    meeting.title ?? '',
    meeting.draft_message,
    meeting.classification ?? 'async'
  )

  return NextResponse.json({ ok: true })
}
