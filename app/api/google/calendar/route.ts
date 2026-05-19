import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchUpcomingMeetings } from '@/lib/google'
import type { User } from '@/types/user'

// GET — fetches raw upcoming meetings from Google Calendar (no classification)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', session.user.email)
    .single<User>()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const meetings = await fetchUpcomingMeetings(user)
  return NextResponse.json(meetings)
}
