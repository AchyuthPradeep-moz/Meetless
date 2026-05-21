import { google } from 'googleapis'
import { getAuthClient } from './auth'
import type { User } from '@/types/user'

const IST = 'Asia/Kolkata'
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// Formats a UTC Date as a local IST datetime string with no timezone suffix.
// e.g. 2026-05-22T03:30:00Z → "2026-05-22T09:00:00"
// Passed alongside timeZone: 'Asia/Kolkata' so Google Calendar interprets it
// as IST unambiguously, regardless of how the user's calendar is configured.
function toISTLocalString(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}` +
         `T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:00`
}

// Creates a "Focus Time — Blocked by Meetless" event on the user's primary calendar.
// Returns the created event ID.
export async function createFocusBlock(
  user: User,
  startTime: Date,
  durationMins: number
): Promise<string> {
  const auth = await getAuthClient(user)
  const calendar = google.calendar({ version: 'v3', auth })

  const endTime = new Date(startTime.getTime() + durationMins * 60 * 1000)

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: 'Focus Time — Blocked by Meetless',
      start: { dateTime: toISTLocalString(startTime), timeZone: IST },
      end: { dateTime: toISTLocalString(endTime), timeZone: IST },
      colorId: '2', // sage green
      reminders: { useDefault: false },
    },
  })

  return data.id!
}

// Queries Google Calendar freebusy for a user over a time range.
// Returns an array of busy intervals as { start, end } Date pairs.
export async function getBusySlots(
  user: User,
  rangeStart: Date,
  rangeEnd: Date
): Promise<Array<{ start: Date; end: Date }>> {
  const auth = await getAuthClient(user)
  const calendar = google.calendar({ version: 'v3', auth })

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      items: [{ id: 'primary' }],
    },
  })

  const busy = data.calendars?.primary?.busy ?? []
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }))
}
