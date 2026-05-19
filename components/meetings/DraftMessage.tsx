'use client'

import { useState } from 'react'
import { MessageSquare, Send, RefreshCw } from 'lucide-react'
import type { Classification } from '@/types/meeting'

interface Props {
  meetingId: string
  classification: Classification
  initialDraft: string | null
  initialDraftSent: boolean
}

// Interactive draft-message-to-organiser panel. Shown for async and passive meetings only.
// Generate creates a Claude draft → Send pushes it to the user's Slack for approval.
// The message is never forwarded automatically — Slack buttons handle the final send.
export default function DraftMessage({ meetingId, classification, initialDraft, initialDraftSent }: Props) {
  const [draft, setDraft] = useState(initialDraft)
  const [sent, setSent] = useState(initialDraftSent)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slackSent, setSlackSent] = useState(false)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/meetings/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId }),
      })
      const data = await res.json()
      if (data.draft_message) {
        setDraft(data.draft_message)
        setSent(false)
        setSlackSent(false)
      } else {
        setError(data.error ?? 'Failed to generate draft')
      }
    } catch {
      setError('Failed to generate draft')
    } finally {
      setLoading(false)
    }
  }

  const sendToSlack = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/meetings/draft/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId }),
      })
      const data = await res.json()
      if (res.ok) {
        setSlackSent(true)
      } else {
        setError(data.error ?? 'Failed to send to Slack')
      }
    } catch {
      setError('Failed to send to Slack')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-gray-200 pt-6">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm text-gray-600">Draft message to organiser</h3>
      </div>

      {!draft ? (
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm"
        >
          {loading ? 'Generating...' : 'Generate draft message'}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{draft}</p>
          </div>

          {sent ? (
            <p className="text-sm text-green-700">Message was sent to the organiser.</p>
          ) : slackSent ? (
            <p className="text-sm text-green-700">Draft sent to your Slack — approve it there to forward to the organiser.</p>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={sendToSlack}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm"
              >
                <Send className="w-4 h-4" />
                {loading ? 'Sending...' : 'Send to Slack for approval'}
              </button>
              <button
                onClick={generate}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}
