import { getBusySlots } from './calendar'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30

function toISTDateStr(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`
}

function istDateAtHour(dateStr: string, hour: number): Date {
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

// Finds all free gaps ≥ minGapMins on every working day in the next daysAhead days.
// No meeting-count threshold — any day with a free hour qualifies.
export async function findFocusGaps(
  user: User,
  options: {
    daysAhead?: number   // how many calendar days to scan (default 1 = today only)
    minGapMins?: number  // minimum gap length in minutes (default 60)
    workStart?: number   // IST hour (default 9)
    workEnd?: number     // IST hour (default 18)
  } = {}
): Promise<FocusGap[]> {
  const {
    daysAhead = 1,
    minGapMins = 60,
    workStart = 9,
    workEnd = 18,
  } = options

  const now = new Date()
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
  console.log(`  raw busy slots: ${busySlots.length}`)

  // Group busy slots by IST date
  const byDate: Record<string, Array<{ start: Date; end: Date }>> = {}
  for (const slot of busySlots) {
    const dateStr = toISTDateStr(slot.start)
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(slot)
  }

  const gaps: FocusGap[] = []

  for (let i = 0; i < daysAhead; i++) {
    const dayDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000)
    const dateStr = toISTDateStr(dayDate)

    // Skip weekends
    const [y, mo, d] = dateStr.split('-').map(Number)
    const dow = new Date(Date.UTC(y, mo - 1, d) + IST_OFFSET_MS).getUTCDay()
    if (dow === 0 || dow === 6) continue

    const dayStart = istDateAtHour(dateStr, workStart)
    const dayEnd = istDateAtHour(dateStr, workEnd)

    // For today, don't suggest time that's already passed
    const effectiveStart = i === 0 && now > dayStart ? now : dayStart

    if (effectiveStart >= dayEnd) continue // working hours already over

    const slots = byDate[dateStr] ?? []
    const meetingCount = slots.length

    const sorted = slots
      .map((s) => ({
        start: s.start < effectiveStart ? effectiveStart : s.start,
        end: s.end > dayEnd ? dayEnd : s.end,
      }))
      .filter((s) => s.start < s.end && s.start < dayEnd && s.end > effectiveStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    let cursor = effectiveStart
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
