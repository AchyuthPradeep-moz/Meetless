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

// Single status update card shown on the async board
export default function StatusCard({ update }: Props) {
  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">
          {new Date(update.submitted_at).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        {update.status_tag && (
          <span className="text-xs border border-gray-200 rounded-full px-2 py-0.5">
            {update.status_tag}
          </span>
        )}
      </div>
      {update.completed && (
        <div className="mb-2">
          <p className="text-xs font-medium text-gray-500 mb-0.5">Completed</p>
          <p className="text-sm">{update.completed}</p>
        </div>
      )}
      {update.plan && (
        <div className="mb-2">
          <p className="text-xs font-medium text-gray-500 mb-0.5">Plan</p>
          <p className="text-sm">{update.plan}</p>
        </div>
      )}
      {update.blockers && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-0.5">Blockers</p>
          <p className="text-sm text-red-600">{update.blockers}</p>
        </div>
      )}
    </div>
  )
}
