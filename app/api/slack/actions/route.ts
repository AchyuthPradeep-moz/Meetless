import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createFocusBlock } from '@/lib/calendar'
import { slackClient } from '@/lib/slack'
import type { User } from '@/types/user'

// Handles Slack interactive button actions:
//   cancel_suggest_<id>         — mark meeting as cancelled
//   keep_meeting_<id>           — acknowledge, keep meeting as scheduled
//   outcome_cancelled/async/happened_<id>
//   block_focus__<userId>__<isoStart>__<durationMins>
//   dismiss_focus__<userId>__<isoStart>__<durationMins>
//
// Returns 200 immediately to satisfy Slack's 3-second timeout,
// then processes the action in the background.
export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>

  try {
    const text = await req.text()
    // Slack sends payload as URL-encoded form data: payload=%7B%22type%22%3A...
    const payloadString = new URLSearchParams(text).get('payload')
    if (!payloadString) {
      console.error('No payload found in request body')
      return NextResponse.json({ error: 'No payload' }, { status: 400 })
    }
    payload = JSON.parse(payloadString)
  } catch (err) {
    console.error('Slack action parse error:', err)
    return NextResponse.json({ error: 'Parse error' }, { status: 400 })
  }

  const action = (payload.actions as { value?: string }[])?.[0]
  if (!action) return NextResponse.json({ ok: true })

  console.log('Slack action type:', payload.type)
  console.log('Slack action received:', action.value)

  // Fire-and-forget so Slack gets 200 within 3 seconds
  processSlackAction(payload).catch((err) => console.error('Slack action processing failed:', err))

  return NextResponse.json({ ok: true })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processSlackAction(payload: any) {
  const action = payload.actions?.[0]
  const value: string = action?.value ?? ''
  const responseUrl: string = payload.response_url ?? ''

  // ── cancel_suggest_ ──────────────────────────────────────────────────────
  if (value.startsWith('cancel_suggest_')) {
    const meetingId = value.slice('cancel_suggest_'.length)

    await supabaseAdmin
      .from('meetings')
      .update({ outcome: 'cancelled' })
      .eq('id', meetingId)

    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          text: '✅ Got it — meeting marked as cancelled. Go ahead and remove it from the calendar.',
        }),
      })
    }

  // ── keep_meeting_ ─────────────────────────────────────────────────────────
  } else if (value.startsWith('keep_meeting_')) {
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          text: '👍 Keeping the meeting as scheduled.',
        }),
      })
    }

  // ── outcome_ ─────────────────────────────────────────────────────────────
  } else if (value.startsWith('outcome_')) {
    // value format: outcome_<type>_<meetingId>  e.g. outcome_cancelled_abc123
    const withoutPrefix = value.slice('outcome_'.length)
    const underscoreIdx = withoutPrefix.indexOf('_')
    const outcomeType = withoutPrefix.slice(0, underscoreIdx)   // cancelled | async | happened
    const meetingId = withoutPrefix.slice(underscoreIdx + 1)

    const outcomeMap: Record<string, string> = {
      cancelled: 'cancelled',
      async: 'async',
      happened: 'happened',
    }
    const outcome = outcomeMap[outcomeType]
    if (!outcome) return

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('title, duration')
      .eq('id', meetingId)
      .single()

    await supabaseAdmin
      .from('meetings')
      .update({ outcome })
      .eq('id', meetingId)

    const title = meeting?.title ?? 'the meeting'
    const duration = meeting?.duration ?? 0

    let confirmationText: string
    if (outcomeType === 'cancelled') {
      confirmationText = `✅ Got it! *${title}* was cancelled.\nYou saved ${duration} minutes! 🎉`
    } else if (outcomeType === 'async') {
      confirmationText = `🔄 Got it! *${title}* is going async.\nYou saved ${duration} minutes!`
    } else {
      confirmationText = `❌ Noted. *${title}* happened as planned.`
    }

    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_original: true, text: confirmationText }),
      })
    }

  // ── block_focus__ ─────────────────────────────────────────────────────────
  } else if (value.startsWith('block_focus__')) {
    // value: block_focus__<userId>__<isoStart>__<durationMins>
    const parts = value.split('__')
    const userId = parts[1]
    const isoStart = parts[2]
    const durationMins = parseInt(parts[3], 10)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single<User>()

    if (!user || !user.refresh_token) {
      if (responseUrl) {
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replace_original: true, text: '❌ Could not block focus time — Google not connected.' }),
        })
      }
      return
    }

    try {
      const startTime = new Date(isoStart)
      const endTime = new Date(startTime.getTime() + durationMins * 60 * 1000)

      await createFocusBlock(user, startTime, durationMins)

      // Set Slack status emoji for the duration of the focus block
      if (user.slack_user_id) {
        try {
          await slackClient.users.profile.set({
            user: user.slack_user_id,
            profile: {
              status_text: 'In focus mode',
              status_emoji: ':no_bell:',
              status_expiration: Math.floor(endTime.getTime() / 1000),
            } as Record<string, unknown>,
          })
        } catch (statusErr) {
          // Status emoji is best-effort — don't fail the whole action
          console.error('Failed to set Slack status:', statusErr)
        }
      }

      // Format confirmation time in IST
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
      const startIST = new Date(startTime.getTime() + IST_OFFSET_MS)
      const endIST = new Date(endTime.getTime() + IST_OFFSET_MS)
      const fmt = (d: Date) => {
        const h = d.getUTCHours() % 12 || 12
        const m = d.getUTCMinutes()
        const ap = d.getUTCHours() >= 12 ? 'pm' : 'am'
        return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`
      }

      if (responseUrl) {
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            replace_original: true,
            text: `🔕 Focus time blocked: ${fmt(startIST)}–${fmt(endIST)}. Your Slack status is set until then.`,
          }),
        })
      }
    } catch (err) {
      console.error('Failed to create focus block:', err)
      if (responseUrl) {
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replace_original: true, text: '❌ Failed to block focus time. Try reconnecting Google in Settings.' }),
        })
      }
    }

  // ── dismiss_focus__ ───────────────────────────────────────────────────────
  } else if (value.startsWith('dismiss_focus__')) {
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          text: '👍 No problem — I won\'t suggest this again today.',
        }),
      })
    }
  }
}
