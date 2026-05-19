export interface SlackAction {
  action_id: string
  block_id: string
  value: string
  type: string
}

export interface SlackPayload {
  type: string
  user: { id: string; username: string }
  actions: SlackAction[]
  response_url: string
}

export interface DraftMessage {
  meeting_id: string
  organiser_slack_id: string
  text: string
  approved: boolean
}
