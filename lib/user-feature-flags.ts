import type { SupabaseClient } from '@supabase/supabase-js'

export type UserFeatureFlags = {
  user_id: string
  chat_enabled: boolean
  memory_enabled: boolean
  reminders_enabled: boolean
  voice_enabled: boolean
  photo_enabled: boolean
  proactive_enabled: boolean
  finance_enabled: boolean
  calendar_enabled: boolean
  notion_enabled: boolean
  alpha_enabled: boolean
  alpha_expires_at: string | null
  created_at: string
  updated_at: string
}

export type OnboardingStatus = 'not_started' | 'awaiting_name' | 'choosing_proactive' | 'choosing_calendar' | 'complete'
export type ProactivePreference = 'light' | 'off'

export function isOwnerTelegramUser(telegramUserId: number): boolean {
  const ownerTelegramUserId = process.env.OWNER_TELEGRAM_USER_ID?.trim()

  if (!ownerTelegramUserId) {
    return false
  }

  return ownerTelegramUserId === String(telegramUserId)
}

function getDefaultFeatureFlags(isOwner: boolean) {
  return {
    chat_enabled: true,
    memory_enabled: true,
    reminders_enabled: true,
    voice_enabled: true,
    photo_enabled: true,
    proactive_enabled: false,
    finance_enabled: true,
    calendar_enabled: isOwner,
    notion_enabled: isOwner,
    alpha_enabled: true,
    alpha_expires_at: null,
  }
}

function buildDefaultFeatureFlags(params: { userId: string; isOwner: boolean }): UserFeatureFlags {
  const now = new Date().toISOString()

  return {
    user_id: params.userId,
    ...getDefaultFeatureFlags(params.isOwner),
    created_at: now,
    updated_at: now,
  }
}

function getSupabaseErrorMetadata(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown } | null
  const code = typeof candidate?.code === 'string' ? candidate.code : ''
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''

  return { code, message }
}

function isMissingAlphaFoundationTableError(error: unknown, tableName: string): boolean {
  const { code, message } = getSupabaseErrorMetadata(error)
  const mentionsExpectedTable = message.includes(tableName)

  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    (mentionsExpectedTable && message.includes('could not find the table')) ||
    (mentionsExpectedTable && message.includes('schema cache')) ||
    (mentionsExpectedTable && message.includes('relation') && message.includes('does not exist'))
  )
}

function logMissingAlphaFoundationTable(context: string, tableName: string, error: unknown): void {
  const { code, message } = getSupabaseErrorMetadata(error)
  console.warn('alpha_foundation_table_missing', {
    context,
    table: tableName,
    code: code || undefined,
    message: message ? message.slice(0, 160) : undefined,
  })
}

function logAlphaFoundationSupabaseError(context: string, tableName: string, error: unknown): void {
  const { code, message } = getSupabaseErrorMetadata(error)
  console.warn('alpha_foundation_supabase_error', {
    context,
    table: tableName,
    code: code || undefined,
    message: message ? message.slice(0, 160) : undefined,
  })
}

export async function getFeatureFlags(params: {
  supabase: SupabaseClient
  userId: string
}): Promise<UserFeatureFlags | null> {
  const { data, error } = await params.supabase
    .from('user_feature_flags')
    .select('*')
    .eq('user_id', params.userId)
    .maybeSingle()

  if (error) {
    if (isMissingAlphaFoundationTableError(error, 'user_feature_flags')) {
      logMissingAlphaFoundationTable('get_feature_flags', 'user_feature_flags', error)
      return null
    }

    logAlphaFoundationSupabaseError('get_feature_flags', 'user_feature_flags', error)
    throw error
  }

  return data as UserFeatureFlags | null
}

export async function ensureDefaultFeatureFlags(params: {
  supabase: SupabaseClient
  userId: string
  isOwner: boolean
}): Promise<UserFeatureFlags> {
  const existingFlags = await getFeatureFlags(params)

  if (existingFlags) {
    return existingFlags
  }

  const { data, error } = await params.supabase
    .from('user_feature_flags')
    .insert({
      user_id: params.userId,
      ...getDefaultFeatureFlags(params.isOwner),
    })
    .select('*')
    .single()

  if (!error && data) {
    return data as UserFeatureFlags
  }

  if (error && isMissingAlphaFoundationTableError(error, 'user_feature_flags')) {
    logMissingAlphaFoundationTable('ensure_default_feature_flags', 'user_feature_flags', error)
    return buildDefaultFeatureFlags(params)
  }

  const createdByRace = await getFeatureFlags(params)

  if (!createdByRace) {
    if (error && isMissingAlphaFoundationTableError(error, 'user_feature_flags')) {
      logMissingAlphaFoundationTable('ensure_default_feature_flags_race', 'user_feature_flags', error)
      return buildDefaultFeatureFlags(params)
    }

    if (error) {
      logAlphaFoundationSupabaseError('ensure_default_feature_flags', 'user_feature_flags', error)
    }
    throw error ?? new Error('Could not create user feature flags')
  }

  return createdByRace
}

export async function setUserProactiveFeature(params: {
  supabase: SupabaseClient
  userId: string
  enabled: boolean
}): Promise<void> {
  const { error } = await params.supabase
    .from('user_feature_flags')
    .update({
      proactive_enabled: params.enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', params.userId)

  if (error) {
    if (isMissingAlphaFoundationTableError(error, 'user_feature_flags')) {
      logMissingAlphaFoundationTable('set_user_proactive_feature', 'user_feature_flags', error)
      return
    }

    logAlphaFoundationSupabaseError('set_user_proactive_feature', 'user_feature_flags', error)
    throw error
  }
}

export async function upsertOnboardingState(params: {
  supabase: SupabaseClient
  userId: string
  status: OnboardingStatus
  preferredName?: string | null
  proactivePreference?: ProactivePreference | null
  privacyAcknowledgedAt?: string | null
}): Promise<void> {
  const { error } = await params.supabase.from('onboarding_state').upsert(
    {
      user_id: params.userId,
      status: params.status,
      preferred_name: params.preferredName ?? undefined,
      proactive_preference: params.proactivePreference ?? undefined,
      privacy_acknowledged_at: params.privacyAcknowledgedAt ?? undefined,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (error) {
    if (isMissingAlphaFoundationTableError(error, 'onboarding_state')) {
      logMissingAlphaFoundationTable('upsert_onboarding_state', 'onboarding_state', error)
      return
    }

    logAlphaFoundationSupabaseError('upsert_onboarding_state', 'onboarding_state', error)
    throw error
  }
}
