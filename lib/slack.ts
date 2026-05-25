import { WebClient } from '@slack/web-api'

// Reuse a single WebClient instance throughout the app
export const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN)

// Sends a plain DM to a Slack user
export async function sendDM(slackUserId: string, text: string): Promise<void> {
  await slackClient.chat.postMessage({
    channel: slackUserId,
    text,
  })
}

type DigestMeeting = {
  id: string
  title: string
  start_time: string
  duration: number
  classification: string | null
}

const CLASS_EMOJI: Record<string, string> = {
  important: '🟢',
  async: '🟣',
  passive: '🔵',
}
const CLASS_LABEL: Record<string, string> = {
  important: 'Important',
  async: 'Async Candidate',
  passive: 'Passive',
}

// Sends the morning digest DM with a Block Kit layout showing today's meetings
export async function sendMorningDigest(
  slackUserId: string,
  firstName: string,
  meetings: DigestMeeting[]
): Promise<void> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Asia/Kolkata',
    })

    const hourNum = parseInt(
      new Date().toLocaleString('en-IN', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      })
    )
    const greeting =
      hourNum < 12 ? 'Good morning' :
      hourNum < 17 ? 'Good afternoon' :
      'Good evening'

    if (!meetings.length) {
      await slackClient.chat.postMessage({
        channel: slackUserId,
        text: `${greeting} ${firstName}! ☀️ You have no meetings today. Enjoy the focus time! 🎉`,
      })
      return
    }

    const asyncCount = meetings.filter((m) => m.classification === 'async').length

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${greeting} ${firstName}! ☀️`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Here are your meetings for today — ${dateStr}`,
        },
      },
      { type: 'divider' },
    ]

    meetings.forEach((m, i) => {
      const time = new Date(m.start_time).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
      const emoji = CLASS_EMOJI[m.classification ?? ''] ?? '⚪'
      const label = CLASS_LABEL[m.classification ?? ''] ?? 'Unclassified'

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${m.title}*\n${emoji} ${label} • ${time} • ${m.duration} min`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View Details' },
          url: `${baseUrl}/meetings/${m.id}`,
          action_id: `view_meeting_${i}`,
        },
      })
    })

    blocks.push({ type: 'divider' })

    if (asyncCount > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `You have *${asyncCount}* meeting${asyncCount === 1 ? '' : 's'} that could be async today`,
        },
      })
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open Dashboard →' },
          url: `${baseUrl}/dashboard`,
          action_id: 'open_dashboard',
        },
      ],
    })

    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `${greeting} ${firstName}! ☀️ You have ${meetings.length} meeting${meetings.length === 1 ? '' : 's'} today.`,
      blocks,
    })
  } catch (err) {
    console.error(`Failed to send morning digest to ${slackUserId}:`, err)
  }
}

// Sends a meeting reminder DM with an optional Join Meeting button.
// minutes reflects the user's own reminder_minutes preference.
export async function sendMeetingReminder(
  slackUserId: string,
  title: string,
  meetLink: string | null,
  minutes = 10
): Promise<void> {
  const text = `⏰ Your meeting *${title}* starts in ${minutes} minutes!`
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ]

    if (meetLink) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Join Meeting' },
            url: meetLink,
            action_id: 'join_meeting',
          },
        ],
      })
    }

    await slackClient.chat.postMessage({
      channel: slackUserId,
      text,
      blocks,
    })
  } catch (err) {
    console.error(`Failed to send reminder to ${slackUserId}:`, err)
  }
}

// Sends a nudge DM for an upcoming async meeting, with a button to add a status update
export async function sendAsyncNudge(
  slackUserId: string,
  title: string,
  meetingId: string
): Promise<void> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const url = `${baseUrl}/async/${meetingId}`

  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `📋 *${title}* starts in 30 minutes. Please add your status update before the meeting.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *${title}* starts in 30 minutes.\nPlease add your status update before the meeting.`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Add my status →' },
            url,
            action_id: 'add_async_status',
          },
        },
      ],
    })
  } catch (err) {
    console.error(`Failed to send async nudge to ${slackUserId}:`, err)
  }
}

// Sends a follow-up outcome-tracking DM after the draft is forwarded to the organiser.
// User picks one of three buttons; the result is handled in /api/slack/actions.
export async function sendOutcomeTracking(
  slackUserId: string,
  meetingTitle: string,
  meetingId: string,
  outcomeMessage?: string
): Promise<void> {
  try {
    const messageText = outcomeMessage ?? `📊 We'll track what happens with this meeting.\nLet us know the outcome when you find out:`
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `✉️ Message sent — track outcome for "${meetingTitle}"`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: messageText,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Meeting cancelled', emoji: true },
              style: 'primary',
              action_id: 'outcome_cancelled',
              value: `outcome_cancelled_${meetingId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '🔄 Going async', emoji: true },
              action_id: 'outcome_async',
              value: `outcome_async_${meetingId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Had meeting anyway', emoji: true },
              style: 'danger',
              action_id: 'outcome_happened',
              value: `outcome_happened_${meetingId}`,
            },
          ],
        },
      ],
    })
  } catch (err) {
    console.error(`Failed to send outcome tracking to ${slackUserId}:`, err)
  }
}

