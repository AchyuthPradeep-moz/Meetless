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

// Runs a Drive files.list query and returns matching files.
async function searchDrive(
  drive: ReturnType<typeof google.drive>,
  params: Parameters<ReturnType<typeof google.drive>['files']['list']>[0]
): Promise<DriveFile[]> {
  const { data } = await drive.files.list(params)
  return (data.files ?? []) as DriveFile[]
}

// Fetches the transcript for a meeting from the organiser's Google Drive.
// All strategies require a title match to avoid returning a transcript from
// a different meeting that happened on the same day.
//
// Strategy 1: first 2 words of title + "Transcript" — whole Drive, no time filter.
// Strategy 2: first word only + "Transcript" — whole Drive, ±2h time window.
// Strategy 3: first word + "Transcript" — Meet Recordings folder only, ±2h time window.
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
  const windowStart = new Date(meetingStart.getTime() - 2 * 60 * 60 * 1000)
  const windowEnd = new Date(meetingEnd.getTime() + 2 * 60 * 60 * 1000)
  const fields = 'files(id, name, mimeType, createdTime)'

  // Sanitise a string for use inside a Drive query string literal
  function safe(s: string) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  const words = meetingTitle.trim().split(/\s+/)
  const firstTwo = safe(words.slice(0, 2).join(' '))
  const firstOne = safe(words[0] ?? '')

  console.log(`Searching Drive for transcript: "${meetingTitle}"`)

  // ── Strategy 1: entire Drive, first 2 words + "Transcript", no time filter ──
  {
    const files = await searchDrive(drive, {
      q: `name contains '${firstTwo}' and name contains 'Transcript' and trashed = false`,
      fields,
      spaces: 'drive',
      orderBy: 'createdTime desc',
      pageSize: 5,
    })
    console.log('Strategy 1 result:', files.map((f) => f.name))
    if (files.length > 0) {
      console.log('Final match:', files[0].name)
      return extractText(files[0], drive, auth)
    }
  }

  // ── Strategy 2: entire Drive, first word + "Transcript", ±2h time window ──
  {
    const files = await searchDrive(drive, {
      q: [
        `name contains '${firstOne}'`,
        `name contains 'Transcript'`,
        `createdTime > '${windowStart.toISOString()}'`,
        `createdTime < '${windowEnd.toISOString()}'`,
        `trashed = false`,
      ].join(' and '),
      fields,
      spaces: 'drive',
      orderBy: 'createdTime desc',
      pageSize: 5,
    })
    console.log('Strategy 2 result:', files.map((f) => f.name))
    if (files.length > 0) {
      console.log('Final match:', files[0].name)
      return extractText(files[0], drive, auth)
    }
  }

  // ── Strategy 3: Meet Recordings folder, first word + "Transcript", ±2h window ──
  {
    const folders = await searchDrive(drive, {
      q: `name = 'Meet Recordings' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 1,
    })
    const folderId = folders[0]?.id

    if (folderId) {
      const files = await searchDrive(drive, {
        q: [
          `'${folderId}' in parents`,
          `name contains '${firstOne}'`,
          `name contains 'Transcript'`,
          `createdTime > '${windowStart.toISOString()}'`,
          `createdTime < '${windowEnd.toISOString()}'`,
          `trashed = false`,
        ].join(' and '),
        fields,
        orderBy: 'createdTime desc',
        pageSize: 10,
      })
      console.log('Strategy 3 result:', files.map((f) => f.name))
      if (files.length > 0) {
        console.log('Final match:', files[0].name)
        return extractText(files[0], drive, auth)
      }
    } else {
      console.log('Strategy 3: Meet Recordings folder not found')
    }
  }

  console.log('Final match: none found')
  return null
}
