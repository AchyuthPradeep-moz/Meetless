import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

// GET — returns outcome counts and time saved for the current user this calendar month.
// Both cancelled and async outcomes count as saved time.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  const { data: rows } = await supabaseAdmin
    .from('meetings')
    .select('outcome, duration')
    .eq('user_id', user.id)
    .not('outcome', 'is', null)
    .gte('start_time', monthStart)
    .lt('start_time', monthEnd)

  const all = rows ?? []

  const savedMeetings = all.filter((m) => m.outcome === 'cancelled' || m.outcome === 'async')
  const cancelled = savedMeetings.filter((m) => m.outcome === 'cancelled').length
  const wentAsync = savedMeetings.filter((m) => m.outcome === 'async').length
  const happened = all.filter((m) => m.outcome === 'happened').length

  const totalMinutesSaved = savedMeetings.reduce((sum, m) => sum + (m.duration ?? 0), 0)
  const hoursSaved = (totalMinutesSaved / 60).toFixed(1)
  const meetingsSaved = savedMeetings.length

  return NextResponse.json({
    meetings_saved: meetingsSaved,
    hours_saved: hoursSaved,
    cancelled,
    went_async: wentAsync,
    happened,
  })
}
