import NextAuth, { type NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { supabaseAdmin } from '@/lib/supabase'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // access_type=offline + prompt=consent ensures we always get a refresh token
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return false

      const { error } = await supabaseAdmin.from('users').upsert(
        {
          email: user.email,
          google_id: account.providerAccountId,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          token_expiry: account.expires_at
            ? new Date(account.expires_at * 1000).toISOString()
            : null,
        },
        { onConflict: 'google_id' }
      )

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
