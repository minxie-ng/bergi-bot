import { createClient } from '@supabase/supabase-js'

type ReminderRow = {
  id: string
  telegram_chat_id: number
  reminder_text: string
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

export async function GET(request: Request) {
  try {
    if (!process.env.CRON_SECRET) {
      return Response.json({ ok: false, error: 'Missing CRON_SECRET' }, { status: 500 })
    }

    if (!isAuthorized(request)) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()
    const nowIso = new Date().toISOString()

    const { data: dueReminders, error: dueRemindersError } = await supabase
      .from('reminders')
      .select('id, telegram_chat_id, reminder_text')
      .eq('status', 'pending')
      .lte('remind_at', nowIso)
      .limit(10)

    if (dueRemindersError) {
      throw dueRemindersError
    }

    let sent = 0
    let failed = 0
    let skipped = 0

    for (const reminder of (dueReminders ?? []) as ReminderRow[]) {
      const claimTime = new Date().toISOString()
      const { data: claimedReminder, error: claimError } = await supabase
        .from('reminders')
        .update({
          status: 'sending',
          updated_at: claimTime,
        })
        .eq('id', reminder.id)
        .eq('status', 'pending')
        .select('id, telegram_chat_id, reminder_text')
        .maybeSingle()

      if (claimError) {
        console.error('Failed to claim reminder:', claimError)
        failed += 1
        continue
      }

      if (!claimedReminder) {
        skipped += 1
        continue
      }

      try {
        await sendTelegramMessage(claimedReminder.telegram_chat_id, `Min, reminder: ${claimedReminder.reminder_text}`)

        const sentTime = new Date().toISOString()
        const { error: sentError } = await supabase
          .from('reminders')
          .update({
            status: 'sent',
            sent_at: sentTime,
            updated_at: sentTime,
          })
          .eq('id', claimedReminder.id)

        if (sentError) {
          throw sentError
        }

        sent += 1
      } catch (error) {
        console.error('Failed to send reminder:', error)

        const failedTime = new Date().toISOString()
        const { error: failedUpdateError } = await supabase
          .from('reminders')
          .update({
            status: 'failed',
            updated_at: failedTime,
          })
          .eq('id', claimedReminder.id)

        if (failedUpdateError) {
          console.error('Failed to mark reminder as failed:', failedUpdateError)
        }

        failed += 1
      }
    }

    return Response.json({
      ok: true,
      checked: dueReminders?.length ?? 0,
      sent,
      failed,
      skipped,
    })
  } catch (error) {
    console.error('Send reminders cron error:', error)
    return Response.json({ ok: false, error: 'Failed to send reminders' }, { status: 500 })
  }
}
