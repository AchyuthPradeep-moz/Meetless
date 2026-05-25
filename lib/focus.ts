import { getBusySlots } from './calendar'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30

// Converts a UTC Date to IST hour (0-23)
function toISTHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours()
}

// Builds a Date for a given IST hour on a given IST calendar date (YYYY-MM-DD)
function istDateAtHour(dateStr: string, hour: number): Date {
  // dateStr is YYYY-MM-DD in IST — midnight IST = UTC minus 5h30
  const [y, mo, day] = dateStr.split('-').map(Number)
  const istMidnight = Date.UTC(y, mo - 1, day, 0, 0, 0) - IST_OFFSET_MS
  return new Date(istMidnight + hour * 60 * 60 * 1000)
}

export interface FocusGap {
  date: string       // YYYY-MM-DD in IST
  startTime: Date    // UTC Date
  durationMins: number
  meetingCount: number
}

// Finds the best focus gap for each day of the coming week that has ≥ minMeetings meetings.
// "Best" = largest contiguous free slot within working hours (workStart–workEnd IST).
// Returns one suggestion per qualifying day, or empty array if none found.
export async function findFocusGaps(
  user: User,
  options: {
    daysAhead?: number     // how many days to look forward (default 5 = Mon–Fri)
    minMeetings?: number   // minimum meetings on a day to trigger suggestion (default 3)
    minGapMins?: number    // minimum gap size to suggest (default 60)
    workStart?: number     // IST hour (default 9)
    workEnd?: number       // IST hour (default 18)
  } = {}
): Promise<FocusGap[]> {
  const {
    daysAhead = 5,
    minMeetings = 3,
    minGapMins = 60,
    workStart = 9,
    workEnd = 18,
  } = options

  const now = new Date()
  // Start from now so today's remaining meetings are included
  const rangeStart = now
  const rangeEnd = new Date(rangeStart.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  console.log(`  freebusy query: ${rangeStart.toISOString()} → ${rangeEnd.toISOString()}`)
  let busySlots: Array<{ start: Date; end: Date }> = []
  try {
    busySlots = await getBusySlots(user, rangeStart, rangeEnd)
  } catch (err) {
    console.error(`  getBusySlots failed:`, err)
    return []
  }
  console.log(`  raw busy slots: ${busySlots.length}`, busySlots.map(s => `${s.start.toISOString()}→${s.end.toISOString()}`))

  // Group busy slots by IST date
  const byDate: Record<string, Array<{ start: Date; end: Date }>> = {}
  for (const slot of busySlots) {
    const istDate = new Date(slot.start.getTime() + IST_OFFSET_MS)
    const dateStr = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, '0')}-${String(istDate.getUTCDate()).padStart(2, '0')}`
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(slot)
  }

  const gaps: FocusGap[] = []

  for (const [dateStr, slots] of Object.entries(byDate)) {
    // Skip weekends (check IST day-of-week)
    const [y, mo, d] = dateStr.split('-').map(Number)
    const dowUTC = new Date(Date.UTC(y, mo - 1, d) + IST_OFFSET_MS).getUTCDay()
    if (dowUTC === 0 || dowUTC === 6) continue

    const meetingCount = slots.length
    if (meetingCount < minMeetings) continue

    // Build free slots within working hours
    const dayStart = istDateAtHour(dateStr, workStart)
    const dayEnd = istDateAtHour(dateStr, workEnd)

    // Sort busy slots and clip to working hours
    const sorted = slots
      .map((s) => ({
        start: s.start < dayStart ? dayStart : s.start,
        end: s.end > dayEnd ? dayEnd : s.end,
      }))
      .filter((s) => s.start < s.end && s.start < dayEnd && s.end > dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    // Collect ALL qualifying free gaps for this day
    let cursor = dayStart
    for (const busy of sorted) {
      if (busy.start > cursor) {
        const gapMins = Math.floor((busy.start.getTime() - cursor.getTime()) / 60000)
        if (gapMins >= minGapMins) {
          gaps.push({ date: dateStr, startTime: cursor, durationMins: gapMins, meetingCount })
        }
      }
      if (busy.end > cursor) cursor = busy.end
    }
    if (cursor < dayEnd) {
      const gapMins = Math.floor((dayEnd.getTime() - cursor.getTime()) / 60000)
      if (gapMins >= minGapMins) {
        gaps.push({ date: dateStr, startTime: cursor, durationMins: gapMins, meetingCount })
      }
    }
  }

  return gaps
}

// Returns all gaps for the busiest qualifying day (most meetings).
export function gapsForBusiestDay(gaps: FocusGap[]): FocusGap[] {
  if (!gaps.length) return []
  const byDate: Record<string, FocusGap[]> = {}
  for (const g of gaps) {
    if (!byDate[g.date]) byDate[g.date] = []
    byDate[g.date].push(g)
  }
  const busiest = Object.entries(byDate)
    .sort((a, b) => b[1][0].meetingCount - a[1][0].meetingCount)[0]
  return busiest?.[1] ?? []
}
