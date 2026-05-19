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
// Searches the entire Drive (no folder filter) so files saved to My Drive root are found.
// Strategy 1: first 2 words of title + "Transcript" — whole drive, no time filter.
// Strategy 2: Meet Recordings folder — ±3h window around meeting.
// Strategy 3: any Transcript file created on the same calendar day.
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
  const fields = 'files(id, name, mimeType, createdTime)'

  // Sanitise a string for use inside a Drive query string literal
  function safe(s: string) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  console.log('Searching Drive for transcript:', meetingTitle)

  // ── Strategy 1: entire Drive, first 2 words + "Transcript", no time filter ──
  {
    const firstTwo = safe(meetingTitle.trim().split(/\s+/).slice(0, 2).join(' '))
    const files = await searchDrive(drive, 'strategy-1 (name+Transcript, whole drive)', {
      q: `name contains '${firstTwo}' and name contains 'Transcript' and trashed = false`,
      fields,
      spaces: 'drive',
      orderBy: 'createdTime desc',
      pageSize: 5,
    })
    if (files.length > 0) {
      console.log('Strategy 1 match:', files[0].name)
      return extractText(files[0], drive, auth)
    }
  }

  // ── Strategy 2: Meet Recordings folder, ±3h window ───────────────────────
  {
    const windowStart = new Date(meetingStart.getTime() - 3 * 60 * 60 * 1000)
    const windowEnd = new Date(meetingEnd.getTime() + 3 * 60 * 60 * 1000)

    const folders = await searchDrive(drive, 'strategy-2 (Meet Recordings folder)', {
      q: `name = 'Meet Recordings' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 1,
    })
    const folderId = folders[0]?.id

    if (folderId) {
      const files = await searchDrive(drive, 'strategy-2 (folder contents)', {
        q: [
          `'${folderId}' in parents`,
          `createdTime > '${windowStart.toISOString()}'`,
          `createdTime < '${windowEnd.toISOString()}'`,
          `trashed = false`,
        ].join(' and '),
        fields,
        orderBy: 'createdTime desc',
        pageSize: 10,
      })
      // Prefer a file with "transcript" in the name; otherwise take the most recent
      const file = files.find((f) => f.name?.toLowerCase().includes('transcript')) ?? files[0] ?? null
      if (file?.id) {
        console.log('Strategy 2 match:', file.name)
        return extractText(file, drive, auth)
      }
    } else {
      console.log('Meet Recordings folder not found')
    }
  }

  // ── Strategy 3: any Transcript file created anywhere on the same day ─────
  {
    const dayStart = new Date(meetingStart)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(meetingStart)
    dayEnd.setHours(23, 59, 59, 999)

    const files = await searchDrive(drive, 'strategy-3 (same-day Transcript)', {
      q: [
        `name contains 'Transcript'`,
        `createdTime > '${dayStart.toISOString()}'`,
        `createdTime < '${dayEnd.toISOString()}'`,
        `trashed = false`,
      ].join(' and '),
      fields,
      spaces: 'drive',
      orderBy: 'createdTime desc',
      pageSize: 10,
    })
    if (files.length > 0) {
      console.log('Strategy 3 match:', files[0].name)
      return extractText(files[0], drive, auth)
    }
  }

  console.log('No transcript found in Drive for:', meetingTitle)
  return null
}
