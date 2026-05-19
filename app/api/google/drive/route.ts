import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthClient } from '@/lib/auth'
import { google } from 'googleapis'
import type { User } from '@/types/user'

// GET — fetches Google Drive files recently modified (Phase IV: transcript fetch)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', session.user.email)
    .single<User>()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const authClient = await getAuthClient(user)
  const drive = google.drive({ version: 'v3', auth: authClient })

  const res = await drive.files.list({
    pageSize: 10,
    fields: 'files(id, name, mimeType, webViewLink)',
    orderBy: 'modifiedTime desc',
  })

  return NextResponse.json(res.data.files)
}
