'use client'

import { useState } from 'react'
import { MessageSquare, Send, RefreshCw, Copy, Check } from 'lucide-react'
import type { Classification } from '@/types/meeting'

interface Props {
  meetingId: string
  classification: Classification
  initialDraft: string | null
  initialDraftSent: boolean
  organiserEmail: string | null
}

export default function DraftMessage({ meetingId, classification, initialDraft, initialDraftSent, organiserEmail }: Props) {
  const [draft, setDraft] = useState(initialDraft ?? '')
  const [hasDraft, setHasDraft] = useState(!!initialDraft)
  const [sent, setSent] = useState(initialDraftSent)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sentToOrganiser, setSentToOrganiser] = useState(false)
  const [senderName, setSenderName] = useState<string | null>(null)

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
        setHasDraft(true)
        setSent(false)
        setSentToOrganiser(false)
        if (data.sender_name) setSenderName(data.sender_name)
      } else {
        setError(data.error ?? 'Failed to generate draft')
      }
    } catch {
      setError('Failed to generate draft')
    } finally {
      setLoading(false)
    }
  }

  const sendToOrganiser = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/meetings/draft/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId, draft_message: draft }),
      })
      const data = await res.json()
      if (res.ok) {
        setSentToOrganiser(true)
        setSent(true)
      } else {
        setError(data.error ?? 'Failed to send message')
      }
    } catch {
      setError('Failed to send message')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDiscard = async () => {
    setLoading(true)
    try {
      await fetch('/api/meetings/draft/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId }),
      })
      setDraft('')
      setHasDraft(false)
      setSent(false)
      setSentToOrganiser(false)
    } catch {
      setError('Failed to discard draft')
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

      {!hasDraft ? (
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm"
        >
          {loading ? 'Generating...' : 'Generate draft message'}
        </button>
      ) : (
        <div className="space-y-4">
          {sent && !sentToOrganiser ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700">Message was already sent to the organiser.</p>
            </div>
          ) : sentToOrganiser ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700">
                Message sent to {organiserEmail ?? 'the organiser'} via Slack.
              </p>
            </div>
          ) : (
            <>
              <div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-800 resize-y focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                <div className="flex justify-between items-center mt-1">
                  {senderName ? (
                    <p className="text-xs text-gray-400">Sending as: <span className="text-gray-600">{senderName} via Meetless</span></p>
                  ) : (
                    <span />
                  )}
                  <p className="text-xs text-gray-400">{draft.length} characters</p>
                </div>
              </div>

              {organiserEmail && (
                <p className="text-xs text-gray-500">
                  This will be sent to: <span className="font-medium text-gray-700">{organiserEmail}</span>
                </p>
              )}

              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={sendToOrganiser}
                  disabled={loading || !draft.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm"
                >
                  <Send className="w-4 h-4" />
                  {loading ? 'Sending...' : 'Send to organiser'}
                </button>

                <button
                  onClick={copyToClipboard}
                  disabled={!draft.trim()}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>

                <button
                  onClick={generate}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate
                </button>

                <button
                  onClick={handleDiscard}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 text-sm"
                >
                  Discard draft
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}
