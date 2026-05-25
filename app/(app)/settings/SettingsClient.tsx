'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { CheckCircle, XCircle } from 'lucide-react'

interface Props {
  googleConnected: boolean
  slackConnected: boolean
  initialDigestTime: string
  initialReminderMins: number
}

export default function SettingsClient({
  googleConnected: initialGoogle,
  slackConnected: initialSlack,
  initialDigestTime,
  initialReminderMins,
}: Props) {
  const [googleConn, setGoogleConn] = useState(initialGoogle)
  const [slackConn, setSlackConn] = useState(initialSlack)
  const [digestTime, setDigestTime] = useState(initialDigestTime)
  const [reminderMins, setReminderMins] = useState(initialReminderMins)
  const [saved, setSaved] = useState(false)

  const disconnectGoogle = async () => {
    await fetch('/api/settings/disconnect-google', { method: 'POST' })
    setGoogleConn(false)
  }

  const disconnectSlack = async () => {
    await fetch('/api/settings/disconnect-slack', { method: 'POST' })
    setSlackConn(false)
  }

  const connectSlack = () => {
    window.location.href = '/api/slack/oauth'
  }

  const savePreferences = async () => {
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest_time: digestTime, reminder_minutes: reminderMins }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h2 className="text-lg text-gray-900 dark:text-white mb-6">Integrations</h2>

        <div className="space-y-6">
          <div className="flex items-center justify-between pb-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-gray-900 dark:text-white">Google Calendar</span>
                {googleConn ? (
                  <div className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    Connected
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                    <XCircle className="w-4 h-4" />
                    Not connected
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Connect your Google Calendar to analyze and classify your meetings
              </p>
            </div>
            {googleConn ? (
              <button
                onClick={disconnectGoogle}
                className="ml-4 px-3 py-1 text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => signIn('google', {}, { access_type: 'offline', prompt: 'consent' })}
                className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Connect
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-gray-900 dark:text-white">Slack</span>
                {slackConn ? (
                  <div className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    Connected
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                    <XCircle className="w-4 h-4" />
                    Not connected
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Send notifications and collect async updates via Slack
              </p>
            </div>
            {slackConn ? (
              <button
                onClick={disconnectSlack}
                className="ml-4 px-3 py-1 text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={connectSlack}
                className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h2 className="text-lg text-gray-900 dark:text-white mb-6">Preferences</h2>

        <div className="space-y-8">
          <div>
            <label className="block text-gray-900 dark:text-white mb-3">Meeting Digest time</label>
            <input
              type="time"
              value={digestTime}
              onChange={(e) => setDigestTime(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
            />
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
              Receive a daily summary of your classified meetings
            </p>
          </div>

          <div>
            <label className="block text-gray-900 dark:text-white mb-3">Meeting reminder timing</label>
            <select
              value={reminderMins}
              onChange={(e) => setReminderMins(Number(e.target.value))}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value={5}>5 minutes before</option>
              <option value={10}>10 minutes before</option>
              <option value={15}>15 minutes before</option>
              <option value={30}>30 minutes before</option>
            </select>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
              When to send reminders for upcoming meetings with classifications
            </p>
          </div>

          <button
            onClick={savePreferences}
            className="px-6 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors"
          >
            {saved ? 'Saved!' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  )
}
