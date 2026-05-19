import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

// Handles Slack OAuth — initiates the flow (no code) or completes it (code present)
export async function GET(req: NextRequest) {
  console.log('Slack OAuth route hit')
  console.log('SLACK_CLIENT_ID:', process.env.SLACK_CLIENT_ID ? 'found' : 'MISSING')

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  if (!code) {
    const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize')
    slackAuthUrl.searchParams.set('client_id', process.env.SLACK_CLIENT_ID!)
    slackAuthUrl.searchParams.set('scope', 'chat:write,im:write,users:read,users:read.email')
    slackAuthUrl.searchParams.set('user_scope', 'identity.basic,identity.email')
    slackAuthUrl.searchParams.set('redirect_uri', `${process.env.NEXTAUTH_URL}/api/slack/oauth`)
    if (state) slackAuthUrl.searchParams.set('state', state)
    return Response.redirect(slackAuthUrl.toString())
  }

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL('/login', process.env.NEXTAUTH_URL))
  }

  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/slack/oauth`,
    }),
  })

  const data = await res.json()
  if (!data.ok) {
    console.log('Slack OAuth error:', data.error)
    return NextResponse.redirect(new URL('/settings?slack=error', process.env.NEXTAUTH_URL))
  }

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ slack_user_id: data.authed_user.id })
    .eq('email', session.user.email)

  if (updateError) {
    console.error('Failed to save slack_user_id:', updateError)
    return NextResponse.redirect(new URL('/settings?slack=error', process.env.NEXTAUTH_URL))
  }

  console.log('Slack OAuth success — state:', state)
  if (state === 'onboarding') {
    return NextResponse.redirect(new URL('/dashboard', process.env.NEXTAUTH_URL))
  }
  return NextResponse.redirect(new URL('/settings?slack=connected', process.env.NEXTAUTH_URL))
}
