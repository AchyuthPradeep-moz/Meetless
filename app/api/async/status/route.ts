import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

// POST — saves a status update for the logged-in user
export async function POST(req: NextRequest) {
  console.log('Status POST called')

  const session = await getServerSession(authOptions)
  console.log('Session user:', session?.user?.email ?? 'NO SESSION')
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  console.log('Request body:', body)
  const { meeting_id, completed, plan, blockers, status_tag } = body

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  console.log('User found in DB:', user?.id ?? 'NOT FOUND')
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const insertData = {
    meeting_id,
    user_id: user.id,
    completed,
    plan,
    blockers: blockers || null,
    status_tag: status_tag || 'in-progress',
  }
  console.log('Inserting status_update:', insertData)

  const { data: saved, error } = await supabaseAdmin
    .from('status_updates')
    .insert(insertData)
    .select()
    .single()

  console.log('Insert result — data:', saved, '| error:', error)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(saved)
}

// GET — returns all status updates for a meeting, submitted count, total count, and attendee info.
// Uses google_event_id to collect submissions across ALL users' meeting rows for the same event.
// Each user has their own meeting row; this ensures everyone sees everyone's updates.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const meetingId = req.nextUrl.searchParams.get('meeting_id')
  if (!meetingId) return NextResponse.json({ error: 'Missing meeting_id' }, { status: 400 })

  // Step 1 — resolve the base meeting to get google_event_id and metadata
  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('google_event_id, attendee_emails, async_summary, organiser_email')
    .eq('id', meetingId)
    .single()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })

  // Step 2 — find ALL meeting rows for this event (one per user who synced it)
  const { data: siblingRows } = await supabaseAdmin
    .from('meetings')
    .select('id')
    .eq('google_event_id', meeting.google_event_id)

  const allMeetingIds = (siblingRows ?? []).map((r) => r.id)
  console.log(`Status GET — event ${meeting.google_event_id} has ${allMeetingIds.length} meeting rows`)

  // Step 3 — fetch status_updates across ALL sibling meeting rows
  const { data: rawUpdates } = await supabaseAdmin
    .from('status_updates')
    .select('id, user_id, completed, plan, blockers, status_tag, submitted_at')
    .in('meeting_id', allMeetingIds)
    .order('submitted_at')

  console.log('status_updates rows:', rawUpdates?.length ?? 0)
  console.log('user_ids in updates:', (rawUpdates ?? []).map((u) => u.user_id))

  // Resolve user emails separately to avoid Supabase join ambiguity
  const userIds = [...new Set((rawUpdates ?? []).map((u) => u.user_id))]
  let userEmailMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .in('id', userIds)
    for (const u of userRows ?? []) userEmailMap[u.id] = u.email
  }

  const updates = (rawUpdates ?? []).map((u) => ({
    ...u,
    user_email: userEmailMap[u.user_id] ?? null,
  }))

  console.log('updates with emails:', updates.map((u) => ({ user_email: u.user_email, status_tag: u.status_tag })))

  const submitted_count = updates.length
  const attendeeEmails: string[] = meeting?.attendee_emails ?? []
  const organiserEmail: string | null = meeting?.organiser_email ?? null

  // total_count excludes the organiser — they are not expected to submit
  const total_count = attendeeEmails.filter(
    (email: string) => email.toLowerCase() !== organiserEmail?.toLowerCase()
  ).length

  // effectiveEmails adds organiser for display purposes (attendee cards) but not the count
  const effectiveEmails = Array.from(
    new Set([...attendeeEmails, ...(organiserEmail ? [organiserEmail] : [])])
  )

  // Build per-attendee info including userId so the client can call the nudge endpoint
  let attendees: Array<{
    email: string
    submitted: boolean
    isMeetlessUser: boolean
    userId: string | null
  }> = []

  if (effectiveEmails.length > 0) {
    const { data: meetlessUsers } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .in('email', effectiveEmails)

    const submittedUserIds = new Set((rawUpdates ?? []).map((u) => u.user_id))

    attendees = effectiveEmails.map((email) => {
      const user = (meetlessUsers ?? []).find((u) => u.email === email)
      return {
        email,
        submitted: user ? submittedUserIds.has(user.id) : false,
        isMeetlessUser: !!user,
        userId: user?.id ?? null,
      }
    })
  }

  return NextResponse.json({
    updates,
    submitted_count,
    total_count,
    attendees,
    summary: meeting?.async_summary ?? null,
  })
}
