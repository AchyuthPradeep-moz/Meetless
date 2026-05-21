import { NextRequest, NextResponse } from 'next/server'
import { runReminder } from '@/lib/scheduler'

// Vercel cron — runs every 5 min. Sends 10-min Slack reminders for Important meetings.
// Add ?test=true to fire immediately for any Important meeting, without marking reminder_sent.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const testMode = req.nextUrl.searchParams.get('test') === 'true'
  const result = await runReminder(testMode)
  return NextResponse.json({ ok: true, ...result, testMode })
}
