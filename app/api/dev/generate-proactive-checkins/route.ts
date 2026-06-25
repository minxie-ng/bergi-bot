import { createClient } from '@supabase/supabase-js'

import { generateDailyProactiveCheckins } from '@/lib/proactive-checkins'

const DEV_TELEGRAM_PLATFORM_USER_ID = '916493839'
const DEV_TELEGRAM_CHAT_ID = 916493839

type UserAccountRow = {
  user_id: string
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

function isAuthorized(request: Request): boolean {
  if (process.env.LOCAL_TEST_MODE === 'true') {
    return true
  }

  const cronSecret = process.env.CRON_SECRET
  const querySecret = new URL(request.url).searchParams.get('secret')

  return Boolean(cronSecret && querySecret === cronSecret)
}

async function handleGenerateProactiveCheckins(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()
    const { data: userAccount, error: userAccountError } = await supabase
      .from('user_accounts')
      .select('user_id')
      .eq('platform', 'telegram')
      .eq('platform_user_id', DEV_TELEGRAM_PLATFORM_USER_ID)
      .maybeSingle()

    if (userAccountError) {
      throw userAccountError
    }

    if (!userAccount) {
      return Response.json({ success: false, error: 'Telegram user account not found' }, { status: 404 })
    }

    const rows = await generateDailyProactiveCheckins({
      supabase,
      userId: (userAccount as UserAccountRow).user_id,
      telegramChatId: DEV_TELEGRAM_CHAT_ID,
      platform: 'telegram',
    })

    return Response.json({
      success: true,
      generated: rows.length,
      count: rows.length,
      rows: rows.map((row) => ({
        id: row.id,
        block: row.block,
        scheduled_for: row.scheduled_for,
        timezone: row.timezone,
        status: row.status,
        message_type: row.message_type,
      })),
    })
  } catch (error) {
    console.error('Dev proactive check-in generation failed:', error)
    return Response.json({ success: false, error: 'Failed to generate proactive check-ins' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handleGenerateProactiveCheckins(request)
}

export async function POST(request: Request) {
  return handleGenerateProactiveCheckins(request)
}
