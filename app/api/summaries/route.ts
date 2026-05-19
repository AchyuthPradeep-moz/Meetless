import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

// GET — returns all summaries for the authenticated user
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  const { data: summaries } = await supabaseAdmin
    .from('summaries')
    .select('*, meetings(title, start_time)')
    .eq('user_id', user?.id)
    .order('created_at', { ascending: false })

  return NextResponse.json(summaries)
}
