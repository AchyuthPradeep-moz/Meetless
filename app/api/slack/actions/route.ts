import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendDM, sendOutcomeTracking } from '@/lib/slack'

// Handles all Slack interactive button actions:
//   approve_<id>         — send draft to organiser, start outcome tracking
//   discard_<id>         — clear the draft
//   outcome_cancelled_<id> / outcome_async_<id> / outcome_happened_<id>
export async function POST(req: NextRequest) {
  const text = await req.text()
  const payload = JSON.parse(new URLSearchParams(text).get('payload') ?? '{}')
  const action = payload.actions?.[0]

  if (!action) return NextResponse.json({ ok: true })

  const value: string = action.value ?? ''
  const responseUrl: string = payload.response_url ?? ''
  const senderSlackUserId: string = payload.user?.id ?? ''

  // ── approve_ ────────────────────────────────────────────────────────────────
  if (value.startsWith('approve_')) {
    const meetingId = value.slice('approve_'.length)

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('title, draft_message, organiser_email, classification')
      .eq('id', meetingId)
      .single()

    let organiserSlackUserId: string | null = null

    if (meeting?.draft_message && meeting?.organiser_email) {
      const { data: organiserUser } = await supabaseAdmin
        .from('users')
        .select('id, slack_user_id')
        .eq('email', meeting.organiser_email)
        .single()

      if (organiserUser?.slack_user_id) {
        await sendDM(organiserUser.slack_user_id, meeting.draft_message)
        organiserSlackUserId = organiserUser.slack_user_id
        console.log(`Draft sent to organiser ${meeting.organiser_email}`)
      } else {
        console.log(`Organiser ${meeting.organiser_email} not on Meetless — cannot send via Slack`)
      }
    }

    // Look up the sender's internal user id so we can relay replies back to them
    const { data: senderUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('slack_user_id', senderSlackUserId)
      .single()

    await supabaseAdmin
      .from('meetings')
      .update({
        draft_sent: true,
        draft_sent_to_slack_user_id: organiserSlackUserId,
        draft_sent_by_user_id: senderUser?.id ?? null,
      })
      .eq('id', meetingId)

    // Follow-up outcome tracking DM to the person who approved
    if (senderSlackUserId && meeting?.title) {
      await sendOutcomeTracking(senderSlackUserId, meeting.title, meetingId)
    }

    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_original: true, text: '✅ Message sent to organiser' }),
      })
    }

  // ── discard_ ────────────────────────────────────────────────────────────────
  } else if (value.startsWith('discard_')) {
    const meetingId = value.slice('discard_'.length)

    await supabaseAdmin
      .from('meetings')
      .update({ draft_message: null })
      .eq('id', meetingId)

    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_original: true, text: '🗑️ Draft discarded' }),
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
    if (!outcome) return NextResponse.json({ ok: true })

    await supabaseAdmin
      .from('meetings')
      .update({ outcome })
      .eq('id', meetingId)

    const confirmationText: Record<string, string> = {
      cancelled: '✅ Great! Meeting cancelled. You saved everyone\'s time! 🎉',
      async: '🔄 Nice! Meeting converted to async. Status board is ready.',
      happened: '❌ Noted. The AI will learn from this for future classifications.',
    }

    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_original: true, text: confirmationText[outcomeType] }),
      })
    }
  }

  return NextResponse.json({ ok: true })
}
