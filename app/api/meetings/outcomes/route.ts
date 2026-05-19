import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

// GET — returns outcome counts and time-saved estimate for the current user this calendar month.
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

  const { data: meetings } = await supabaseAdmin
    .from('meetings')
    .select('outcome, duration')
    .eq('user_id', user.id)
    .not('outcome', 'is', null)
    .gte('start_time', monthStart)
    .lt('start_time', monthEnd)

  const rows = meetings ?? []
  const cancelled = rows.filter((m) => m.outcome === 'cancelled')
  const asyncCount = rows.filter((m) => m.outcome === 'async').length
  const happened = rows.filter((m) => m.outcome === 'happened').length

  const minutesSaved = cancelled.reduce((sum, m) => sum + (m.duration ?? 0), 0)
  const hoursSaved = Math.round((minutesSaved / 60) * 10) / 10

  return NextResponse.json({
    cancelled: cancelled.length,
    async: asyncCount,
    happened,
    hours_saved: hoursSaved,
  })
}
