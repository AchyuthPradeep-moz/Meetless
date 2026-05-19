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
        timeZone: 'UTC',
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
          url: `http://localhost:3000/meetings/${m.id}`,
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
          url: 'http://localhost:3000/dashboard',
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
  meetingId: string
): Promise<void> {
  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `📊 Track the outcome for "${meetingTitle}"`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📊 We'll track what happens with this meeting.\nLet us know the outcome when you find out:`,
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

// Sends a draft organiser message to the user for approval via Slack interactive buttons.
// NEVER sends the message automatically — user must click "Send to organiser".
export async function sendDraftMessageForApproval(
  slackUserId: string,
  meetingId: string,
  meetingTitle: string,
  draftMessage: string,
  classification: string
): Promise<void> {
  const label = classification === 'async' ? 'async candidate' : 'passive attendance'

  await slackClient.chat.postMessage({
    channel: slackUserId,
    text: `Draft message ready for "${meetingTitle}"`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `✉️ Draft message ready for ${meetingTitle}`,
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `This meeting was classified as *${label}*. Review the draft before sending.`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `> ${draftMessage.replace(/\n/g, '\n> ')}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Send to organiser' },
            style: 'primary',
            action_id: 'approve_draft',
            value: `approve_${meetingId}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Discard' },
            style: 'danger',
            action_id: 'discard_draft',
            value: `discard_${meetingId}`,
          },
        ],
      },
    ],
  })
}
