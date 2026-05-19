import { google } from 'googleapis'
import { supabaseAdmin } from './supabase'
import type { User } from '@/types/user'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
)

// Refreshes the access token if it has expired or is within 5 minutes of expiry.
// Always call this before any Google API request.
export async function getValidAccessToken(user: User): Promise<string> {
  const expiry = user.token_expiry ? new Date(user.token_expiry) : null
  const isExpired = !expiry || expiry.getTime() - Date.now() < 5 * 60 * 1000

  if (!isExpired && user.access_token) return user.access_token

  oauth2Client.setCredentials({
    refresh_token: user.refresh_token,
  })

  const { credentials } = await oauth2Client.refreshAccessToken()

  await supabaseAdmin
    .from('users')
    .update({
      access_token: credentials.access_token,
      token_expiry: new Date(credentials.expiry_date!).toISOString(),
    })
    .eq('id', user.id)

  return credentials.access_token!
}

// Force-refreshes the access token for a given user and persists the result to DB.
export async function refreshGoogleToken(userId: string, refreshToken: string): Promise<string> {
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await oauth2Client.refreshAccessToken()

  await supabaseAdmin
    .from('users')
    .update({
      access_token: credentials.access_token,
      token_expiry: new Date(credentials.expiry_date!).toISOString(),
    })
    .eq('id', userId)

  return credentials.access_token!
}

// Returns an OAuth2 client pre-loaded with a valid token for a given user
export async function getAuthClient(user: User) {
  const token = await getValidAccessToken(user)
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  client.setCredentials({ access_token: token })
  return client
}
