import NextAuth, { type NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { supabaseAdmin } from '@/lib/supabase'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // access_type=offline is required to receive a refresh token at all.
      // prompt is intentionally omitted here — the login page passes it
      // via signIn()'s third argument so returning users skip the consent screen.
      authorization: {
        params: {
          access_type: 'offline',
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.events',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return false

      // Only include refresh_token when Google provides one (not returned on select_account).
      // Omitting it from the upsert preserves the existing token in the DB.
      const upsertData: Record<string, unknown> = {
        email: user.email,
        google_id: account.providerAccountId,
        access_token: account.access_token,
        token_expiry: account.expires_at
          ? new Date(account.expires_at * 1000).toISOString()
          : null,
      }
      if (account.refresh_token) {
        upsertData.refresh_token = account.refresh_token
      }

      const { error } = await supabaseAdmin
        .from('users')
        .upsert(upsertData, { onConflict: 'google_id' })

      if (error) console.error('Failed to upsert user on sign-in:', error)
      else console.log('User upserted on sign-in:', user.email)

      return true
    },
    async session({ session }) {
      if (session.user?.email) {
        const { data: dbUser } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single()
        if (dbUser) session.user.id = dbUser.id
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
