import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { buildGoogleOAuthUrl, createGoogleOAuthState, GoogleCalendarOAuthError } from '@/lib/google-calendar-oauth'

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
  const url = new URL(request.url)
  const telegramUserId = url.searchParams.get('telegram_user_id')?.trim()
  const chatIdRaw = url.searchParams.get('chat_id')?.trim()
  const chatId = chatIdRaw ? Number(chatIdRaw) : NaN

  if (!telegramUserId || !Number.isFinite(chatId)) {
    return htmlResponse('This Calendar connect link is invalid. Please return to Telegram and try again.', 400)
  }

  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('user_accounts')
      .select('user_id')
      .eq('platform', 'telegram')
      .eq('platform_user_id', telegramUserId)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data?.user_id) {
      return htmlResponse('Please open Bergi in Telegram first, then try connecting Calendar again.', 404)
    }

    const state = createGoogleOAuthState({
      userId: data.user_id,
      telegramUserId,
      chatId,
    })

    return NextResponse.redirect(buildGoogleOAuthUrl(state))
  } catch (error) {
    const category =
      error instanceof GoogleCalendarOAuthError ? error.category : 'google_calendar_oauth_start_failed'

    console.error('google_calendar_oauth_start_failed', { category })

    return htmlResponse('Google Calendar connection is not configured yet. Please try again later.', 503)
  }
}
