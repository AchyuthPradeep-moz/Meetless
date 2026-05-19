export type Classification = 'important' | 'async' | 'passive'

export interface Meeting {
  id: string
  user_id: string
  google_event_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  duration: number
  attendee_count: number
  attendee_emails: string[]
  is_organiser: boolean
  is_recurring: boolean
  meet_link: string | null
  classification: Classification | null
  confidence: number | null
  reason: string | null
  async_summary: string | null
  organiser_email: string | null
  draft_message: string | null
  draft_sent: boolean
  draft_sent_to_slack_user_id: string | null
  draft_sent_by_user_id: string | null
  outcome: 'cancelled' | 'async' | 'happened' | null
  created_at: string
}

// Stripped payload sent to Claude — only what the model needs
export interface MeetingPayload {
  title: string
  description: string
  duration: number
  attendee_count: number
  is_organiser: boolean
  is_recurring: boolean
}

export interface ClassificationResult {
  classification: Classification
  confidence: number
  reason: string
}
