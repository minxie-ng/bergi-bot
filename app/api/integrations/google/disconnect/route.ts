import { createClient } from '@supabase/supabase-js'

import {
  disconnectGoogleCalendarIntegration,
  GoogleCalendarOAuthError,
  parseGoogleOAuthState,
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

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state')

  if (!state) {
    return htmlResponse('This Calendar disconnect link is invalid.', 400)
  }

  try {
    const payload = parseGoogleOAuthState(state)
    await disconnectGoogleCalendarIntegration({
      supabase: getSupabase(),
      userId: payload.userId,
    })

    return htmlResponse('Google Calendar disconnected. You can return to Telegram.')
  } catch (error) {
    const category =
      error instanceof GoogleCalendarOAuthError ? error.category : 'google_calendar_oauth_disconnect_failed'

    console.error('google_calendar_oauth_disconnect_failed', { category })

    return htmlResponse('Google Calendar disconnect failed. Please return to Telegram and try again.', 500)
  }
}
