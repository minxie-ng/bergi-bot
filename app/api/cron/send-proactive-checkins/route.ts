import { createClient } from '@supabase/supabase-js'

type ProactiveCheckinRow = {
  id: string
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

function getProactiveCheckinMessage(block: string): string {
  switch (block) {
    case 'morning':
      return 'morning min, quick check-in — what’s the main thing you want to get done today?'
    case 'afternoon':
      return 'quick check-in — how’s the day going so far?'
    case 'evening':
      return 'end-of-day check-in: anything worth remembering from today?'
    default:
      return 'quick check-in — how’s your day going?'
  }
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
      .select('id, telegram_chat_id, block')
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
        .select('id, telegram_chat_id, block')
        .maybeSingle()

      if (claimError) {
        console.error('Failed to claim proactive check-in:', claimError)
        failed += 1
        continue
      }

      if (!claimedCheckin) {
        continue
      }

      const messageText = getProactiveCheckinMessage(claimedCheckin.block)

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
