import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Users, Calendar, Video } from 'lucide-react'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import OverrideButton from '@/components/meetings/OverrideButton'
import DraftMessage from '@/components/meetings/DraftMessage'
import type { Meeting, Classification } from '@/types/meeting'

const badgeColors: Record<Classification, string> = {
  important: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  async: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800',
  passive: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
}

const badgeLabels: Record<Classification, string> = {
  important: 'Important',
  async: 'Async candidate',
  passive: 'Passive',
}

function confidenceColor(c: number) {
  if (c >= 70) return 'bg-green-500'
  if (c >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function MeetingDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('*')
    .eq('id', id)
    .single<Meeting>()

  if (!meeting) notFound()

  const start = new Date(meeting.start_time)
  const end = new Date(start.getTime() + meeting.duration * 60000)
  const cls = meeting.classification

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8">
          <h1 className="text-2xl text-gray-900 dark:text-white mb-6">{meeting.title}</h1>

          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="text-sm text-gray-600 dark:text-gray-300 mb-3">Meeting details</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                  <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span>
                    {start.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                  <span className="text-gray-500 dark:text-gray-400">Time:</span>
                  <span>
                    {fmtTime(meeting.start_time)} – {fmtTime(end.toISOString())}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300">({meeting.duration} min)</span>
                </div>
                <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                  <span className="text-gray-500 dark:text-gray-400">Attendees:</span>
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    {meeting.attendee_count}
                  </span>
                </div>
                {meeting.is_organiser && (
                  <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                    <span className="text-gray-500 dark:text-gray-400">Role:</span>
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs rounded">
                      Organizer
                    </span>
                  </div>
                )}
                {meeting.meet_link && (
                  <div className="flex items-center gap-3">
                    <Video className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <a
                      href={meeting.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Join Google Meet
                    </a>
                  </div>
                )}
              </div>
            </div>

            {meeting.description && (
              <div>
                <h3 className="text-sm text-gray-600 dark:text-gray-300 mb-3">Description</h3>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{meeting.description}</p>
              </div>
            )}
          </div>

          {cls && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mb-6">
              <h3 className="text-sm text-gray-600 dark:text-gray-300 mb-4">AI Classification</h3>
              <div className="flex items-center gap-4 mb-4">
                <span className={`px-4 py-2 rounded-full text-sm border ${badgeColors[cls]}`}>
                  {badgeLabels[cls]}
                </span>
                {meeting.confidence != null && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Confidence:</span>
                    <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${confidenceColor(meeting.confidence)}`}
                        style={{ width: `${meeting.confidence}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-900 dark:text-white">{meeting.confidence}%</span>
                  </div>
                )}
              </div>
              {meeting.reason && (
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{meeting.reason}</p>
              )}
              <OverrideButton meetingId={meeting.id} current={cls} />
            </div>
          )}

          {cls === 'async' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mb-6">
              <Link
                href={`/async/${meeting.id}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Users className="w-4 h-4" />
                View async status board
              </Link>
            </div>
          )}

          {(cls === 'async' || cls === 'passive') && !meeting.is_organiser && (
            <DraftMessage
              meetingId={meeting.id}
              classification={cls}
              initialDraft={meeting.draft_message ?? null}
              initialDraftSent={meeting.draft_sent ?? false}
              organiserEmail={meeting.organiser_email ?? null}
            />
          )}

          {cls === 'passive' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-sm text-gray-600 dark:text-gray-300 mb-3">Meeting Summary</h3>
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  When the host records this meeting, a summary will be automatically generated and
                  delivered to you via Slack. You can also view it on your{' '}
                  <a href="/summaries" className="underline hover:text-blue-900 dark:hover:text-blue-200">summaries page</a>{' '}
                  after the meeting ends.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
