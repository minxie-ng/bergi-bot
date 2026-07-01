import { generateDailyProactiveCheckins } from '@/lib/proactive-checkins'
import { isCronAuthorized as isAuthorized } from '@/lib/server/cron-auth'
import { getServiceRoleSupabase as getSupabase } from '@/lib/server/supabase'
import { isOwnerTelegramUser } from '@/lib/user-feature-flags'

type ProactivePreferenceRow = {
  user_id: string
  platform: string
  telegram_chat_id: number
  timezone: string
}

type ProactiveFeatureFlagsRow = {
  proactive_enabled: boolean
  alpha_enabled: boolean
}

async function getProactiveFeatureFlags(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<ProactiveFeatureFlagsRow | null> {
  const { data, error } = await params.supabase
    .from('user_feature_flags')
    .select('proactive_enabled, alpha_enabled')
    .eq('user_id', params.userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data as ProactiveFeatureFlagsRow | null
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
    let skippedDisabled = 0

    for (const preference of (preferences ?? []) as ProactivePreferenceRow[]) {
      try {
        const featureFlags = await getProactiveFeatureFlags({ supabase, userId: preference.user_id })
        const isOwner = isOwnerTelegramUser(preference.telegram_chat_id)

        console.log('proactive_generation_checked', {
          userId: preference.user_id,
          isOwner,
          proactiveEnabled: featureFlags?.proactive_enabled === true,
          alphaEnabled: featureFlags?.alpha_enabled === true,
          contextSources: {
            preferences: true,
            lifeNotes: false,
            calendar: false,
            reminders: false,
            finance: false,
          },
        })

        if (!featureFlags?.alpha_enabled || !featureFlags.proactive_enabled) {
          skippedDisabled += 1
          continue
        }

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
          platform: preference.platform,
          hasUserId: Boolean(preference.user_id),
          hasTelegramChatId: preference.telegram_chat_id !== undefined,
          error,
        })
        failed += 1
      }
    }

    return Response.json({
      success: true,
      checked: preferences?.length ?? 0,
      generated,
      skippedDisabled,
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
