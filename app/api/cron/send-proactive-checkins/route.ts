import { createClient } from '@supabase/supabase-js'

import { getRecentLifeThreadNotes } from '@/lib/life-thread-notes'
import { selectProactiveCheckinMessage } from '@/lib/proactive-message-templates'

type ProactiveCheckinRow = {
  id: string
  user_id: string
  platform: string
  telegram_chat_id: number
  block: string
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram sendMessage request failed: ${response.status}`)
  }
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw new Error('Missing CRON_SECRET')
  }

  const authorization = request.headers.get('authorization')
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const querySecret = new URL(request.url).searchParams.get('secret')

  return bearerToken === cronSecret || querySecret === cronSecret
}

async function getRecentSentProactiveMessages(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  platform: string
  telegramChatId: number
}): Promise<string[]> {
  const { supabase, userId, platform, telegramChatId } = params
  const { data, error } = await supabase
    .from('proactive_checkins')
    .select('message_text')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('telegram_chat_id', telegramChatId)
    .eq('status', 'sent')
    .not('message_text', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(5)

  if (error) {
    throw error
  }

  return (data ?? [])
    .map((row) => row.message_text)
    .filter((messageText): messageText is string => typeof messageText === 'string')
}

async function getRecentProactiveContextNotes(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}) {
  const notes = await getRecentLifeThreadNotes({
    supabase: params.supabase,
    userId: params.userId,
    limit: 5,
  })
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000

  return notes.filter((note) => Date.parse(note.created_at) >= sevenDaysAgoMs)
}

async function handleSendProactiveCheckins(request: Request) {
  try {
    if (!process.env.CRON_SECRET) {
      return Response.json({ success: false, error: 'Missing CRON_SECRET' }, { status: 500 })
    }

    if (!isAuthorized(request)) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()
    const nowIso = new Date().toISOString()

    const { data: dueCheckins, error: dueCheckinsError } = await supabase
      .from('proactive_checkins')
      .select('id, user_id, platform, telegram_chat_id, block')
      .eq('status', 'scheduled')
      .lte('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true })
      .limit(10)

    if (dueCheckinsError) {
      throw dueCheckinsError
    }

    let sent = 0
    let failed = 0

    for (const checkin of (dueCheckins ?? []) as ProactiveCheckinRow[]) {
      const claimTime = new Date().toISOString()
      const { data: claimedCheckin, error: claimError } = await supabase
        .from('proactive_checkins')
        .update({
          status: 'sending',
          updated_at: claimTime,
        })
        .eq('id', checkin.id)
        .eq('status', 'scheduled')
        .select('id, user_id, platform, telegram_chat_id, block')
        .maybeSingle()

      if (claimError) {
        console.error('Failed to claim proactive check-in:', claimError)
        failed += 1
        continue
      }

      if (!claimedCheckin) {
        continue
      }

      const recentMessages = await getRecentSentProactiveMessages({
        supabase,
        userId: claimedCheckin.user_id,
        platform: claimedCheckin.platform,
        telegramChatId: claimedCheckin.telegram_chat_id,
      })
      const recentNotes = await getRecentProactiveContextNotes({
        supabase,
        userId: claimedCheckin.user_id,
      })
      const messageText = selectProactiveCheckinMessage({
        block: claimedCheckin.block,
        recentMessages,
        recentNotes,
      })

      try {
        await sendTelegramMessage(claimedCheckin.telegram_chat_id, messageText)

        const sentTime = new Date().toISOString()
        const { error: sentError } = await supabase
          .from('proactive_checkins')
          .update({
            status: 'sent',
            sent_at: sentTime,
            message_text: messageText,
            updated_at: sentTime,
          })
          .eq('id', claimedCheckin.id)

        if (sentError) {
          throw sentError
        }

        sent += 1
      } catch (error) {
        console.error('Failed to send proactive check-in:', error)

        const failedTime = new Date().toISOString()
        const { error: failedUpdateError } = await supabase
          .from('proactive_checkins')
          .update({
            status: 'failed',
            updated_at: failedTime,
          })
          .eq('id', claimedCheckin.id)

        if (failedUpdateError) {
          console.error('Failed to mark proactive check-in as failed:', failedUpdateError)
        }

        failed += 1
      }
    }

    return Response.json({
      success: true,
      checked: dueCheckins?.length ?? 0,
      sent,
      failed,
    })
  } catch (error) {
    console.error('Send proactive check-ins cron error:', error)
    return Response.json({ success: false, error: 'Failed to send proactive check-ins' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handleSendProactiveCheckins(request)
}

export async function POST(request: Request) {
  return handleSendProactiveCheckins(request)
}
