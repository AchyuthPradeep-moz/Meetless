import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { generateAsyncSummary } from '@/lib/claude'

// POST — generates a Claude summary of all status updates and saves it to the meeting.
// Resolves all sibling meeting rows via google_event_id so updates from every attendee
// are included regardless of which meeting row they submitted against.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id } = await req.json()

  // Resolve google_event_id for this meeting
  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('google_event_id')
    .eq('id', meeting_id)
    .single()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })

  // Find all sibling meeting rows for the same calendar event
  const { data: siblingRows } = await supabaseAdmin
    .from('meetings')
    .select('id')
    .eq('google_event_id', meeting.google_event_id)

  const allMeetingIds = (siblingRows ?? []).map((r) => r.id)

  // Fetch updates across all sibling rows (no FK join — resolve emails separately)
  const { data: rawUpdates } = await supabaseAdmin
    .from('status_updates')
    .select('completed, plan, blockers, status_tag, user_id')
    .in('meeting_id', allMeetingIds)

  if (!rawUpdates?.length) {
    return NextResponse.json({ error: 'No updates to summarise' }, { status: 400 })
  }

  // Resolve user emails separately to avoid FK join ambiguity
  const userIds = [...new Set(rawUpdates.map((u) => u.user_id))]
  const { data: userRows } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .in('id', userIds)

  const emailMap: Record<string, string> = {}
  for (const u of userRows ?? []) emailMap[u.id] = u.email

  const formatted = rawUpdates.map((u) => ({
    email: emailMap[u.user_id] ?? 'unknown',
    completed: u.completed,
    plan: u.plan,
    blockers: u.blockers,
    status_tag: u.status_tag,
  }))

  const summary = await generateAsyncSummary(formatted)

  // Save summary to the requesting user's meeting row
  await supabaseAdmin
    .from('meetings')
    .update({ async_summary: summary })
    .eq('id', meeting_id)

  return NextResponse.json({ summary })
}
