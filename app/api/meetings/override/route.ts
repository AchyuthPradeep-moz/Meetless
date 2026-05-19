import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import type { Classification } from '@/types/meeting'

const confidenceMap: Record<Classification, number> = {
  important: 90,
  async: 25,
  passive: 10,
}

const reasonMap: Record<Classification, string> = {
  important: 'Manually marked as important by user',
  async: 'Manually marked as async candidate by user',
  passive: 'Manually marked as passive by user',
}

// POST — records a user's manual override of a meeting classification
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { meeting_id, new_classification } = (await req.json()) as {
    meeting_id: string
    new_classification: Classification
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('classification')
    .eq('id', meeting_id)
    .single()

  if (!meeting || !user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabaseAdmin.from('overrides').insert({
    meeting_id,
    user_id: user.id,
    original_classification: meeting.classification,
    new_classification,
  })

  await supabaseAdmin
    .from('meetings')
    .update({
      classification: new_classification,
      confidence: confidenceMap[new_classification],
      reason: reasonMap[new_classification],
    })
    .eq('id', meeting_id)

  return NextResponse.json({
    ok: true,
    classification: new_classification,
    confidence: confidenceMap[new_classification],
    reason: reasonMap[new_classification],
  })
}
