'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, Users, Calendar, Clock, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react'
import MeetingCard from '@/components/meetings/MeetingCard'
import ThemeToggle from '@/components/layout/ThemeToggle'
import type { Meeting, Classification } from '@/types/meeting'

interface OutcomeStats {
  meetings_saved: number
  hours_saved: string
  cancelled: number
  went_async: number
  happened: number
}

type Filter = Classification | 'all'

function getMonday(d: Date): Date {
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  mon.setHours(0, 0, 0, 0)
  return mon
}

function getWeekBounds(offset: number): { start: Date; end: Date; label: string } {
  const now = new Date()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7)
  mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon.getTime() + 7 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const year = offset !== 0 ? ` ${mon.getFullYear()}` : ''
  return { start: mon, end: sun, label: `${fmt(mon)} – ${fmt(new Date(sun.getTime() - 1))}${year}` }
}

function groupByDay(meetings: Meeting[]) {
  const groups: Record<string, Meeting[]> = {}
  for (const m of meetings) {
    const label = new Date(m.start_time).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Asia/Kolkata',
    })
    if (!groups[label]) groups[label] = []
    groups[label].push(m)
  }
  return groups
}

interface Props {
  slackConnected: boolean
}

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

const filterConfig: { value: Filter; label: string; active: string }[] = [
  { value: 'all', label: 'All meetings', active: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' },
  { value: 'important', label: 'Important', active: 'bg-green-600 text-white' },
  { value: 'async', label: 'Async candidate', active: 'bg-purple-600 text-white' },
  { value: 'passive', label: 'Passive', active: 'bg-blue-600 text-white' },
]

export default function DashboardClient({ slackConnected }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [weekOffset, setWeekOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeStats | null>(null)

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Meeting[] = await res.json()
      setMeetings(data)
      setError(null)
    } catch (err) {
      console.error('Failed to load meetings:', err)
      setError('Could not load meetings. Try re-syncing your calendar.')
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/user/status')
        const status = await res.json()
        setGoogleConnected(status.googleConnected)
        if (status.googleConnected) {
          await fetchMeetings()
        }
        fetch('/api/meetings/outcomes')
          .then((r) => r.json())
          .then((data) => { if (!data.error) setOutcomes(data) })
          .catch(() => {})
      } catch {
        setGoogleConnected(false)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [fetchMeetings])

  const handleOverride = (meetingId: string, cls: Classification) => {
    setMeetings((prev) =>
      prev.map((m) =>
        m.id === meetingId
          ? { ...m, classification: cls, confidence: confidenceMap[cls], reason: reasonMap[cls] }
          : m
      )
    )
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetchMeetings()
    } finally {
      setSyncing(false)
    }
  }

  const week = getWeekBounds(weekOffset)
  const now = new Date()

  const weekMeetings = meetings.filter((m) => {
    const end = m.end_time
      ? new Date(m.end_time)
      : new Date(new Date(m.start_time).getTime() + m.duration * 60 * 1000)
    const start = new Date(m.start_time)
    return end > now && start >= week.start && start < week.end
  })

  const asyncCount = weekMeetings.filter((m) => m.classification === 'async').length
  const passiveCount = weekMeetings.filter((m) => m.classification === 'passive').length
  const totalCount = weekMeetings.length

  const filtered =
    filter === 'all' ? weekMeetings : weekMeetings.filter((m) => m.classification === filter)
  const grouped = groupByDay(filtered)

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl text-gray-900 dark:text-white mb-1">Your meetings</h2>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setWeekOffset((o) => o - 1)}
                disabled={week.start <= getMonday(new Date())}
                className={`p-1 rounded transition-colors ${week.start <= getMonday(new Date()) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'}`}
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>
              <span className="text-gray-600 dark:text-gray-300 text-sm">{week.label}</span>
              <button
                onClick={() => setWeekOffset((o) => o + 1)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>
              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="ml-1 text-xs text-blue-600 hover:underline"
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {slackConnected && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm border border-green-200 dark:border-green-800">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                Slack connected
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || loading}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              Re-sync calendar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <span className="text-gray-600 dark:text-gray-300">Total meetings</span>
            </div>
            <div className="text-3xl text-gray-900 dark:text-white">{totalCount}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-purple-600" />
              <span className="text-gray-600 dark:text-gray-300">Async candidates</span>
            </div>
            <div className="text-3xl text-gray-900 dark:text-white">{asyncCount}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-blue-600" />
              <span className="text-gray-600 dark:text-gray-300">Passive attendance</span>
            </div>
            <div className="text-3xl text-gray-900 dark:text-white">{passiveCount}</div>
          </div>
        </div>

        {outcomes && (outcomes.meetings_saved > 0 || outcomes.happened > 0) && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="text-sm text-gray-600 dark:text-gray-300">This month</span>
            </div>
            <div className="flex items-center gap-6">
              {outcomes.meetings_saved > 0 && (
                <div>
                  <span className="text-lg text-gray-900 dark:text-white">{outcomes.meetings_saved} meeting{outcomes.meetings_saved === 1 ? '' : 's'} saved</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                    ({[
                      outcomes.cancelled > 0 ? `${outcomes.cancelled} cancelled` : '',
                      outcomes.went_async > 0 ? `${outcomes.went_async} went async` : '',
                    ].filter(Boolean).join(' + ')})
                  </span>
                </div>
              )}
              {parseFloat(outcomes.hours_saved) > 0 && (
                <div className="flex items-center gap-2 ml-auto px-3 py-1 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">{outcomes.hours_saved}h recovered</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-6">
          {filterConfig.map(({ value, label, active }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                filter === value
                  ? active
                  : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-sm">Syncing your calendar…</span>
            </div>
          </div>
        ) : googleConnected === false ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-600 dark:text-gray-300 mb-3">Connect your Google Calendar to get started</p>
            <Link href="/settings" className="text-sm text-blue-600 hover:underline">
              Go to Settings →
            </Link>
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-red-500 mb-3">{error}</p>
            <button
              onClick={handleSync}
              className="text-sm text-gray-600 dark:text-gray-400 underline hover:text-gray-900 dark:hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-4">No meetings this week.</p>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([day, dayMeetings]) => (
              <div key={day}>
                <h3 className="text-sm text-gray-500 dark:text-gray-400 mb-3">{day}</h3>
                <div className="space-y-3">
                  {dayMeetings.map((meeting) => (
                    <div key={meeting.id}>
                      <Link href={`/meetings/${meeting.id}`}>
                        <MeetingCard meeting={meeting} onOverride={handleOverride} />
                      </Link>
                      {meeting.classification === 'async' && (
                        <Link
                          href={`/async/${meeting.id}`}
                          className="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors w-fit"
                        >
                          View Status Board →
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
