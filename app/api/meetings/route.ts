import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchUpcomingMeetings } from '@/lib/google'
import { classifyMeetings } from '@/lib/classifier'
import type { User } from '@/types/user'

// GET — fetches upcoming meetings from Google Calendar, classifies new ones, persists to DB,
// then returns the full list for the authenticated user.
export async function GET(req: NextRequest) {
  console.log('GET /api/meetings called')

  const session = await getServerSession(authOptions)
  console.log('Session:', session?.user?.email ?? 'no session')

  if (!session?.user?.email) {
    return NextResponse.json([])
  }

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', session.user.email)
    .single<User>()

  if (userErr) console.error('Supabase user lookup error:', userErr)
  console.log('User found:', user ? `id=${user.id}` : 'NOT FOUND — user was never saved to DB')

  if (!user) return NextResponse.json([])

  console.log('Tokens: access_token=', !!user.access_token, '| refresh_token=', !!user.refresh_token)

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // Force reclassify: wipe all meetings for this user so everything is re-fetched and re-classified
  const force = req.nextUrl.searchParams.get('force') === 'true'
  if (force) {
    const { error: deleteErr } = await supabaseAdmin
      .from('meetings')
      .delete()
      .eq('user_id', user.id)
    if (deleteErr) console.error('Force delete failed:', deleteErr)
    else console.log('Force mode — deleted all meetings for user', user.id)
  }

  // Fetch from Google Calendar; fall back to DB on failure
  let googleMeetings: Awaited<ReturnType<typeof fetchUpcomingMeetings>>
  try {
    googleMeetings = await fetchUpcomingMeetings(user)
    console.log('Google Calendar: fetched', googleMeetings.length, 'meetings')
  } catch (err) {
    console.error('Google Calendar fetch failed:', err)
    const { data: fallback } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('user_id', user.id)
      .order('start_time')
    console.log('Returning DB fallback:', fallback?.length ?? 0, 'meetings')
    return NextResponse.json(fallback ?? [])
  }

  // Cleanup: remove cancelled + old past meetings from DB
  const freshEventIds = new Set(googleMeetings.map((m) => m.google_event_id))

  // Delete meetings removed from Google Calendar, but only if they ended >7 days ago.
  // Recent past meetings won't appear in the upcoming Calendar feed — keep them so the
  // transcript cron has time to find and process them.
  const { data: dbMeetingsForCleanup } = await supabaseAdmin
    .from('meetings')
    .select('id, google_event_id, title, end_time, start_time')
    .eq('user_id', user.id)

  const staleIds = (dbMeetingsForCleanup ?? [])
    .filter((m) => {
      if (freshEventIds.has(m.google_event_id)) return false
      const end = m.end_time ? new Date(m.end_time) : new Date(new Date(m.start_time).getTime() + 60 * 60 * 1000)
      // Future meetings not in Google Calendar feed → deleted/cancelled → remove immediately
      if (end > now) return true
      // Past meetings → keep for 7 days so the transcript cron can still process them
      return end < sevenDaysAgo
    })
    .map((m) => m.id)

  if (staleIds.length > 0) {
    const staleTitles = (dbMeetingsForCleanup ?? [])
      .filter((m) => staleIds.includes(m.id))
      .map((m) => m.title)
    console.log('Deleting', staleIds.length, 'stale meetings removed from Google Calendar:', staleTitles)
    await supabaseAdmin.from('meetings').delete().in('id', staleIds)
  }

  // Delete meetings that ended more than 7 days ago (skip when include_past=true for testing).
  // Keeps recent past rows alive so the transcript cron can still process them.
  const includePast = req.nextUrl.searchParams.get('include_past') === 'true'
  if (!includePast) {
    const { error: pastDeleteErr } = await supabaseAdmin
      .from('meetings')
      .delete()
      .eq('user_id', user.id)
      .or(`end_time.lt.${sevenDaysAgo.toISOString()},and(start_time.lt.${sevenDaysAgo.toISOString()},end_time.is.null)`)
    if (pastDeleteErr) console.error('Failed to delete old past meetings:', pastDeleteErr)
    else console.log('Cleaned meetings older than 7 days (cutoff', sevenDaysAgo.toISOString(), ')')
  } else {
    console.log('include_past=true — skipping past meeting cleanup')
  }

  // Determine which meetings are new (not already stored)
  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('google_event_id')
    .eq('user_id', user.id)

  const existingIds = new Set((existing ?? []).map((m) => m.google_event_id))
  const newMeetings = googleMeetings.filter((m) => !existingIds.has(m.google_event_id))
  const existingMeetings = googleMeetings.filter((m) => existingIds.has(m.google_event_id))
  console.log('New meetings to classify:', newMeetings.length, '| already in DB:', existingIds.size)

  // Classify and persist new meetings
  if (newMeetings.length > 0) {
    try {
      const classifications = await classifyMeetings(newMeetings)

      const validClassifications = ['important', 'async', 'passive']

      const rows = newMeetings.map((meeting, i) => {
        const cls = classifications[i]
        if (!validClassifications.includes(cls.classification)) {
          console.error('Invalid classification before insert:', cls.classification, '— for meeting:', meeting.title)
          cls.classification = 'important'
        }
        return {
          user_id: user.id,
          google_event_id: meeting.google_event_id,
          title: meeting.title,
          description: meeting.description,
          start_time: meeting.start_time,
          end_time: new Date(new Date(meeting.start_time).getTime() + meeting.duration * 60 * 1000).toISOString(),
          duration: meeting.duration,
          attendee_count: meeting.attendee_count,
          attendee_emails: meeting.attendee_emails,
          organiser_email: meeting.organiser_email,
          is_organiser: meeting.is_organiser,
          is_recurring: meeting.is_recurring,
          meet_link: meeting.meet_link,
          classification: cls.classification,
          confidence: cls.confidence,
          reason: cls.reason,
        }
      })

      for (const row of rows) {
        console.log('Saving start_time:', row.start_time, '| classification:', row.classification)
      }

      const { data: insertedMeetings, error: insertErr } = await supabaseAdmin
        .from('meetings')
        .insert(rows)
        .select('id, google_event_id')
      if (insertErr) {
        console.error('Failed to save meetings:', insertErr)
      } else {
        console.log('Saved', rows.length, 'new meetings to DB')
        // Populate meeting_attendees for new meetings
        const attendeeRows: Array<{ meeting_id: string; email: string; response_status: string }> = []
        for (const inserted of insertedMeetings ?? []) {
          const source = newMeetings.find((m) => m.google_event_id === inserted.google_event_id)
          for (const att of source?.attendees_with_status ?? []) {
            attendeeRows.push({ meeting_id: inserted.id, email: att.email, response_status: att.response_status })
          }
        }
        if (attendeeRows.length) {
          await supabaseAdmin.from('meeting_attendees').upsert(attendeeRows, { onConflict: 'meeting_id,email' })
          console.log('Upserted', attendeeRows.length, 'meeting_attendees rows for new meetings')
        }
      }
    } catch (err) {
      console.error('Classification failed:', err)
    }
  }

  // Backfill attendee_emails + organiser_email for meetings already in DB
  if (existingMeetings.length > 0) {
    // Get existing meeting IDs for meeting_attendees upsert
    const { data: existingRows } = await supabaseAdmin
      .from('meetings')
      .select('id, google_event_id')
      .eq('user_id', user.id)
      .in('google_event_id', existingMeetings.map((m) => m.google_event_id))

    await Promise.all(
      existingMeetings.map((meeting) =>
        supabaseAdmin
          .from('meetings')
          .update({
            attendee_emails: meeting.attendee_emails,
            organiser_email: meeting.organiser_email,
            end_time: new Date(new Date(meeting.start_time).getTime() + meeting.duration * 60 * 1000).toISOString(),
          })
          .eq('user_id', user.id)
          .eq('google_event_id', meeting.google_event_id)
      )
    )

    // Upsert meeting_attendees for existing meetings
    const attendeeRows: Array<{ meeting_id: string; email: string; response_status: string }> = []
    for (const row of existingRows ?? []) {
      const source = existingMeetings.find((m) => m.google_event_id === row.google_event_id)
      for (const att of source?.attendees_with_status ?? []) {
        attendeeRows.push({ meeting_id: row.id, email: att.email, response_status: att.response_status })
      }
    }
    if (attendeeRows.length) {
      await supabaseAdmin.from('meeting_attendees').upsert(attendeeRows, { onConflict: 'meeting_id,email' })
    }

    console.log('Backfilled attendee_emails + organiser_email for', existingMeetings.length, 'existing meetings')
  }

  // Return all meetings from DB sorted by start time
  const { data: allMeetings } = await supabaseAdmin
    .from('meetings')
    .select('*')
    .eq('user_id', user.id)
    .order('start_time')

  console.log('Returning', allMeetings?.length ?? 0, 'meetings total')
  if (allMeetings?.[0]) {
    console.log('DB start_time:', allMeetings[0].start_time)
  }
  return NextResponse.json(allMeetings ?? [])
}
