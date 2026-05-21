import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { findFocusGaps } from '@/lib/focus'
import { sendFocusSuggestion } from '@/lib/slack'
import type { User } from '@/types/user'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// Runs once daily (after the morning digest).
// For each user with Google + Slack connected, finds the busiest upcoming day
// with a free gap and sends a focus-block suggestion via Slack.
//
// ?test=true — lowers thresholds (1 meeting, 15 min gap, looks 14 days ahead)
//              so you can test without needing a packed calendar
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
      const gaps = await findFocusGaps(user, {
        daysAhead:   testMode ? 14 : 5,
        minMeetings: testMode ? 1  : 3,
        minGapMins:  testMode ? 15 : 60,
      })

      console.log(`  Gaps found: ${gaps.length}`, gaps.map(g => `${g.date} ${g.meetingCount} meetings ${g.durationMins}min gap`))

      if (!gaps.length) {
        console.log(`  No qualifying gaps found`)
        continue
      }

      // Pick the day with the most meetings (most in need of a focus block)
      const best = gaps.sort((a, b) => b.meetingCount - a.meetingCount)[0]

      // Format display labels in IST
      const startIST = new Date(best.startTime.getTime() + IST_OFFSET_MS)
      const hour = startIST.getUTCHours()
      const minute = startIST.getUTCMinutes()
      const ampm = hour >= 12 ? 'pm' : 'am'
      const h12 = hour % 12 === 0 ? 12 : hour % 12
      const startLabel = minute === 0
        ? `${h12}${ampm}`
        : `${h12}:${String(minute).padStart(2, '0')}${ampm}`

      const [y, mo, d] = best.date.split('-').map(Number)
      const dateLabel = new Date(Date.UTC(y, mo - 1, d) + IST_OFFSET_MS)
        .toLocaleDateString('en-IN', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'Asia/Kolkata',
        })

      console.log(`  Suggesting gap on ${best.date} at ${startLabel} (${best.durationMins} min, ${best.meetingCount} meetings)`)

      await sendFocusSuggestion(
        user.slack_user_id!,
        user.id,
        dateLabel,
        startLabel,
        best.durationMins,
        best.meetingCount,
        best.startTime.toISOString(),
      )

      sent++
    } catch (err) {
      console.error(`  Failed for ${user.email}:`, err)
    }
  }

  console.log(`\n=== Done | sent=${sent} ===`)
  return NextResponse.json({ sent })
}
