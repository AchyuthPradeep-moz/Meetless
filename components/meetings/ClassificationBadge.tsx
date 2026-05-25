import type { Classification } from '@/types/meeting'

interface Props {
  classification: Classification
}

const styles: Record<Classification, string> = {
  important: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  async: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800',
  passive: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
}

const labels: Record<Classification, string> = {
  important: 'Important',
  async: 'Async',
  passive: 'Passive',
}

export default function ClassificationBadge({ classification }: Props) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[classification]}`}
    >
      {labels[classification]}
    </span>
  )
}
