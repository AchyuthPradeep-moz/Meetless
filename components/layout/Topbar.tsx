'use client'

import { useSession } from 'next-auth/react'

export default function Topbar() {
  const { data: session } = useSession()

  const sync = async () => {
    await fetch('/api/meetings/classify', { method: 'POST' })
    window.location.reload()
  }

  return (
    <header className="h-12 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-6">
      <span className="text-xs text-gray-400 dark:text-gray-500">{session?.user?.email}</span>
      <button
        onClick={sync}
        className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 transition-colors"
      >
        Sync Calendar
      </button>
    </header>
  )
}