// Posts the async status board summary to the shared #meeting channel at meeting start time.
export async function sendBoardToChannel(
  meetingId: string,
  meetingTitle: string,
  submittedCount: number,
  totalCount: number,
  summary: string | null
): Promise<void> {
  const channelId = process.env.SLACK_MEETING_CHANNEL_ID
  if (!channelId) {
    console.error('SLACK_MEETING_CHANNEL_ID not set')
    return
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 ${meetingTitle} is starting now!`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Team status updates — *${submittedCount} of ${totalCount}* members submitted`,
      },
    },
  ]

  if (summary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `_${summary}_` },
    })
  }

  blocks.push({ type: 'divider' })
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View Full Status Board →' },
        url: `${baseUrl}/async/${meetingId}`,
        style: 'primary',
        action_id: 'view_board_from_channel',
      },
    ],
  })

  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `📋 ${meetingTitle} is starting now! ${submittedCount}/${totalCount} members submitted.`,
      blocks,
    })
  } catch (err) {
    console.error(`Failed to post board to channel ${channelId}:`, err)
  }
}

// Sends a passive meeting summary DM to an attendee who didn't need to be present.
export async function sendMeetingSummary(
  slackUserId: string,
  meetingTitle: string,
  summaryText: string,
  decisions: string[],
  actionItems: string[],
  summaryUrl: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 ${meetingTitle} — Summary`, emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: summaryText },
    },
  ]

  if (decisions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Decisions:*\n${decisions.map((d) => `• ${d}`).join('\n')}`,
      },
    })
  }

  if (actionItems.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Action Items:*\n${actionItems.map((a) => `• ${a}`).join('\n')}`,
      },
    })
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View full summary →' },
        url: summaryUrl,
        action_id: 'view_meeting_summary',
        style: 'primary',
      },
    ],
  })

  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `📋 Summary ready for ${meetingTitle}`,
      blocks,
    })
  } catch (err) {
    console.error(`Failed to send meeting summary to ${slackUserId}:`, err)
  }
}

// Sent to the organiser when ALL attendees have submitted with zero blockers.
// The organiser picks one of two buttons; handled in /api/slack/actions.
export async function sendCancellationSuggestion(
  slackUserId: string,
  meetingTitle: string,
  meetingId: string,
  count: number
): Promise<void> {
  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `✅ All ${count} members submitted. No blockers. This meeting may not be needed.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *All ${count} ${count === 1 ? 'member' : 'members'} submitted. No blockers flagged.*\n*${meetingTitle}* — this meeting may not be needed.`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Suggest Cancelling', emoji: true },
              style: 'primary',
              action_id: 'cancel_suggest',
              value: `cancel_suggest_${meetingId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Keep as is', emoji: true },
              action_id: 'keep_meeting',
              value: `keep_meeting_${meetingId}`,
            },
          ],
        },
      ],
    })
  } catch (err) {
    console.error(`Failed to send cancellation suggestion to ${slackUserId}:`, err)
  }
}

// Suggests blocking a free gap as focus time. User picks Block it or Not now.
// value encodes: block_focus_<userId>_<isoStart>_<durationMins>
export async function sendFocusSuggestion(
  slackUserId: string,
  userId: string,
  dateLabel: string,    // e.g. "Wednesday, 26 May"
  meetingCount: number,
  gaps: Array<{
    startLabel: string  // e.g. "10am"
    endLabel: string    // e.g. "12pm"
    isoStart: string    // UTC ISO string, used in action value
  }>,
): Promise<void> {
  // Each gap button blocks exactly 60 minutes from that start time
  const BLOCK_MINS = 60

  // Build one button per gap; Slack allows max 5 elements per actions block
  const gapButtons = gaps.map((g, i) => ({
    type: 'button',
    text: { type: 'plain_text', text: `🔕 ${g.startLabel}–${g.endLabel}`, emoji: true },
    style: 'primary' as const,
    action_id: `block_focus_${i}`,
    value: `block_focus__${userId}__${g.isoStart}__${BLOCK_MINS}`,
  }))

  const dismissButton = {
    type: 'button',
    text: { type: 'plain_text', text: 'Not now', emoji: false },
    action_id: 'dismiss_focus',
    value: `dismiss_focus__${userId}`,
  }

  // Chunk gap buttons into groups of 5 (Slack actions block limit)
  const chunks: typeof gapButtons[] = []
  for (let i = 0; i < gapButtons.length; i += 5) {
    chunks.push(gapButtons.slice(i, i + 5))
  }
  // Append dismiss to the last chunk (it fits since we have at most 5 gap buttons per chunk)
  const lastChunk = chunks[chunks.length - 1]
  if (lastChunk.length < 5) {
    lastChunk.push(dismissButton as typeof gapButtons[0])
  } else {
    chunks.push([dismissButton as typeof gapButtons[0]])
  }

  const actionBlocks = chunks.map((chunk) => ({
    type: 'actions',
    elements: chunk,
  }))

  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `🎯 You have ${meetingCount} meetings on ${dateLabel}. Pick a free slot to block as focus time.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎯 You have *${meetingCount} meetings* on ${dateLabel}.\nPick a free slot to block as *1-hour focus time*:`,
          },
        },
        ...actionBlocks,
      ],
    })
  } catch (err) {
    console.error(`Failed to send focus suggestion to ${slackUserId}:`, err)
  }
}

// Confirms to the meeting host that summaries have been dispatched.
export async function sendSummaryConfirmation(
  slackUserId: string,
  meetingTitle: string,
  count: number
): Promise<void> {
  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `✅ Summary for *${meetingTitle}* has been sent to ${count} passive attendee${count === 1 ? '' : 's'}.`,
    })
  } catch (err) {
    console.error(`Failed to send summary confirmation to ${slackUserId}:`, err)
  }
}

