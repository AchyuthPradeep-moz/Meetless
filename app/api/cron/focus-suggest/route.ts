import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { findFocusGaps } from '@/lib/focus'
import { sendFocusSuggestion } from '@/lib/slack'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// Manual trigger — same logic as the focus suggestion in runDailyDigest.
// ?test=true — looks 7 days ahead with 15-min minimum gap instead of 60.
export async function GET(req: NextRequest) {
  const testMode = req.nextUrl.searchParams.get('test') === 'true'

  const authHeader = req.headers.get('authorization')
  if (!testMode && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.log('\n=== /api/cron/focus-suggest |', new Date().toISOString(), '| testMode:', testMode, '===')

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

  const fmt = (d: Date) => {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    const h = ist.getUTCHours()
    const m = ist.getUTCMinutes()
    const ap = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`
  }

  let sent = 0

  for (const user of users as User[]) {
    console.log(`\nChecking focus gaps for ${user.email}`)

    try {
      const gaps = await findFocusGaps(user, {
        daysAhead:  testMode ? 7 : 1,
        minGapMins: testMode ? 15 : 60,
      })

      console.log(`  Gaps found: ${gaps.length}`, gaps.map(g => `${g.date} ${g.durationMins}min`))

      if (!gaps.length) {
        console.log(`  No qualifying gaps found`)
        continue
      }

      const [y, mo, d] = gaps[0].date.split('-').map(Number)
      const dateLabel = new Date(Date.UTC(y, mo - 1, d) + IST_OFFSET_MS)
        .toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long',
          timeZone: 'Asia/Kolkata',
        })

      const formattedGaps = gaps.map(g => ({
        startLabel: fmt(g.startTime),
        endLabel: fmt(new Date(g.startTime.getTime() + g.durationMins * 60 * 1000)),
        isoStart: g.startTime.toISOString(),
      }))

      console.log(`  Suggesting ${gaps.length} gap(s) on ${gaps[0].date}`)

      await sendFocusSuggestion(user.slack_user_id!, user.id, dateLabel, formattedGaps)
      sent++
    } catch (err) {
      console.error(`  Failed for ${user.email}:`, err)
    }
  }

  console.log(`\n=== Done | sent=${sent} ===`)
  return NextResponse.json({ sent })
}
