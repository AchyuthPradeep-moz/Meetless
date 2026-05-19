export interface User {
  id: string
  email: string
  google_id: string
  slack_user_id: string | null
  access_token: string | null
  refresh_token: string | null
  token_expiry: string | null
  digest_time: string
  created_at: string
}
