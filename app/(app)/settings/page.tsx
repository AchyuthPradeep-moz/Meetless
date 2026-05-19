import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('slack_user_id, digest_time, access_token')
    .eq('email', session.user.email)
    .single()

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl text-gray-900 mb-8">Settings</h1>
        <SettingsClient
          googleConnected={!!user?.access_token}
          slackConnected={!!user?.slack_user_id}
          initialDigestTime={user?.digest_time ?? '09:00'}
          initialReminderMins={10}
        />
      </div>
    </div>
  )
}
