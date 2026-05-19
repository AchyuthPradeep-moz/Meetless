import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { digest_time, reminder_minutes } = body

  if (digest_time !== undefined && !/^\d{2}:\d{2}$/.test(digest_time)) {
    return NextResponse.json({ error: 'Invalid digest_time' }, { status: 400 })
  }
  if (reminder_minutes !== undefined && (typeof reminder_minutes !== 'number' || ![5, 10, 15, 30].includes(reminder_minutes))) {
    return NextResponse.json({ error: 'Invalid reminder_minutes' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (digest_time !== undefined) updates.digest_time = digest_time
  if (reminder_minutes !== undefined) updates.reminder_minutes = reminder_minutes

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('email', session.user.email)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
