'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

interface Summary {
  id: string
  meeting_id: string
  summary: string | null
  action_items: string | null
  transcript_text: string | null
  created_at: string
  meetings: {
    title: string
    start_time: string
    duration: number
  } | null
}

interface ParsedSummary {
  keyPoints: string[]
  actionItems: string[]
  decisions?: string[]
  summary?: string
}

function parseSummary(raw: string | null): ParsedSummary | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.keyPoints) && Array.isArray(parsed.actionItems)) {
      return parsed as ParsedSummary
    }
    return null
  } catch {
    return null
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function SummaryCard({ s }: { s: Summary }) {
  const [open, setOpen] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const parsed = parseSummary(s.summary)

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full p-5 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-4 mb-1">
            <span className="text-gray-900 truncate">{s.meetings?.title ?? 'Untitled'}</span>
            {s.meetings?.start_time && (
              <span className="text-sm text-gray-500 flex-shrink-0">
                {fmtDate(s.meetings.start_time)}
              </span>
            )}
          </div>
          {s.meetings?.start_time && (
            <div className="text-sm text-gray-500">
              {fmtTime(s.meetings.start_time)}
              {s.meetings.duration ? ` · ${s.meetings.duration} min` : ''}
            </div>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0 ml-4" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0 ml-4" />
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-200 pt-4 space-y-4">
          {/* Structured summary */}
          {parsed ? (
            <>
              {parsed.summary && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Summary</p>
                  <p className="text-sm text-gray-800">{parsed.summary}</p>
                </div>
              )}
              {parsed.keyPoints.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Key points</p>
                  <ul className="space-y-1.5">
                    {parsed.keyPoints.map((pt, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-800">
                        <span className="text-gray-400 flex-shrink-0">·</span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(parsed.decisions ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Decisions</p>
                  <ul className="space-y-1.5">
                    {(parsed.decisions ?? []).map((d, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-800">
                        <span className="text-purple-400 flex-shrink-0">·</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {parsed.actionItems.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Action items</p>
                  <ul className="space-y-1.5">
                    {parsed.actionItems.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-800">
                        <span className="text-blue-400 flex-shrink-0">→</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            /* Legacy plain-text summary */
            s.summary && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-800">{s.summary}</p>
              </div>
            )
          )}

          {/* Expandable transcript */}
          {s.transcript_text && (
            <div>
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                {showTranscript ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                {showTranscript ? 'Hide' : 'View'} full transcript
              </button>
              {showTranscript && (
                <div className="mt-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {s.transcript_text}
                  </p>
                </div>
              )}
            </div>
          )}

          {s.meeting_id && (
            <Link
              href={`/summaries/${s.meeting_id}`}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View full summary page
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export default function SummariesClient({ summaries }: { summaries: Summary[] }) {
  const [query, setQuery] = useState('')

  const filtered = summaries.filter(
    (s) =>
      (s.summary || s.transcript_text) &&
      (s.meetings?.title ?? '').toLowerCase().includes(query.toLowerCase())
  )

  return (
    <>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search summaries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600">
            {query ? 'No summaries match your search.' : 'No summaries yet.'}
          </p>
          {!query && (
            <p className="text-sm text-gray-400 mt-1">
              Summaries are automatically generated after passive meetings end.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <SummaryCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </>
  )
}
