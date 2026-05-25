interface StatusUpdate {
  id: string
  completed: string
  plan: string
  blockers: string
  status_tag: string | null
  submitted_at: string
}

interface Props {
  update: StatusUpdate
}

export default function StatusCard({ update }: Props) {
  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {new Date(update.submitted_at).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        {update.status_tag && (
          <span className="text-xs border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
            {update.status_tag}
          </span>
        )}
      </div>
      {update.completed && (
        <div className="mb-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Completed</p>
          <p className="text-sm dark:text-gray-200">{update.completed}</p>
        </div>
      )}
      {update.plan && (
        <div className="mb-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Plan</p>
          <p className="text-sm dark:text-gray-200">{update.plan}</p>
        </div>
      )}
      {update.blockers && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Blockers</p>
          <p className="text-sm text-red-600 dark:text-red-400">{update.blockers}</p>
        </div>
      )}
    </div>
  )
}
