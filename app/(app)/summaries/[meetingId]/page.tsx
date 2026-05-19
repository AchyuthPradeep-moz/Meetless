import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import SummaryDetailClient from './SummaryDetailClient'

interface Props {
  params: Promise<{ meetingId: string }>
}

function parseSummary(raw: string | null): { keyPoints: string[]; actionItems: string[]; decisions?: string[]; summary?: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.keyPoints) && Array.isArray(parsed.actionItems)) return parsed
    return null
  } catch {
    return null
  }
}

export default async function SummaryDetailPage({ params }: Props) {
  const { meetingId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  if (!user) notFound()

  const [{ data: summaryRow }, { data: meeting }] = await Promise.all([
    supabaseAdmin
      .from('summaries')
      .select('summary, transcript_text')
      .eq('meeting_id', meetingId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('meetings')
      .select('title, start_time, duration')
      .eq('id', meetingId)
      .single(),
  ])

  if (!summaryRow || !meeting) notFound()

  const parsed = parseSummary(summaryRow.summary)
  const start = new Date(meeting.start_time)
  const dateStr = start.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  })
  const timeStr = start.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/summaries"
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to summaries
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl text-gray-900 mb-1">{meeting.title}</h1>
          <p className="text-sm text-gray-500">
            {dateStr} at {timeStr} · {meeting.duration} min
          </p>
        </div>

        <SummaryDetailClient
          keyPoints={parsed?.keyPoints ?? []}
          actionItems={parsed?.actionItems ?? []}
          decisions={parsed?.decisions ?? []}
          summaryText={parsed?.summary ?? null}
          transcript={summaryRow.transcript_text ?? ''}
          legacySummary={parsed ? null : summaryRow.summary}
          meetingTitle={meeting.title}
        />
      </div>
    </div>
  )
}
