import type { MeetingPayload, ClassificationResult, Classification } from '@/types/meeting'
import { batchClassify } from './claude'

const VALID: Classification[] = ['important', 'async', 'passive']

// Sends all meetings to Claude in one batched API call, then validates each result.
// Caching (skip already-classified meetings) is the caller's responsibility.
export async function classifyMeetings(
  meetings: MeetingPayload[]
): Promise<ClassificationResult[]> {
  if (meetings.length === 0) return []

  const results = await batchClassify(meetings)

  for (const result of results) {
    const cls = result.classification?.toLowerCase() as Classification
    if (!VALID.includes(cls)) {
      console.error('Invalid classification returned:', result.classification)
      result.classification = 'async'
      result.confidence = 50
      result.reason = 'Classification unclear — defaulted to async candidate'
    } else {
      result.classification = cls
    }
  }

  return results
}
