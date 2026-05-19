'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, CheckCircle, AlertCircle, Loader2, RefreshCw, Bell } from 'lucide-react'
import type { Meeting } from '@/types/meeting'

interface Update {
  id: string
  user_id: string
  user_email: string | null
  completed: string | null
  plan: string | null
  blockers: string | null
  status_tag: string | null
  submitted_at: string
}

interface AttendeeInfo {
  email: string
  submitted: boolean
  isMeetlessUser: boolean
  userId: string | null
}

interface Props {
  meeting: Meeting
  currentUserEmail: string
  organiserEmail: string | null
  initialUpdates: Update[]
  initialHasSubmitted: boolean
  initialSummary: string | null
  meetingStarted: boolean
  isOrganiser: boolean
}

const STATUS_OPTIONS = [
  { value: 'done', label: 'Done', selected: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'in-progress', label: 'In Progress', selected: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'blocked', label: 'Blocked', selected: 'bg-red-50 text-red-700 border-red-200' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  done: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'Done' },
  'in-progress': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'In Progress' },
  blocked: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Blocked' },
}

function getInitials(email: string): string {
  const name = email.split('@')[0]
  const parts = name.split(/[._-]/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function getDisplayName(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function StatusUpdateCard({ update, isCurrentUser = false }: { update: Update; isCurrentUser?: boolean }) {
  const email = update.user_email ?? 'unknown'
  const colors = update.status_tag ? STATUS_COLORS[update.status_tag] : null
  return (
    <div className={`border rounded-lg p-5 ${isCurrentUser ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
          <span className="text-xs text-gray-600">{getInitials(email)}</span>
        </div>
        <div>
          <div className="text-sm text-gray-900">
            {getDisplayName(email)}
            {isCurrentUser && <span className="text-gray-400 ml-1 text-xs">(you)</span>}
          </div>
          {colors && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs border ${colors.bg} ${colors.text} ${colors.border}`}>
              {colors.label}
            </span>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {update.completed && (
          <div>
            <div className="text-xs text-gray-500 mb-1">Completed</div>
            <div className="text-sm text-gray-800">{update.completed}</div>
          </div>
        )}
        {update.plan && (
          <div>
            <div className="text-xs text-gray-500 mb-1">Today&apos;s plan</div>
            <div className="text-sm text-gray-800">{update.plan}</div>
          </div>
        )}
        {update.blockers && (
          <div>
            <div className="text-xs text-red-500 mb-1">Blockers</div>
            <div className="text-sm text-gray-800">{update.blockers}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function PendingCard({
  email,
  userId,
  meetingId,
}: {
  email: string
  userId: string | null
  meetingId: string
}) {
  const [nudging, setNudging] = useState(false)
  const [nudged, setNudged] = useState(false)

  const sendNudge = async () => {
    if (!userId) return
    setNudging(true)
    try {
      await fetch(`/api/async/nudge/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId }),
      })
      setNudged(true)
    } finally {
      setNudging(false)
    }
  }

  return (
    <div className="border-2 border-dashed border-gray-200 rounded-lg p-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center opacity-50">
          <span className="text-xs text-gray-500">{getInitials(email)}</span>
        </div>
        <div>
          <div className="text-sm text-gray-600">{getDisplayName(email)}</div>
          <div className="text-xs text-gray-400">Waiting for update…</div>
        </div>
      </div>
      {userId && (
        <button
          onClick={sendNudge}
          disabled={nudging || nudged}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          <Bell className="w-3.5 h-3.5" />
          {nudged ? 'Nudged!' : nudging ? '…' : 'Nudge'}
        </button>
      )}
    </div>
  )
}

export default function AsyncBoardClient({
  meeting,
  currentUserEmail,
  organiserEmail,
  initialUpdates,
  initialHasSubmitted,
  initialSummary,
  meetingStarted,
  isOrganiser,
}: Props) {
  const [hasSubmitted, setHasSubmitted] = useState(initialHasSubmitted)
  const [showLateForm, setShowLateForm] = useState(false)
  const [updates, setUpdates] = useState<Update[]>(initialUpdates)
  const [attendees, setAttendees] = useState<AttendeeInfo[]>([])
  const [submittedCount, setSubmittedCount] = useState(initialUpdates.length)
  const [totalCount, setTotalCount] = useState(meeting.attendee_count)
  const [timeLeft, setTimeLeft] = useState('')
  const [form, setForm] = useState({ completed: '', plan: '', blockers: '', status_tag: 'in-progress' })
  const [submitting, setSubmitting] = useState(false)
  const [summary, setSummary] = useState<string | null>(initialSummary)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Countdown timer
  useEffect(() => {
    const tick = () => {
      const diff = new Date(meeting.start_time).getTime() - Date.now()
      if (diff <= 0) { setTimeLeft('Meeting started'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTimeLeft(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [meeting.start_time])

  // Fetches live board data; returns submitted count for callers
  const fetchBoard = useCallback(async (): Promise<number> => {
    const res = await fetch(`/api/async/status?meeting_id=${meeting.id}`)
    if (!res.ok) return 0
    const data = await res.json()
    setUpdates(data.updates ?? [])
    setSubmittedCount(data.submitted_count ?? 0)
    setTotalCount(data.total_count ?? meeting.attendee_count)
    setAttendees(data.attendees ?? [])
    if (data.summary) setSummary(data.summary)
    return data.submitted_count ?? 0
  }, [meeting.id, meeting.attendee_count])

  // Calls Claude to generate/regenerate the summary
  const generateSummary = useCallback(async () => {
    setGeneratingSummary(true)
    try {
      const res = await fetch('/api/async/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meeting.id }),
      })
      const data = await res.json()
      if (data.summary) setSummary(data.summary)
    } catch {
      // silent — user can retry via Regenerate button
    } finally {
      setGeneratingSummary(false)
    }
  }, [meeting.id])

  // On mount if already submitted: load dashboard + auto-summarise if needed
  useEffect(() => {
    if (!initialHasSubmitted) return
    fetchBoard().then((count) => {
      if (count >= 1 && !initialSummary) generateSummary()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh board every 30 seconds when in dashboard state
  useEffect(() => {
    if (!initialHasSubmitted && !meetingStarted && !isOrganiser) return
    const id = setInterval(fetchBoard, 30_000)
    return () => clearInterval(id)
  }, [fetchBoard, initialHasSubmitted, meetingStarted, isOrganiser])

  const handleSubmit = async () => {
    if (!form.completed.trim() || !form.plan.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/async/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meeting.id, ...form }),
      })
      if (res.ok) {
        setHasSubmitted(true)
        setShowLateForm(false)
        const count = await fetchBoard()
        if (count >= 1 && !summary) generateSummary()
      }
    } finally {
      setSubmitting(false)
    }
  }

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

  // ── STATE 1: Not submitted, meeting hasn't started, and not the organiser ─
  if (!hasSubmitted && !meetingStarted && !isOrganiser) {
    return (
      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <Link href="/dashboard" className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Link>

          <div className="mb-6">
            <h1 className="text-2xl text-gray-900 mb-1">{meeting.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm text-gray-500">{dateStr} at {timeStr}</span>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-lg text-sm border border-purple-200">
                <Clock className="w-3.5 h-3.5" />
                <span className="tabular-nums">{timeLeft}</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
            <h2 className="text-gray-900">Add your status update</h2>

            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                What did you complete since last meeting?
              </label>
              <textarea
                value={form.completed}
                onChange={(e) => setForm({ ...form, completed: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                placeholder="Completed tasks, shipped features, resolved issues…"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                What will you work on today?
              </label>
              <textarea
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                placeholder="Goals and tasks for today…"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                Any blockers?{' '}
                <span className="text-gray-400">(leave empty if none)</span>
              </label>
              <textarea
                value={form.blockers}
                onChange={(e) => setForm({ ...form, blockers: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                placeholder="Anything blocking your progress…"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-2">Status</label>
              <div className="flex gap-2">
                {STATUS_OPTIONS.map(({ value, label, selected }) => (
                  <button
                    key={value}
                    onClick={() => setForm({ ...form, status_tag: value })}
                    className={`px-4 py-2 rounded-lg text-sm border transition-all ${
                      form.status_tag === value
                        ? selected
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !form.completed.trim() || !form.plan.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Submitting…' : 'Submit update'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await fetchBoard() } finally { setRefreshing(false) }
  }

  // ── STATE 2: Dashboard (submitted, organiser, or meeting already started) ─
  const currentUserUpdate = updates.find((u) => u.user_email === currentUserEmail)
  const otherUpdates = updates.filter((u) => u.user_email !== currentUserEmail)
  // Exclude current user and organiser from pending list — organiser never submits
  const pendingAttendees = attendees.filter(
    (a) =>
      a.isMeetlessUser &&
      !a.submitted &&
      a.email !== currentUserEmail &&
      a.email.toLowerCase() !== (organiserEmail ?? '').toLowerCase()
  )
  const blockerCount = updates.filter((u) => u.status_tag === 'blocked').length

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        {/* Meeting header */}
        <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl text-gray-900 mb-1">{meeting.title}</h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-sm text-gray-500">{dateStr} at {timeStr}</p>
                {isOrganiser && (
                  <span className="px-2 py-0.5 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded">
                    You are the organiser
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm border border-purple-200">
                <Clock className="w-4 h-4" />
                <span className="tabular-nums">{timeLeft}</span>
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm text-gray-600">
                <span className="text-gray-900">{submittedCount} of {totalCount}</span> members submitted
              </span>
            </div>
            {blockerCount > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <span className="text-sm text-gray-600">
                  <span className="text-gray-900">{blockerCount}</span>{' '}
                  {blockerCount === 1 ? 'blocker' : 'blockers'} flagged
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Late-submit prompt — shown when meeting has started but attendee hasn't submitted */}
        {!isOrganiser && !hasSubmitted && !showLateForm && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-center justify-between">
            <p className="text-sm text-amber-800">
              The meeting has started. You can still add your update.
            </p>
            <button
              onClick={() => setShowLateForm(true)}
              className="ml-4 px-4 py-1.5 text-sm bg-amber-800 text-white rounded-lg hover:bg-amber-900 transition-colors flex-shrink-0"
            >
              Add my update →
            </button>
          </div>
        )}

        {/* Inline late-submit form */}
        {!hasSubmitted && showLateForm && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm text-gray-500">Add your update</h2>
              <button
                onClick={() => setShowLateForm(false)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                What did you complete since last meeting?
              </label>
              <textarea
                value={form.completed}
                onChange={(e) => setForm({ ...form, completed: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                placeholder="Completed tasks…"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                What will you work on today?
              </label>
              <textarea
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                placeholder="Today's goals…"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                Any blockers?{' '}
                <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={form.blockers}
                onChange={(e) => setForm({ ...form, blockers: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                placeholder="Anything blocking your progress…"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                {STATUS_OPTIONS.map(({ value, label, selected }) => (
                  <button
                    key={value}
                    onClick={() => setForm({ ...form, status_tag: value })}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                      form.status_tag === value
                        ? selected
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || !form.completed.trim() || !form.plan.trim()}
                className="ml-auto flex items-center gap-2 px-5 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Submitting…' : 'Submit update'}
              </button>
            </div>
          </div>
        )}

        {/* My update */}
        {currentUserUpdate && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
            <h2 className="text-sm text-gray-500 mb-4">My update</h2>
            <StatusUpdateCard update={currentUserUpdate} isCurrentUser />
          </div>
        )}

        {/* Team updates + pending members */}
        {(otherUpdates.length > 0 || pendingAttendees.length > 0) && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
            <h2 className="text-sm text-gray-500 mb-4">Team updates</h2>
            <div className="grid grid-cols-2 gap-4">
              {otherUpdates.map((update) => (
                <StatusUpdateCard key={update.id} update={update} />
              ))}
              {pendingAttendees.map((attendee) => (
                <PendingCard
                  key={attendee.email}
                  email={attendee.email}
                  userId={attendee.userId}
                  meetingId={meeting.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI Summary — Issues 5 */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span>✨</span>
              <h2 className="text-sm text-gray-500">AI summary</h2>
            </div>
            {summary && (
              <button
                onClick={generateSummary}
                disabled={generatingSummary}
                className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generatingSummary ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
          </div>
          {generatingSummary ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating summary…
            </div>
          ) : summary ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 leading-relaxed">
              {summary}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">
              {submittedCount === 0
                ? 'Summary will appear once someone submits.'
                : 'Generating summary…'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
