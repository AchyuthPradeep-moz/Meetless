import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { findFocusGaps, gapsForBusiestDay } from '@/lib/focus'
import { sendFocusSuggestion } from '@/lib/slack'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// Manual trigger endpoint — same logic as the focus suggestion in runDailyDigest.
// ?test=true — lowers thresholds (1 meeting, 15 min gap, looks 14 days ahead)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const testMode = req.nextUrl.searchParams.get('test') === 'true'
  console.log('\n=== /api/cron/focus-suggest | ', new Date().toISOString(), '| testMode:', testMode, '===')

  const { data: users } = await supabaseAdmin
    .from('users')
    .select('*')
    .not('slack_user_id', 'is', null)
    .not('refresh_token', 'is', null)

  if (!users?.length) {
    console.log('No eligible users — exiting')
    return NextResponse.json({ sent: 0, reason: 'no eligible users' })
  }

  console.log(`Eligible users: ${(users as User[]).map((u) => u.email).join(', ')}`)

  let sent = 0

  for (const user of users as User[]) {
    console.log(`\nChecking focus gaps for ${user.email}`)

    try {
      const allGaps = await findFocusGaps(user, {
        daysAhead:   testMode ? 14 : 5,
        minMeetings: testMode ? 1  : 3,
        minGapMins:  testMode ? 15 : 60,
      })

      console.log(`  Gaps found: ${allGaps.length}`, allGaps.map(g => `${g.date} ${g.meetingCount} meetings ${g.durationMins}min gap`))

      const dayGaps = gapsForBusiestDay(allGaps)
      if (!dayGaps.length) {
        console.log(`  No qualifying gaps found`)
        continue
      }

      const fmt = (d: Date) => {
        const ist = new Date(d.getTime() + IST_OFFSET_MS)
        const h = ist.getUTCHours()
        const m = ist.getUTCMinutes()
        const ap = h >= 12 ? 'pm' : 'am'
        const h12 = h % 12 === 0 ? 12 : h % 12
        return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`
      }

      const first = dayGaps[0]
      const [y, mo, d] = first.date.split('-').map(Number)
      const dateLabel = new Date(Date.UTC(y, mo - 1, d) + IST_OFFSET_MS)
        .toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long',
          timeZone: 'Asia/Kolkata',
        })

      const formattedGaps = dayGaps.map(g => ({
        startLabel: fmt(g.startTime),
        endLabel: fmt(new Date(g.startTime.getTime() + g.durationMins * 60 * 1000)),
        isoStart: g.startTime.toISOString(),
      }))

      console.log(`  Suggesting ${dayGaps.length} gaps on ${first.date} (${first.meetingCount} meetings)`)

      await sendFocusSuggestion(
        user.slack_user_id!,
        user.id,
        dateLabel,
        first.meetingCount,
        formattedGaps,
      )

      sent++
    } catch (err) {
      console.error(`  Failed for ${user.email}:`, err)
    }
  }

  console.log(`\n=== Done | sent=${sent} ===`)
  return NextResponse.json({ sent })
}
