import { google } from 'googleapis'
import { getAuthClient } from './auth'
import type { User } from '@/types/user'
import type { MeetingPayload } from '@/types/meeting'

// Fetches calendar events for the next 7 days and maps them to MeetingPayload shape
export async function fetchUpcomingMeetings(user: User): Promise<
  Array<MeetingPayload & { google_event_id: string; start_time: string; meet_link: string | null; attendee_emails: string[]; organiser_email: string | null; attendees_with_status: { email: string; response_status: string }[] }>
> {
  const authClient = await getAuthClient(user)
  const calendar = google.calendar({ version: 'v3', auth: authClient })

  const now = new Date()
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekLater.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = res.data.items ?? []

  return events
    .filter((e) => e.start?.dateTime) // exclude all-day events
    .map((e) => {
      console.log('Raw Google event time:', e.start?.dateTime, e.start?.timeZone)

      const start = new Date(e.start!.dateTime!)
      const end = new Date(e.end!.dateTime!)
      const durationMins = Math.round((end.getTime() - start.getTime()) / 60000)
      const selfAttendee = (e.attendees ?? []).find((a) => a.self)

      const attendee_emails = (e.attendees ?? [])
        .map((a) => a.email)
        .filter((email): email is string => !!email)

      return {
        google_event_id: e.id!,
        title: e.summary ?? '',
        description: (e.description ?? '').slice(0, 200),
        start_time: e.start!.dateTime!, // stored verbatim — timezone offset preserved
        duration: durationMins,
        attendee_count: (e.attendees ?? []).length,
        attendee_emails,
        organiser_email: e.organizer?.email ?? null,
        is_organiser: selfAttendee?.organizer ?? false,
        is_recurring: !!e.recurringEventId,
        meet_link: e.hangoutLink ?? null,
        attendees_with_status: (e.attendees ?? [])
          .filter((a): a is typeof a & { email: string } => !!a.email)
          .map((a) => ({ email: a.email, response_status: a.responseStatus ?? 'needsAction' })),
      }
    })
}
