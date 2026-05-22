import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { meeting_id } = await req.json()
  if (!meeting_id) {
    return NextResponse.json({ error: 'meeting_id is required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('meetings')
    .update({ draft_message: null, draft_sent: false })
    .eq('id', meeting_id)

  if (error) {
    console.error('Failed to discard draft:', error)
    return NextResponse.json({ error: 'Failed to discard draft' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
