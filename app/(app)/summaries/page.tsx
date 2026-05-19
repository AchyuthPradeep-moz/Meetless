import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import SummariesClient from './SummariesClient'

export default async function SummariesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  const { data: summaries } = await supabaseAdmin
    .from('summaries')
    .select('id, meeting_id, summary, action_items, transcript_text, created_at, meetings(title, start_time, duration)')
    .eq('user_id', user?.id)
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl text-gray-900 mb-6">Meeting summaries</h1>
        <SummariesClient summaries={(summaries ?? []) as any} />
      </div>
    </div>
  )
}
