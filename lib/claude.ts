import Anthropic from '@anthropic-ai/sdk'
import type { MeetingPayload, ClassificationResult, Classification } from '@/types/meeting'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Retries fn up to `retries` times on overloaded (529) or rate-limit (429) errors.
// Exponential backoff: 2s, 4s, 8s. Any other error is rethrown immediately.
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      if (i === retries - 1) throw err
      if (err?.status === 529 || err?.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, i)))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries reached')
}

const CLASSIFY_SYSTEM_PROMPT = `You are a meeting classification assistant.
Classify each meeting as exactly one of: important, async, or passive.

DEFINITIONS:
- important: User's live attendance and active input are required.
  Decision-making, discussions, planning, design reviews, 1:1s,
  interviews, brainstorming. User is organiser of a working session.

- async: Information is one-way and does not require live discussion.
  Status updates, standups, progress reports, briefings where user
  just listens. Could be replaced by a shared doc or Slack message.

- passive: User's presence is optional or minimal. All-hands, town halls,
  large broadcasts, demos where user is audience, FYI meetings.
  User could skip and read a summary instead.

CLASSIFICATION RULES (apply in order):
1. Title signal is strongest — if title contains:
   - 'standup', 'status', 'update', 'sync', 'check-in' → async
   - 'all hands', 'all-hands', 'town hall', 'broadcast', 'fyi',
     'passive', 'optional', 'announcement' → passive
   - 'planning', 'review', 'interview', 'decision', 'strategy',
     '1:1', 'one on one' → important

2. Attendee role:
   - User is organiser of small meeting (≤5 people) → important
   - User is organiser of large meeting (>10 people) → passive
   - User is optional attendee among many → passive
   - User is required in a small focused group → important

3. Meeting size:
   - 2 people → almost always important
   - 3-5 people → likely important or async
   - 6-15 people → likely async
   - 15+ people → likely passive

4. Description signal:
   - One-way information sharing mentioned → async
   - Decision or discussion mentioned → important
   - No description + recurring → async

CONFIDENCE SCORE = attendance necessity (0-100):
- important meetings: 75-100 (high attendance needed)
- async meetings: 15-40 (low attendance needed)
- passive meetings: 5-20 (very low attendance needed)

Return raw JSON array only. No markdown. No backticks.
Format: [{id, classification, confidence, reason}]
Reason must be under 12 words.`

// Batch-classifies all meetings in one API call — no pre-filtering.
// Returns results in the same order as the input array.
export async function batchClassify(
  meetings: MeetingPayload[]
): Promise<ClassificationResult[]> {
  const userContent = JSON.stringify(
    meetings.map((m, i) => ({
      id: i,
      title: m.title,
      description: m.description ? m.description.slice(0, 150) : '',
      duration_minutes: m.duration,
      attendee_count: m.attendee_count,
      is_organiser: m.is_organiser,
      is_recurring: m.is_recurring,
    }))
  )

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })
  )

  const text = (message.content[0] as { type: 'text'; text: string }).text
  const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleanText) as Array<{
    id: number
    classification: Classification
    confidence: number
    reason: string
  }>

  // Re-order by id to preserve input order
  const results: ClassificationResult[] = new Array(meetings.length)
  for (const item of parsed) {
    results[item.id] = {
      classification: item.classification,
      confidence: item.confidence,
      reason: item.reason,
    }
  }

  return results
}

// Generates a draft message from senderName to the organiser suggesting async handling.
// Always shown to the user for approval — never sent automatically.
export async function generateAsyncDraftMessage(
  meetingTitle: string,
  attendeeCount: number,
  duration: number,
  senderName: string
): Promise<string> {
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `Write a short professional message from ${senderName} to the meeting organiser suggesting the meeting could be handled asynchronously. Start with "Hi, this is ${senderName}." or "Hey, ${senderName} here." Be polite, specific to the meeting title, under 80 words. Return only the message text.`,
      messages: [
        {
          role: 'user',
          content: `Meeting: "${meetingTitle}". ${attendeeCount} attendees. ${duration} minutes.`,
        },
      ],
    })
  )

  return (message.content[0] as { type: 'text'; text: string }).text.trim()
}

// Generates a draft message from senderName to the organiser indicating passive attendance.
// Always shown to the user for approval — never sent automatically.
export async function generatePassiveDraftMessage(
  meetingTitle: string,
  senderName: string
): Promise<string> {
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Write a short professional message from ${senderName} to the meeting organiser letting them know they will attend passively. Start with the sender's name. Under 60 words. Return only the message text.`,
      messages: [
        {
          role: 'user',
          content: `Meeting: "${meetingTitle}"`,
        },
      ],
    })
  )

  return (message.content[0] as { type: 'text'; text: string }).text.trim()
}

// Summarises async status updates from a team into a concise paragraph
export async function generateAsyncSummary(
  updates: Array<{
    email: string
    completed: string | null
    plan: string | null
    blockers: string | null
    status_tag: string | null
  }>
): Promise<string> {
  const content = updates
    .map(
      (u) =>
        `${u.email} [${u.status_tag ?? 'unknown'}]: Completed: ${u.completed || 'n/a'}. Plan: ${u.plan || 'n/a'}. Blockers: ${u.blockers || 'none'}.`
    )
    .join('\n')

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'Summarise these team status updates in 2-3 sentences. Highlight any blockers. Be concise.',
      messages: [{ role: 'user', content }],
    })
  )

  return (message.content[0] as { type: 'text'; text: string }).text
}

// Summarises a meeting transcript into key points and action items
export async function generateSummary(
  transcript: string
): Promise<{ summary: string; action_items: string }> {
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: 'Summarise the meeting transcript. Return JSON: { summary, action_items }.',
      messages: [{ role: 'user', content: transcript.slice(0, 4000) }],
    })
  )

  const text = (message.content[0] as { type: 'text'; text: string }).text
  return JSON.parse(text)
}

// Summarises a live-transcribed meeting into structured key points and action items.
// Returns JSON only — { keyPoints: string[], actionItems: string[] }.
export async function generateMeetingSummary(
  transcript: string,
  meetingTitle: string
): Promise<{ keyPoints: string[]; actionItems: string[] }> {
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:
        'You are summarising a meeting transcript. Return JSON only with: { keyPoints: string[], actionItems: string[] }',
      messages: [
        {
          role: 'user',
          content: `Meeting: "${meetingTitle}"\n\nTranscript:\n${transcript.slice(0, 4000)}`,
        },
      ],
    })
  )

  const text = (message.content[0] as { type: 'text'; text: string }).text
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(clean)
}

// Generates a structured summary of a meeting transcript specifically for passive attendees.
// Returns a top-level summary, a list of decisions, and action items.
export async function generatePassiveSummary(
  transcript: string,
  meetingTitle: string
): Promise<{ summary: string; decisions: string[]; actionItems: string[] }> {
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system:
        'Summarise this meeting transcript for a passive attendee. Return JSON only, no markdown: { "summary": "2-3 sentence overview", "decisions": ["decision 1", ...], "actionItems": ["action 1", ...] }',
      messages: [
        {
          role: 'user',
          content: `Meeting: "${meetingTitle}"\n\nTranscript:\n${transcript.slice(0, 4000)}`,
        },
      ],
    })
  )

  const text = (message.content[0] as { type: 'text'; text: string }).text
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(clean)
}
