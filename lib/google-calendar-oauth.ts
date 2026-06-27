import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

import { decryptToken, encryptToken, hasTokenEncryptionKey, signValue, signaturesMatch } from './token-encryption'

export const GOOGLE_CALENDAR_INTEGRATION_PROVIDER = 'google_calendar'
export const GOOGLE_CALENDAR_OAUTH_CALENDAR_ID = 'primary'

const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const DEFAULT_GOOGLE_CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar.events'
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

export type GoogleCalendarOAuthStatus = 'connected' | 'not_connected' | 'needs_reconnect' | 'expired' | 'disconnected'

type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
}

type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
}

type GoogleCalendarIntegrationRow = {
  id: string
  user_id: string
  provider: string
  provider_account_email: string | null
  scopes: string[]
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expiry: string | null
  status: GoogleCalendarOAuthStatus
  connected_at: string | null
  disconnected_at: string | null
  last_error: string | null
}

export type GoogleCalendarAccess = {
  accessToken: string
  calendarId: string
}

export type GoogleCalendarConnectionStatus = {
  status: GoogleCalendarOAuthStatus
  email?: string | null
}

export type GoogleOAuthStatePayload = {
  userId: string
  telegramUserId: string
  chatId: number
  exp: number
  nonce: string
}

export class GoogleCalendarOAuthError extends Error {
  category:
    | 'missing_env'
    | 'missing_token_encryption_key'
    | 'invalid_state'
    | 'state_expired'
    | 'token_exchange_failed'
    | 'token_refresh_failed'
    | 'not_connected'
    | 'needs_reconnect'
    | 'database_error'

  constructor(category: GoogleCalendarOAuthError['category']) {
    super(category)
    this.name = 'GoogleCalendarOAuthError'
    this.category = category
  }
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()

  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleCalendarOAuthError('missing_env')
  }

  if (!hasTokenEncryptionKey()) {
    throw new GoogleCalendarOAuthError('missing_token_encryption_key')
  }

  const scopes = (process.env.GOOGLE_CALENDAR_SCOPES || DEFAULT_GOOGLE_CALENDAR_SCOPES)
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)

  return { clientId, clientSecret, redirectUri, scopes }
}

export function createGoogleOAuthState(params: {
  userId: string
  telegramUserId: string
  chatId: number
}): string {
  const payload: GoogleOAuthStatePayload = {
    userId: params.userId,
    telegramUserId: params.telegramUserId,
    chatId: params.chatId,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomUUID(),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = signValue(encodedPayload)

  return `${encodedPayload}.${signature}`
}

export function parseGoogleOAuthState(state: string): GoogleOAuthStatePayload {
  const [encodedPayload, signature] = state.split('.')

  if (!encodedPayload || !signature || !signaturesMatch(signValue(encodedPayload), signature)) {
    throw new GoogleCalendarOAuthError('invalid_state')
  }

  let payload: GoogleOAuthStatePayload

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as GoogleOAuthStatePayload
  } catch {
    throw new GoogleCalendarOAuthError('invalid_state')
  }

  if (!payload.userId || !payload.telegramUserId || typeof payload.chatId !== 'number' || !payload.exp) {
    throw new GoogleCalendarOAuthError('invalid_state')
  }

  if (payload.exp < Date.now()) {
    throw new GoogleCalendarOAuthError('state_expired')
  }

  return payload
}

export function buildGoogleOAuthUrl(state: string): string {
  const config = getGoogleOAuthConfig()
  const url = new URL(GOOGLE_OAUTH_AUTH_URL)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('scope', config.scopes.join(' '))
  url.searchParams.set('state', state)

  return url.toString()
}

export async function exchangeGoogleOAuthCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiry: string | null
  scopes: string[]
}> {
  const config = getGoogleOAuthConfig()
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = (await response.json()) as GoogleTokenResponse

  if (!response.ok || !data.access_token) {
    throw new GoogleCalendarOAuthError('token_exchange_failed')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : config.scopes,
  }
}

export async function getGoogleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as { email?: unknown }
    return typeof data.email === 'string' ? data.email : null
  } catch {
    return null
  }
}

async function refreshGoogleOAuthAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiry: string | null
}> {
  const config = getGoogleOAuthConfig()
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await response.json()) as GoogleTokenResponse

  if (!response.ok || !data.access_token) {
    throw new GoogleCalendarOAuthError('token_refresh_failed')
  }

  return {
    accessToken: data.access_token,
    expiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }
}

export async function getGoogleCalendarIntegration(params: {
  supabase: SupabaseClient
  userId: string
}): Promise<GoogleCalendarIntegrationRow | null> {
  const { data, error } = await params.supabase
    .from('user_integrations')
    .select(
      'id,user_id,provider,provider_account_email,scopes,access_token_encrypted,refresh_token_encrypted,token_expiry,status,connected_at,disconnected_at,last_error'
    )
    .eq('user_id', params.userId)
    .eq('provider', GOOGLE_CALENDAR_INTEGRATION_PROVIDER)
    .maybeSingle()

  if (error) {
    throw new GoogleCalendarOAuthError('database_error')
  }

  return data as GoogleCalendarIntegrationRow | null
}

