'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

interface Props {
  keyPoints: string[]
  actionItems: string[]
  decisions: string[]
  transcript: string
  legacySummary: string | null
  meetingTitle: string
  summaryText: string | null
}

export default function SummaryDetailClient({
  keyPoints,
  actionItems,
  decisions,
  transcript,
  legacySummary,
  meetingTitle,
  summaryText,
}: Props) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareText = [
    `Meeting Summary: ${meetingTitle}`,
    '',
    summaryText ? `Summary:\n${summaryText}` : '',
    '',
    keyPoints.length > 0
      ? ['Key Points:', ...keyPoints.map((p) => `• ${p}`)].join('\n')
      : '',
    '',
    decisions.length > 0
      ? ['Decisions:', ...decisions.map((d) => `• ${d}`)].join('\n')
      : '',
    '',
    actionItems.length > 0
      ? ['Action Items:', ...actionItems.map((a) => `→ ${a}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Top-level summary (from passive summary flow) */}
      {summaryText && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm text-gray-500 mb-3">Summary</h2>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{summaryText}</p>
        </div>
      )}

      {/* Key points */}
      {keyPoints.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm text-gray-500 mb-3">Key points</h2>
          <ul className="space-y-2">
            {keyPoints.map((pt, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-800">
                <span className="text-gray-400 flex-shrink-0 mt-0.5">·</span>
                {pt}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Decisions */}
      {decisions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm text-gray-500 mb-3">Decisions</h2>
          <ul className="space-y-2">
            {decisions.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-800">
                <span className="text-purple-400 flex-shrink-0 mt-0.5">·</span>
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action items */}
      {actionItems.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm text-gray-500 mb-3">Action items</h2>
          <ul className="space-y-2">
            {actionItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-800">
                <span className="text-blue-400 flex-shrink-0 mt-0.5">→</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legacy plain-text summary fallback */}
      {legacySummary && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm text-gray-500 mb-3">Summary</h2>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{legacySummary}</p>
        </div>
      )}

      {/* Expandable transcript */}
      {transcript && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm text-gray-500">Full transcript</span>
            {showTranscript ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {showTranscript && (
            <div className="px-5 pb-5 border-t border-gray-200 pt-4">
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {transcript}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Share button */}
      <div className="flex justify-end">
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          {copied ? 'Copied!' : 'Share summary'}
        </button>
      </div>
    </div>
  )
}
