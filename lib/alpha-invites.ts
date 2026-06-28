import type { SupabaseClient } from '@supabase/supabase-js'

export type AlphaInviteClaimResult = 'claimed' | 'already_claimed_by_user'

export type AlphaInviteRow = {
  id: string
  code: string
  status: string
  max_uses: number
  used_count: number
  invited_label: string | null
  created_by_user_id: string | null
  claimed_by_user_id: string | null
  claimed_by_telegram_user_id: string | null
  expires_at: string | null
  claimed_at: string | null
  created_at: string
  updated_at: string
}

export class AlphaInviteError extends Error {
  category: 'invalid_or_expired' | 'already_used' | 'database_error'

  constructor(category: AlphaInviteError['category']) {
    super(category)
    this.name = 'AlphaInviteError'
    this.category = category
  }
}

export function normalizeAlphaInviteCode(code: string): string | null {
  const normalized = code.trim()

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) {
    return null
  }

  return normalized
}

export async function getInviteByCode(params: {
  supabase: SupabaseClient
  code: string
}): Promise<AlphaInviteRow | null> {
  const { data, error } = await params.supabase
    .from('alpha_invites')
    .select('*')
    .eq('code', params.code)
    .maybeSingle()

  if (error) {
    throw new AlphaInviteError('database_error')
  }

  return data as AlphaInviteRow | null
}

export function isInviteClaimable(invite: AlphaInviteRow): boolean {
  const expiresAtMs = invite.expires_at ? Date.parse(invite.expires_at) : null

  return (
    invite.status === 'active' &&
    invite.used_count < invite.max_uses &&
    (expiresAtMs === null || expiresAtMs > Date.now())
  )
}

export async function claimAlphaInvite(params: {
  supabase: SupabaseClient
  code: string
  userId: string
  telegramUserId: string
}): Promise<AlphaInviteClaimResult> {
  const invite = await getInviteByCode({ supabase: params.supabase, code: params.code })

  if (!invite || !isInviteClaimable(invite)) {
    if (invite?.claimed_by_user_id === params.userId || invite?.claimed_by_telegram_user_id === params.telegramUserId) {
      await ensureAlphaInviteFeatureFlags({ supabase: params.supabase, userId: params.userId })
      return 'already_claimed_by_user'
    }

    throw new AlphaInviteError(
      invite !== null && invite.used_count >= invite.max_uses ? 'already_used' : 'invalid_or_expired'
    )
  }

  const nextUsedCount = invite.used_count + 1
  const nextStatus = nextUsedCount >= invite.max_uses ? 'used' : 'active'
  const now = new Date().toISOString()
  const { data, error } = await params.supabase
    .from('alpha_invites')
    .update({
      used_count: nextUsedCount,
      status: nextStatus,
      claimed_by_user_id: params.userId,
      claimed_by_telegram_user_id: params.telegramUserId,
      claimed_at: now,
      updated_at: now,
    })
    .eq('id', invite.id)
    .eq('status', 'active')
    .eq('used_count', invite.used_count)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new AlphaInviteError('database_error')
  }

  if (!data) {
    throw new AlphaInviteError('already_used')
  }

  await ensureAlphaInviteFeatureFlags({ supabase: params.supabase, userId: params.userId })

  return 'claimed'
}

export async function isTelegramUserAlphaAllowed(params: {
  supabase: SupabaseClient
  userId: string
  telegramUserId: string
}): Promise<boolean> {
  const { data: flags, error: flagsError } = await params.supabase
    .from('user_feature_flags')
    .select('alpha_enabled')
    .eq('user_id', params.userId)
    .maybeSingle()

  if (!flagsError && flags?.alpha_enabled === true) {
    return true
  }

  const { data: invite, error: inviteError } = await params.supabase
    .from('alpha_invites')
    .select('id')
    .eq('claimed_by_telegram_user_id', params.telegramUserId)
    .limit(1)
    .maybeSingle()

  if (inviteError) {
    throw new AlphaInviteError('database_error')
  }

  return Boolean(invite)
}

async function ensureAlphaInviteFeatureFlags(params: { supabase: SupabaseClient; userId: string }): Promise<void> {
  const { error } = await params.supabase.from('user_feature_flags').upsert(
    {
      user_id: params.userId,
      chat_enabled: true,
      memory_enabled: true,
      reminders_enabled: true,
      voice_enabled: true,
      photo_enabled: true,
      proactive_enabled: false,
      finance_enabled: true,
      calendar_enabled: false,
      notion_enabled: false,
      alpha_enabled: true,
      alpha_expires_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (error) {
    throw new AlphaInviteError('database_error')
  }
}
