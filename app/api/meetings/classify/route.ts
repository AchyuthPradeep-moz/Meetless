import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchUpcomingMeetings } from '@/lib/google'
import { classifyMeetings } from '@/lib/classifier'
import type { User } from '@/types/user'

// POST — syncs Google Calendar and classifies any unclassified meetings
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', session.user.email)
    .single<User>()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const calEvents = await fetchUpcomingMeetings(user)

  // Find which events are already classified — never reclassify
  const eventIds = calEvents.map((e) => e.google_event_id)
  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('google_event_id')
    .eq('user_id', user.id)
    .in('google_event_id', eventIds)

  const classifiedIds = new Set((existing ?? []).map((e: any) => e.google_event_id))
  const newEvents = calEvents.filter((e) => !classifiedIds.has(e.google_event_id))

  if (!newEvents.length) return NextResponse.json({ classified: 0 })

  const results = await classifyMeetings(newEvents)

  const rows = newEvents.map((e, i) => ({
    user_id: user.id,
    google_event_id: e.google_event_id,
    title: e.title,
    description: e.description,
    start_time: e.start_time,
    duration: e.duration,
    attendee_count: e.attendee_count,
    is_organiser: e.is_organiser,
    is_recurring: e.is_recurring,
    meet_link: e.meet_link,
    classification: results[i].classification,
    confidence: results[i].confidence,
    reason: results[i].reason,
  }))

  await supabaseAdmin.from('meetings').insert(rows)

  return NextResponse.json({ classified: rows.length })
}
