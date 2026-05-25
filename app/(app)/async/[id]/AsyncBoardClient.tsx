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
  { value: 'done', label: 'Done', selected: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
  { value: 'in-progress', label: 'In Progress', selected: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' },
  { value: 'blocked', label: 'Blocked', selected: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  done: { bg: 'bg-green-50 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800', label: 'Done' },
  'in-progress': { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', label: 'In Progress' },
  blocked: { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', label: 'Blocked' },
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
    <div className={`border rounded-lg p-5 ${isCurrentUser ? 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
          <span className="text-xs text-gray-600 dark:text-gray-300">{getInitials(email)}</span>
        </div>
        <div>
          <div className="text-sm text-gray-900 dark:text-white">
            {getDisplayName(email)}
            {isCurrentUser && <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">(you)</span>}
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
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Completed</div>
            <div className="text-sm text-gray-800 dark:text-gray-200">{update.completed}</div>
          </div>
        )}
        {update.plan && (
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Today&apos;s plan</div>
            <div className="text-sm text-gray-800 dark:text-gray-200">{update.plan}</div>
          </div>
        )}
        {update.blockers && (
          <div>
            <div className="text-xs text-red-500 dark:text-red-400 mb-1">Blockers</div>
            <div className="text-sm text-gray-800 dark:text-gray-200">{update.blockers}</div>
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
    <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center opacity-50">
          <span className="text-xs text-gray-500 dark:text-gray-400">{getInitials(email)}</span>
        </div>
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-300">{getDisplayName(email)}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">Waiting for update…</div>
        </div>
      </div>
      {userId && (
        <button
          onClick={sendNudge}
          disabled={nudging || nudged}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 flex-shrink-0"
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
      // silent
    } finally {
      setGeneratingSummary(false)
    }
  }, [meeting.id])

  useEffect(() => {
    if (!initialHasSubmitted && !isOrganiser) return
    fetchBoard().then((count) => {
      if (count >= 1 && !initialSummary) generateSummary()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata',
  })
  const timeStr = start.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })

  const textareaClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 resize-none'

  if (!hasSubmitted && !meetingStarted && !isOrganiser) {
    return (
      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <Link href="/dashboard" className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Link>

          <div className="mb-6">
            <h1 className="text-2xl text-gray-900 dark:text-white mb-1">{meeting.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">{dateStr} at {timeStr}</span>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-lg text-sm border border-purple-200 dark:border-purple-800">
                <Clock className="w-3.5 h-3.5" />
                <span className="tabular-nums">{timeLeft}</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-5">
            <h2 className="text-gray-900 dark:text-white">Add your status update</h2>

            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1.5">
                What did you complete since last meeting?
              </label>
              <textarea value={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.value })} rows={3} className={textareaClass} placeholder="Completed tasks, shipped features, resolved issues…" />
            </div>

            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1.5">
                What will you work on today?
              </label>
              <textarea value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} rows={3} className={textareaClass} placeholder="Goals and tasks for today…" />
            </div>

            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1.5">
                Any blockers? <span className="text-gray-400 dark:text-gray-500">(leave empty if none)</span>
              </label>
              <textarea value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} rows={2} className={textareaClass} placeholder="Anything blocking your progress…" />
            </div>

            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-2">Status</label>
              <div className="flex gap-2">
                {STATUS_OPTIONS.map(({ value, label, selected }) => (
                  <button key={value} onClick={() => setForm({ ...form, status_tag: value })}
                    className={`px-4 py-2 rounded-lg text-sm border transition-all ${form.status_tag === value ? selected : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleSubmit} disabled={submitting || !form.completed.trim() || !form.plan.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50">
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

  const currentUserUpdate = updates.find((u) => u.user_email === currentUserEmail)
  const otherUpdates = updates.filter((u) => u.user_email !== currentUserEmail)
  const pendingAttendees = attendees.filter(
    (a) => a.isMeetlessUser && !a.submitted && a.email !== currentUserEmail &&
      a.email.toLowerCase() !== (organiserEmail ?? '').toLowerCase()
  )
  const blockerCount = updates.filter((u) => u.status_tag === 'blocked').length

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl text-gray-900 dark:text-white mb-1">{meeting.title}</h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-sm text-gray-500 dark:text-gray-400">{dateStr} at {timeStr}</p>
                {isOrganiser && (
                  <span className="px-2 py-0.5 text-xs text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded">
                    You are the organiser
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-lg text-sm border border-purple-200 dark:border-purple-800">
                <Clock className="w-4 h-4" />
                <span className="tabular-nums">{timeLeft}</span>
              </div>
              <button onClick={handleRefresh} disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-sm text-gray-600 dark:text-gray-300">
                <span className="text-gray-900 dark:text-white">{submittedCount} of {totalCount}</span> members submitted
              </span>
            </div>
            {blockerCount > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="text-gray-900 dark:text-white">{blockerCount}</span>{' '}
                  {blockerCount === 1 ? 'blocker' : 'blockers'} flagged
                </span>
              </div>
            )}
          </div>
        </div>

        {!isOrganiser && !hasSubmitted && !showLateForm && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6 flex items-center justify-between">
            <p className="text-sm text-amber-800 dark:text-amber-400">
              The meeting has started. You can still add your update.
            </p>
            <button onClick={() => setShowLateForm(true)}
              className="ml-4 px-4 py-1.5 text-sm bg-amber-800 dark:bg-amber-700 text-white rounded-lg hover:bg-amber-900 dark:hover:bg-amber-600 transition-colors flex-shrink-0">
              Add my update →
            </button>
          </div>
        )}

        {!hasSubmitted && showLateForm && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm text-gray-500 dark:text-gray-400">Add your update</h2>
              <button onClick={() => setShowLateForm(false)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                Cancel
              </button>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1.5">What did you complete since last meeting?</label>
              <textarea value={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.value })} rows={2} className={textareaClass} placeholder="Completed tasks…" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1.5">What will you work on today?</label>
              <textarea value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} rows={2} className={textareaClass} placeholder="Today's goals…" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1.5">Any blockers? <span className="text-gray-400 dark:text-gray-500">(optional)</span></label>
              <textarea value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} rows={2} className={textareaClass} placeholder="Anything blocking your progress…" />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                {STATUS_OPTIONS.map(({ value, label, selected }) => (
                  <button key={value} onClick={() => setForm({ ...form, status_tag: value })}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${form.status_tag === value ? selected : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={handleSubmit} disabled={submitting || !form.completed.trim() || !form.plan.trim()}
                className="ml-auto flex items-center gap-2 px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Submitting…' : 'Submit update'}
              </button>
            </div>
          </div>
        )}

        {currentUserUpdate && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
            <h2 className="text-sm text-gray-500 dark:text-gray-400 mb-4">My update</h2>
            <StatusUpdateCard update={currentUserUpdate} isCurrentUser />
          </div>
        )}

        {(otherUpdates.length > 0 || pendingAttendees.length > 0) && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
            <h2 className="text-sm text-gray-500 dark:text-gray-400 mb-4">Team updates</h2>
            <div className="grid grid-cols-2 gap-4">
              {otherUpdates.map((update) => (
                <StatusUpdateCard key={update.id} update={update} />
              ))}
              {pendingAttendees.map((attendee) => (
                <PendingCard key={attendee.email} email={attendee.email} userId={attendee.userId} meetingId={meeting.id} />
              ))}
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span>✨</span>
              <h2 className="text-sm text-gray-500 dark:text-gray-400">AI summary</h2>
            </div>
            {summary && (
              <button onClick={generateSummary} disabled={generatingSummary}
                className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${generatingSummary ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
          </div>
          {generatingSummary ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating summary…
            </div>
          ) : summary ? (
            <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {summary}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              {submittedCount === 0 ? 'Summary will appear once someone submits.' : 'Generating summary…'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
