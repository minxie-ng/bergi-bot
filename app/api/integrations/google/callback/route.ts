import { createClient } from '@supabase/supabase-js'

import {
  exchangeGoogleOAuthCode,
  getGoogleAccountEmail,
  GoogleCalendarOAuthError,
  parseGoogleOAuthState,
  storeGoogleCalendarIntegration,
} from '@/lib/google-calendar-oauth'

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

function htmlResponse(message: string, status = 200): Response {
  return new Response(`<!doctype html><html><body><p>${message}</p></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    return
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })

  if (!response.ok) {
    console.error('google_calendar_oauth_telegram_notify_failed', { status: response.status })
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) {
    return htmlResponse('Google Calendar was not connected. You can return to Telegram and try again.', 400)
  }

  if (!code || !state) {
    return htmlResponse('Google Calendar connection failed because the callback was incomplete.', 400)
  }

  try {
    const statePayload = parseGoogleOAuthState(state)
    const tokenData = await exchangeGoogleOAuthCode(code)
    const email = await getGoogleAccountEmail(tokenData.accessToken)
    const supabase = getSupabase()

    await storeGoogleCalendarIntegration({
      supabase,
      userId: statePayload.userId,
      providerAccountEmail: email,
      scopes: tokenData.scopes,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenExpiry: tokenData.expiry,
    })

    await sendTelegramMessage(
      statePayload.chatId,
      'Google Calendar connected. You can now ask me about your schedule.'
    )

    return htmlResponse('Google Calendar connected. You can return to Telegram.')
  } catch (error) {
    const category =
      error instanceof GoogleCalendarOAuthError ? error.category : 'google_calendar_oauth_callback_failed'

    console.error('google_calendar_oauth_callback_failed', { category })

    return htmlResponse('Google Calendar connection failed. Please return to Telegram and try again.', 500)
  }
}
