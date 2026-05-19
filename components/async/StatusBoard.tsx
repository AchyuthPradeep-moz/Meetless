import StatusCard from './StatusCard'

interface StatusUpdate {
  id: string
  completed: string
  plan: string
  blockers: string
  status_tag: string | null
  submitted_at: string
}

interface Props {
  updates: StatusUpdate[]
  meetingTitle: string
}

// Full async status board — shown at meeting time, lists all team updates
export default function StatusBoard({ updates, meetingTitle }: Props) {
  return (
    <div>
      <h2 className="text-base font-semibold mb-4">{meetingTitle} — Async Board</h2>
      {updates.length === 0 && (
        <p className="text-sm text-gray-400">No updates submitted yet.</p>
      )}
      <div className="flex flex-col gap-3">
        {updates.map((u) => (
          <StatusCard key={u.id} update={u} />
        ))}
      </div>
    </div>
  )
}
