import { NextRequest, NextResponse } from 'next/server'
import { runDailyDigest } from '@/lib/scheduler'

// Vercel cron — runs daily at 9am UTC. Sends morning meeting digest via Slack.
// Add ?test=true to send immediately to all connected users regardless of digest_time.
export async function GET(req: NextRequest) {
  const testMode = req.nextUrl.searchParams.get('test') === 'true'
  const result = await runDailyDigest(testMode)
  return NextResponse.json({ ok: true, ...result, testMode })
}
