import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ googleConnected: false, slackConnected: false, hasRefreshToken: false })
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('access_token, refresh_token, slack_user_id')
    .eq('email', session.user.email)
    .single()

  return NextResponse.json({
    googleConnected: !!user?.access_token,
    slackConnected: !!user?.slack_user_id,
    hasRefreshToken: !!user?.refresh_token,
  })
}
