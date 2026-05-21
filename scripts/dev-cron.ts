/**
 * Local development cron simulator.
 * Mirrors the Vercel cron schedule while `npm run dev` is running.
 *
 * Every minute:  /api/cron/reminder, /api/cron/nudge, /api/cron/board-link
 * Per-user IST:  /api/cron/digest when current IST HH:MM matches any user's digest_time
 */

import { createClient } from '@supabase/supabase-js'
import * as path from 'path'

// Load .env.local so Supabase credentials are available outside Next.js (Node 20.6+)
try {
  ;(process as any).loadEnvFile(path.resolve(__dirname, '../.env.local'))
} catch {
  // file missing or Node < 20.6 — env vars must be set another way
}

const BASE = 'http://localhost:3000'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function call(endpoint: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}${endpoint}`)
    const json = await res.json()
    console.log(`[cron] ${endpoint} →`, json)
  } catch (err: any) {
    console.error(`[cron] ${endpoint} failed:`, err.message)
  }
}

// Current IST time as "HH:MM"
function istHHMM(): string {
  const s = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
  return s.slice(0, 5) // "HH:MM"
}

// Current IST date as "YYYY-MM-DD"
function istDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

async function checkDigests(): Promise<void> {
  const currentHHMM = istHHMM()
  const today = istDate()

  const { data: users } = await supabase
    .from('users')
    .select('id, email, digest_time, last_digest_sent')
    .not('slack_user_id', 'is', null)
    .not('refresh_token', 'is', null)

  if (!users?.length) return

  const due = users.filter(
    (u) => (u.digest_time ?? '09:00') === currentHHMM && u.last_digest_sent !== today
  )

  if (!due.length) return

  console.log(`[cron] ${currentHHMM} IST — ${due.map((u) => u.email).join(', ')} digest due`)
  // One call sends to all users whose digest_time matches current server UTC time.
  // The server-side runDailyDigest also guards last_digest_sent, so duplicates are safe.
  await call('/api/cron/digest')
  // Focus suggestion fires alongside digest — same audience, same moment
  await call('/api/cron/focus-suggest')
}

async function runMinutely(): Promise<void> {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  console.log(`[cron] ${time} IST — running minute checks`)
  await call('/api/cron/reminder')

  // Only call nudge if there are async meetings starting in ~30 min that haven't been nudged
  const now = new Date()
  const in29 = new Date(now.getTime() + 29 * 60 * 1000)
  const in31 = new Date(now.getTime() + 31 * 60 * 1000)
  const { data: nudgeMeetings } = await supabase
    .from('meetings')
    .select('id')
    .eq('classification', 'async')
    .eq('nudge_sent', false)
    .gte('start_time', in29.toISOString())
    .lte('start_time', in31.toISOString())
  console.log(`[cron] Checking nudge — async meetings in 30 min: ${nudgeMeetings?.length ?? 0}`)
  if (nudgeMeetings?.length) await call('/api/cron/nudge')

  // Board-link: only fire after start_time so the submission count is final.
  // Backward window (now−10min → now) catches delayed cron ticks without a forward gap
  // that would send the message before members have had a chance to submit.
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000)
  const { data: boardMeetings } = await supabase
    .from('meetings')
    .select('id')
    .eq('classification', 'async')
    .eq('board_link_sent', false)
    .gte('start_time', tenMinAgo.toISOString())
    .lte('start_time', now.toISOString())
  console.log(`[cron] Board-link check — meetings starting now:`, boardMeetings?.length ?? 0)
  if (boardMeetings?.length) await call('/api/cron/board-link')

  await call('/api/cron/transcripts')
  await checkDigests()
}

// Wait for Next.js to be ready before firing the first check
async function waitForServer(retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(`${BASE}/api/health`).catch(() => fetch(`${BASE}`))
      console.log('[cron] Next.js is ready — starting cron simulator')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  console.log('[cron] Next.js not responding after 60s — starting anyway')
}

async function main(): Promise<void> {
  await waitForServer()

  // Run immediately on startup, then every 60 seconds
  await runMinutely()
  setInterval(runMinutely, 60_000)
}

main()
