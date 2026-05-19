import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { generateAsyncSummary } from '@/lib/claude'

// POST — generates a Claude summary of all status updates and saves it to the meeting
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id } = await req.json()

  const { data: updates } = await supabaseAdmin
    .from('status_updates')
    .select('completed, plan, blockers, status_tag, users(email)')
    .eq('meeting_id', meeting_id)

  if (!updates?.length) {
    return NextResponse.json({ error: 'No updates to summarise' }, { status: 400 })
  }

  const formatted = updates.map((u) => ({
    email: (u.users as any)?.email ?? 'unknown',
    completed: u.completed,
    plan: u.plan,
    blockers: u.blockers,
    status_tag: u.status_tag,
  }))

  const summary = await generateAsyncSummary(formatted)

  await supabaseAdmin
    .from('meetings')
    .update({ async_summary: summary })
    .eq('id', meeting_id)

  return NextResponse.json({ summary })
}
