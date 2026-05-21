import { NextRequest, NextResponse } from 'next/server'
import { runAsyncNudge } from '@/lib/scheduler'

// Vercel cron — runs every 5 min. Nudges attendees to submit async status for meetings starting soon.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const testMode = req.nextUrl.searchParams.get('test') === 'true'
  const result = await runAsyncNudge(testMode)
  return NextResponse.json({ ok: true, ...result })
}
