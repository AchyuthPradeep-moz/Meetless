import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { generateAsyncDraftMessage, generatePassiveDraftMessage } from '@/lib/claude'
import type { Meeting } from '@/types/meeting'

// Extracts a capitalised first name from an email address.
// achyuth@mozilor.com → Achyuth
function firstNameFromEmail(email: string): string {
  const local = email.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

// POST — generates a Claude draft message for an async or passive meeting and saves it to DB.
// Always saved as a draft — never sent automatically.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id } = await req.json()
  if (!meeting_id) return NextResponse.json({ error: 'Missing meeting_id' }, { status: 400 })

  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('*')
    .eq('id', meeting_id)
    .single<Meeting>()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })

  const cls = meeting.classification
  if (cls !== 'async' && cls !== 'passive') {
    return NextResponse.json({ error: 'Draft messages are only for async or passive meetings' }, { status: 400 })
  }

  // Resolve sender name: prefer session display name, fall back to first name from email
  const sessionName = session.user.name ?? ''
  const senderName = sessionName.trim()
    ? sessionName.split(' ')[0]
    : firstNameFromEmail(session.user.email)

  const draft_message =
    cls === 'async'
      ? await generateAsyncDraftMessage(meeting.title ?? '', meeting.attendee_count, meeting.duration, senderName)
      : await generatePassiveDraftMessage(meeting.title ?? '', senderName)

  await supabaseAdmin
    .from('meetings')
    .update({ draft_message, draft_sent: false })
    .eq('id', meeting_id)

  return NextResponse.json({ draft_message, sender_name: senderName })
}
