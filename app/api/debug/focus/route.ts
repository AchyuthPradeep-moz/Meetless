import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { findFocusGaps } from '@/lib/focus'
import { getBusySlots } from '@/lib/calendar'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'not authenticated' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', session.user.email)
    .single<User>()

  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

  const now = new Date()
  const rangeEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Step 1: raw busy slots
  let busySlots: Array<{ start: Date; end: Date }> = []
  let busySlotsError: string | null = null
  try {
    busySlots = await getBusySlots(user, now, rangeEnd)
  } catch (err) {
    busySlotsError = String(err)
  }

  // Step 2: processed gaps (7 days, 15-min min to see everything)
  let gaps: Awaited<ReturnType<typeof findFocusGaps>> = []
  let gapsError: string | null = null
  try {
    gaps = await findFocusGaps(user, { daysAhead: 7, minGapMins: 15 })
  } catch (err) {
    gapsError = String(err)
  }

  const fmt = (d: Date) => {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    const h = ist.getUTCHours()
    const m = ist.getUTCMinutes()
    const ap = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`
  }

  return NextResponse.json({
    now: now.toISOString(),
    nowIST: new Date(now.getTime() + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) + ' IST',
    hasRefreshToken: !!user.refresh_token,
    hasSlackUserId: !!user.slack_user_id,
    busySlotsError,
    busySlotsCount: busySlots.length,
    busySlots: busySlots.slice(0, 20).map(s => ({
      start: new Date(s.start.getTime() + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) + ' IST',
      end: new Date(s.end.getTime() + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) + ' IST',
    })),
    gapsError,
    gapsCount: gaps.length,
    gaps: gaps.map(g => ({
      date: g.date,
      start: fmt(g.startTime),
      end: fmt(new Date(g.startTime.getTime() + g.durationMins * 60000)),
      durationMins: g.durationMins,
      meetingCount: g.meetingCount,
    })),
    gaps60min: gaps.filter(g => g.durationMins >= 60).length,
  })
}
