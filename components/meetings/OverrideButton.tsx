'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Classification } from '@/types/meeting'

const options: { value: Classification; label: string }[] = [
  { value: 'important', label: 'Important' },
  { value: 'async', label: 'Async candidate' },
  { value: 'passive', label: 'Passive' },
]

interface Props {
  meetingId: string
  current: Classification
}

export default function OverrideButton({ meetingId, current }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const override = async (newClassification: Classification) => {
    if (newClassification === current) return
    setLoading(true)
    setOpen(false)
    await fetch('/api/meetings/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId, new_classification: newClassification }),
    })
    window.location.reload()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.preventDefault(); setOpen(!open) }}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        Override
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-md py-1 w-44 z-10">
          {options
            .filter((o) => o.value !== current)
            .map((o) => (
              <button
                key={o.value}
                onClick={(e) => { e.preventDefault(); override(o.value) }}
                className="w-full px-4 py-2 text-left hover:bg-gray-50 text-sm text-gray-900"
              >
                {o.label}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
