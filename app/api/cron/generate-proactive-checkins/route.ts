import { createClient } from '@supabase/supabase-js'

import { generateDailyProactiveCheckins } from '@/lib/proactive-checkins'

type ProactivePreferenceRow = {
  user_id: string
  platform: string
  telegram_chat_id: number
  timezone: string
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
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw new Error('Missing CRON_SECRET')
  }

  const authorization = request.headers.get('authorization')
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const querySecret = new URL(request.url).searchParams.get('secret')

  return bearerToken === cronSecret || querySecret === cronSecret
}

async function handleGenerateProactiveCheckins(request: Request) {
  try {
    if (!process.env.CRON_SECRET) {
      return Response.json({ success: false, error: 'Missing CRON_SECRET' }, { status: 500 })
    }

    if (!isAuthorized(request)) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()
    const { data: preferences, error: preferencesError } = await supabase
      .from('proactive_preferences')
      .select('user_id, platform, telegram_chat_id, timezone')
      .eq('enabled', true)
      .eq('platform', 'telegram')

    if (preferencesError) {
      throw preferencesError
    }

    let generated = 0
    let failed = 0

    for (const preference of (preferences ?? []) as ProactivePreferenceRow[]) {
      try {
        const rows = await generateDailyProactiveCheckins({
          supabase,
          userId: preference.user_id,
          telegramChatId: preference.telegram_chat_id,
          platform: preference.platform,
          timezone: preference.timezone,
        })

        generated += rows.length
      } catch (error) {
        console.error('Failed to generate proactive check-ins for preference:', {
          userId: preference.user_id,
          platform: preference.platform,
          telegramChatId: preference.telegram_chat_id,
          error,
        })
        failed += 1
      }
    }

    return Response.json({
      success: true,
      checked: preferences?.length ?? 0,
      generated,
      failed,
    })
  } catch (error) {
    console.error('Generate proactive check-ins cron error:', error)
    return Response.json({ success: false, error: 'Failed to generate proactive check-ins' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handleGenerateProactiveCheckins(request)
}

export async function POST(request: Request) {
  return handleGenerateProactiveCheckins(request)
}
