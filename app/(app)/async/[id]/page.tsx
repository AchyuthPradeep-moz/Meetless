import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import AsyncBoardClient from './AsyncBoardClient'
import type { Meeting } from '@/types/meeting'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AsyncBoardPage({ params }: Props) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('*')
    .eq('id', id)
    .single<Meeting>()

  // classification check removed — the board is accessible to all attendees
  // regardless of how each user's own meeting row is classified
  if (!meeting) notFound()

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  // Find ALL meeting rows for this event — each user who synced it has their own row.
  // We query status_updates across all of them so everyone sees everyone's submissions.
  const { data: siblingRows } = await supabaseAdmin
    .from('meetings')
    .select('id')
    .eq('google_event_id', meeting.google_event_id)

  const allMeetingIds = (siblingRows ?? []).map((r) => r.id)

  // Check if the current user already submitted against ANY of the sibling meeting rows
  const { data: existingUpdate } = user
    ? await supabaseAdmin
        .from('status_updates')
        .select('id')
        .in('meeting_id', allMeetingIds)
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
    : { data: null }

  const isOrganiser =
    !!meeting.organiser_email &&
    session.user.email.toLowerCase() === meeting.organiser_email.toLowerCase()

  // Organiser skips the form entirely — treat them as already "submitted"
  const initialHasSubmitted = !!existingUpdate || isOrganiser

  const meetingStarted = new Date(meeting.start_time) <= new Date()

  // Initial updates for SSR — query across all sibling meeting rows, resolve emails separately.
  const { data: rawUpdates } = await supabaseAdmin
    .from('status_updates')
    .select('id, user_id, completed, plan, blockers, status_tag, submitted_at')
    .in('meeting_id', allMeetingIds)
    .order('submitted_at')

  const ssrUserIds = [...new Set((rawUpdates ?? []).map((u) => u.user_id))]
  let ssrEmailMap: Record<string, string> = {}
  if (ssrUserIds.length > 0) {
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .in('id', ssrUserIds)
    for (const u of userRows ?? []) ssrEmailMap[u.id] = u.email
  }
  const updates = (rawUpdates ?? []).map((u) => ({
    ...u,
    user_email: ssrEmailMap[u.user_id] ?? null,
  }))

  return (
    <AsyncBoardClient
      meeting={meeting}
      currentUserEmail={session.user.email}
      organiserEmail={meeting.organiser_email ?? null}
      initialUpdates={updates ?? []}
      initialHasSubmitted={initialHasSubmitted}
      initialSummary={meeting.async_summary ?? null}
      meetingStarted={meetingStarted}
      isOrganiser={isOrganiser}
    />
  )
}
