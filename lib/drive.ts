import { google } from 'googleapis'
import { getAuthClient } from './auth'
import type { User } from '@/types/user'

type DriveFile = { id: string; name: string | null | undefined; mimeType: string | null | undefined }

// Extracts plain text from a file in the user's Drive.
// Handles Google Doc transcripts and plain-text/VTT files.
async function extractText(
  file: DriveFile,
  drive: ReturnType<typeof google.drive>,
  auth: Awaited<ReturnType<typeof getAuthClient>>
): Promise<string | null> {
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const docs = google.docs({ version: 'v1', auth })
    const doc = await docs.documents.get({ documentId: file.id })
    return (
      (doc.data.body?.content ?? [])
        .flatMap((s) => s.paragraph?.elements ?? [])
        .map((e) => e.textRun?.content ?? '')
        .join('')
        .trim() || null
    )
  }

  const fileRes = await drive.files.get(
    { fileId: file.id, alt: 'media' },
    { responseType: 'text' }
  )
  return String(fileRes.data).trim() || null
}

// Runs a Drive files.list query, logs the query and results, and returns matching files.
async function searchDrive(
  drive: ReturnType<typeof google.drive>,
  label: string,
  params: Parameters<ReturnType<typeof google.drive>['files']['list']>[0]
): Promise<DriveFile[]> {
  console.log(`Drive search [${label}] query:`, params.q)
  const { data } = await drive.files.list(params)
  const files = (data.files ?? []) as DriveFile[]
  console.log(`Drive search [${label}] files found: ${files.length}`, files.map((f) => f.name))
  return files
}

// Fetches the transcript for a meeting from the organiser's Google Drive.
// Tries four matching strategies in order: exact title, partial title (first 3 words),
// same-day transcript files, and any file in Meet Recordings within 1h of meeting end.
export async function fetchMeetingTranscript(
  user: User,
  meetingTitle: string,
  meetingStartTime: string,
  durationMins = 60
): Promise<string | null> {
  const auth = await getAuthClient(user)
  const drive = google.drive({ version: 'v3', auth })

  const meetingStart = new Date(meetingStartTime)
  const meetingEnd = new Date(meetingStart.getTime() + durationMins * 60 * 1000)
  // Recordings take time to process — allow up to 1h after meeting end
  const windowEnd = new Date(meetingEnd.getTime() + 60 * 60 * 1000)
  // Search from 15 min before start (in case of clock drift)
  const windowStart = new Date(meetingStart.getTime() - 15 * 60 * 1000)

  const fields = 'files(id, name, mimeType)'

  // Prefer transcript-labelled file within results; fall back to first result
  function pickTranscript(files: DriveFile[]): DriveFile | null {
    return files.find((f) => f.name?.toLowerCase().includes('transcript')) ?? files[0] ?? null
  }

  console.log('Searching Drive for transcript:', meetingTitle)
  console.log('Search window:', windowStart.toISOString(), '→', windowEnd.toISOString())

  // ── Strategy 1: exact title match ────────────────────────────────────────
  {
    const safeTitle = meetingTitle.slice(0, 60).replace(/'/g, "\\'")
    const files = await searchDrive(drive, 'exact title', {
      q: [
        `name contains '${safeTitle}'`,
        `createdTime > '${windowStart.toISOString()}'`,
        `createdTime < '${windowEnd.toISOString()}'`,
        `trashed = false`,
      ].join(' and '),
      fields,
      orderBy: 'createdTime desc',
      pageSize: 10,
    })
    const file = pickTranscript(files)
    if (file?.id) {
      console.log('Exact match found:', file.name)
      return extractText(file, drive, auth)
    }
  }

  // ── Strategy 2: partial match — first 3 words of title ───────────────────
  {
    const first3 = meetingTitle.trim().split(/\s+/).slice(0, 3).join(' ').replace(/'/g, "\\'")
    const fullSafe = meetingTitle.slice(0, 60).replace(/'/g, "\\'")
    if (first3 && first3 !== fullSafe) {
      const files = await searchDrive(drive, 'partial title (3 words)', {
        q: [
          `name contains '${first3}'`,
          `createdTime > '${windowStart.toISOString()}'`,
          `createdTime < '${windowEnd.toISOString()}'`,
          `trashed = false`,
        ].join(' and '),
        fields,
        orderBy: 'createdTime desc',
        pageSize: 10,
      })
      const file = pickTranscript(files)
      if (file?.id) {
        console.log('Partial match found:', file.name)
        return extractText(file, drive, auth)
      }
    }
  }

  // ── Strategy 3: any transcript file created on the same calendar day ─────
  {
    const dayStart = new Date(meetingStart)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const files = await searchDrive(drive, 'same-day transcript', {
      q: [
        `name contains 'transcript'`,
        `createdTime > '${dayStart.toISOString()}'`,
        `createdTime < '${dayEnd.toISOString()}'`,
        `trashed = false`,
      ].join(' and '),
      fields,
      orderBy: 'createdTime desc',
      pageSize: 20,
    })
    const file = files[0] ?? null
    if (file?.id) {
      console.log('Date match found:', file.name)
      return extractText(file, drive, auth)
    }
  }

  // ── Strategy 4: any file in Meet Recordings folder within 1h of meeting end
  {
    const folders = await searchDrive(drive, 'Meet Recordings folder', {
      q: `name = 'Meet Recordings' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 1,
    })
    const folderId = folders[0]?.id

    if (folderId) {
      const files = await searchDrive(drive, 'folder contents', {
        q: [
          `'${folderId}' in parents`,
          `createdTime > '${meetingEnd.toISOString()}'`,
          `createdTime < '${windowEnd.toISOString()}'`,
          `trashed = false`,
        ].join(' and '),
        fields,
        orderBy: 'createdTime asc',
        pageSize: 10,
      })
      const file = pickTranscript(files)
      if (file?.id) {
        console.log('Meet Recordings folder match found:', file.name)
        return extractText(file, drive, auth)
      }
    } else {
      console.log('Meet Recordings folder not found in Drive')
    }
  }

  console.log('No transcript found in Drive for:', meetingTitle)
  return null
}
