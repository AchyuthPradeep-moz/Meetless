import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'

// Smart root redirect:
//   no session           → /login
//   session + no Slack   → /onboarding  (first-timer or Slack disconnected)
//   session + Slack      → /dashboard
export default async function RootPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    redirect('/login')
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('slack_user_id')
    .eq('email', session.user.email)
    .single()

  if (user?.slack_user_id) {
    redirect('/dashboard')
  } else {
    redirect('/onboarding')
  }
}
