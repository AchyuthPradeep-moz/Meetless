'use client'

import { useSession } from 'next-auth/react'

// Topbar — shows user email and a sync button for triggering classification
export default function Topbar() {
  const { data: session } = useSession()

  const sync = async () => {
    await fetch('/api/meetings/classify', { method: 'POST' })
    window.location.reload()
  }

  return (
    <header className="h-12 border-b border-gray-100 flex items-center justify-between px-6">
      <span className="text-xs text-gray-400">{session?.user?.email}</span>
      <button
        onClick={sync}
        className="text-xs border border-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-50 transition-colors"
      >
        Sync Calendar
      </button>
    </header>
  )
}