export async function getGoogleCalendarConnectionStatus(params: {
  supabase: SupabaseClient
  userId: string
}): Promise<GoogleCalendarConnectionStatus> {
  const integration = await getGoogleCalendarIntegration(params)

  if (!integration) {
    return { status: 'not_connected' }
  }

  return { status: integration.status, email: integration.provider_account_email }
}

export async function storeGoogleCalendarIntegration(params: {
  supabase: SupabaseClient
  userId: string
  providerAccountEmail: string | null
  scopes: string[]
  accessToken: string
  refreshToken: string | null
  tokenExpiry: string | null
}): Promise<void> {
  const existing = await getGoogleCalendarIntegration({ supabase: params.supabase, userId: params.userId })
  const encryptedRefreshToken =
    params.refreshToken !== null
      ? encryptToken(params.refreshToken)
      : existing?.refresh_token_encrypted ?? null

  const { error } = await params.supabase.from('user_integrations').upsert(
    {
      user_id: params.userId,
      provider: GOOGLE_CALENDAR_INTEGRATION_PROVIDER,
      provider_account_email: params.providerAccountEmail,
      scopes: params.scopes,
      access_token_encrypted: encryptToken(params.accessToken),
      refresh_token_encrypted: encryptedRefreshToken,
      token_expiry: params.tokenExpiry,
      status: 'connected',
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  )

  if (error) {
    throw new GoogleCalendarOAuthError('database_error')
  }

  await setCalendarFeatureEnabled({ supabase: params.supabase, userId: params.userId, enabled: true })
}

export async function getGoogleCalendarOAuthAccess(params: {
  supabase: SupabaseClient
  userId: string
}): Promise<GoogleCalendarAccess> {
  if (!hasTokenEncryptionKey()) {
    throw new GoogleCalendarOAuthError('missing_token_encryption_key')
  }

  const integration = await getGoogleCalendarIntegration(params)

  if (!integration || integration.status === 'disconnected') {
    throw new GoogleCalendarOAuthError('not_connected')
  }

  if (integration.status !== 'connected') {
    throw new GoogleCalendarOAuthError('needs_reconnect')
  }

  if (!integration.access_token_encrypted) {
    await markGoogleCalendarNeedsReconnect({
      supabase: params.supabase,
      userId: params.userId,
      reason: 'missing_access_token',
    })
    throw new GoogleCalendarOAuthError('needs_reconnect')
  }

  const tokenExpiryMs = integration.token_expiry ? Date.parse(integration.token_expiry) : 0

  if (tokenExpiryMs > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return {
      accessToken: decryptToken(integration.access_token_encrypted),
      calendarId: GOOGLE_CALENDAR_OAUTH_CALENDAR_ID,
    }
  }

  if (!integration.refresh_token_encrypted) {
    await markGoogleCalendarNeedsReconnect({
      supabase: params.supabase,
      userId: params.userId,
      reason: 'missing_refresh_token',
    })
    throw new GoogleCalendarOAuthError('needs_reconnect')
  }

  try {
    const refreshed = await refreshGoogleOAuthAccessToken(decryptToken(integration.refresh_token_encrypted))
    const { error } = await params.supabase
      .from('user_integrations')
      .update({
        access_token_encrypted: encryptToken(refreshed.accessToken),
        token_expiry: refreshed.expiry,
        last_error: null,
        status: 'connected',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', params.userId)
      .eq('provider', GOOGLE_CALENDAR_INTEGRATION_PROVIDER)

    if (error) {
      throw new GoogleCalendarOAuthError('database_error')
    }

    return {
      accessToken: refreshed.accessToken,
      calendarId: GOOGLE_CALENDAR_OAUTH_CALENDAR_ID,
    }
  } catch (error) {
    if (error instanceof GoogleCalendarOAuthError && error.category === 'database_error') {
      throw error
    }

    await markGoogleCalendarNeedsReconnect({
      supabase: params.supabase,
      userId: params.userId,
      reason: 'refresh_failed',
    })
    throw new GoogleCalendarOAuthError('token_refresh_failed')
  }
}

export async function disconnectGoogleCalendarIntegration(params: {
  supabase: SupabaseClient
  userId: string
}): Promise<void> {
  const { error } = await params.supabase
    .from('user_integrations')
    .update({
      status: 'disconnected',
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expiry: null,
      disconnected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', params.userId)
    .eq('provider', GOOGLE_CALENDAR_INTEGRATION_PROVIDER)

  if (error) {
    throw new GoogleCalendarOAuthError('database_error')
  }

  await setCalendarFeatureEnabled({ supabase: params.supabase, userId: params.userId, enabled: false })
}

async function markGoogleCalendarNeedsReconnect(params: {
  supabase: SupabaseClient
  userId: string
  reason: string
}): Promise<void> {
  await params.supabase
    .from('user_integrations')
    .update({
      status: 'needs_reconnect',
      last_error: params.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', params.userId)
    .eq('provider', GOOGLE_CALENDAR_INTEGRATION_PROVIDER)

  await setCalendarFeatureEnabled({ supabase: params.supabase, userId: params.userId, enabled: false })
}

async function setCalendarFeatureEnabled(params: {
  supabase: SupabaseClient
  userId: string
  enabled: boolean
}): Promise<void> {
  const { error } = await params.supabase
    .from('user_feature_flags')
    .update({
      calendar_enabled: params.enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', params.userId)

  if (error) {
    throw new GoogleCalendarOAuthError('database_error')
  }
}
