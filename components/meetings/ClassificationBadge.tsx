import type { Classification } from '@/types/meeting'

interface Props {
  classification: Classification
}

const styles: Record<Classification, string> = {
  important: 'bg-green-50 text-green-700 border-green-200',
  async: 'bg-purple-50 text-purple-700 border-purple-200',
  passive: 'bg-blue-50 text-blue-700 border-blue-200',
}

const labels: Record<Classification, string> = {
  important: 'Important',
  async: 'Async',
  passive: 'Passive',
}

// Pill badge showing meeting classification with colour coding
export default function ClassificationBadge({ classification }: Props) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[classification]}`}
    >
      {labels[classification]}
    </span>
  )
}
