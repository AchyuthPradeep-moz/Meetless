import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  let slackConnected = false

  if (session?.user?.email) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('slack_user_id')
      .eq('email', session.user.email)
      .single()
    slackConnected = !!user?.slack_user_id
  }

  return <DashboardClient slackConnected={slackConnected} />
}
