import { Users, RepeatIcon } from 'lucide-react'
import type { Meeting, Classification } from '@/types/meeting'
import OverrideButton from './OverrideButton'

const accentColors: Record<Classification, string> = {
  important: 'bg-green-500',
  async: 'bg-purple-500',
  passive: 'bg-blue-500',
}

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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function endTime(iso: string, durationMins: number) {
  return new Date(new Date(iso).getTime() + durationMins * 60000).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

interface Props {
  meeting: Meeting
  onOverride?: (meetingId: string, cls: Classification) => void
}

export default function MeetingCard({ meeting, onOverride }: Props) {
  const cls = meeting.classification
  if (!cls) return null

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5 hover:shadow-sm transition-shadow cursor-pointer">
      <div className="flex gap-4">
        <div className={`w-1 rounded-full flex-shrink-0 ${accentColors[cls]}`} />
        <div className="flex-1 min-w-0">
          <div className="mb-3">
            <div className="text-gray-900 dark:text-white mb-1 truncate">{meeting.title}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {formatTime(meeting.start_time)} – {endTime(meeting.start_time, meeting.duration)}
              <span className="ml-2 text-gray-400 dark:text-gray-500">({meeting.duration} min)</span>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <Users className="w-3.5 h-3.5" />
              {meeting.attendee_count}
            </span>
            {meeting.is_recurring && (
              <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <RepeatIcon className="w-3.5 h-3.5" />
                Recurring
              </span>
            )}
            {meeting.is_organiser && (
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs rounded">
                Organizer
              </span>
            )}
          </div>

          {meeting.reason && (
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{meeting.reason}</p>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs border ${badgeColors[cls]}`}>
                {badgeLabels[cls]}
              </span>
              {meeting.confidence != null && (
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${confidenceColor(meeting.confidence)}`}
                      style={{ width: `${meeting.confidence}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">{meeting.confidence}%</span>
                </div>
              )}
            </div>
            <OverrideButton meetingId={meeting.id} current={cls} onOverride={onOverride ? (c) => onOverride(meeting.id, c) : undefined} />
          </div>
        </div>
      </div>
    </div>
  )
}
