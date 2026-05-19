import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { generateMeetingSummary } from '@/lib/claude'

// POST — generates a structured Claude summary for a meeting transcript and stores it
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id, transcript } = await req.json()

  const [{ data: user }, { data: meeting }] = await Promise.all([
    supabaseAdmin.from('users').select('id').eq('email', session.user.email).single(),
    supabaseAdmin.from('meetings').select('title').eq('id', meeting_id).single(),
  ])

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { keyPoints, actionItems } = await generateMeetingSummary(
    transcript,
    meeting?.title ?? 'Meeting'
  )

  await supabaseAdmin.from('summaries').insert({
    meeting_id,
    user_id: user.id,
    transcript_text: transcript,
    summary: JSON.stringify({ keyPoints, actionItems }),
    action_items: null,
  })

  return NextResponse.json({ keyPoints, actionItems })
}
