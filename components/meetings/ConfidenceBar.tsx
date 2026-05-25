interface Props {
  confidence: number
}

function barColor(confidence: number): string {
  if (confidence > 70) return 'bg-green-400'
  if (confidence >= 40) return 'bg-amber-400'
  return 'bg-red-400'
}

export default function ConfidenceBar({ confidence }: Props) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor(confidence)}`}
          style={{ width: `${confidence}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 dark:text-gray-500 w-24 text-right">
        Attendance needed: {confidence}%
      </span>
    </div>
  )
}
