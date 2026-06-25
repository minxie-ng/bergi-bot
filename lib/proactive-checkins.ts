import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_PLATFORM = 'telegram'
const DEFAULT_TIMEZONE = 'Asia/Singapore'
const ACTIVE_CHECKIN_STATUSES = ['scheduled', 'sending', 'sent']
const CHECKIN_BLOCKS = ['morning', 'afternoon', 'evening'] as const

type CheckinBlock = (typeof CHECKIN_BLOCKS)[number]

export type ProactivePreferencesRow = {
  id: string
  user_id: string
  platform: string
  telegram_chat_id: number
  enabled: boolean
  timezone: string
  daily_min_messages: number
  daily_max_messages: number
  morning_start: string
  morning_end: string
  afternoon_start: string
  afternoon_end: string
  evening_start: string
  evening_end: string
  created_at: string
  updated_at: string
}

export type ProactiveCheckinRow = {
  id: string
  user_id: string
  platform: string
  telegram_chat_id: number
  scheduled_for: string
  timezone: string
  block: string
  status: string
  message_type: string
  message_text: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

type GetOrCreateProactivePreferencesParams = {
  supabase: SupabaseClient
  userId: string
  telegramChatId: number
  platform?: string
  timezone?: string
}

type GenerateDailyProactiveCheckinsParams = GetOrCreateProactivePreferencesParams & {
  date?: Date | string
  random?: () => number
}

type BlockWindow = {
  block: CheckinBlock
  start: string
  end: string
}

export async function getOrCreateProactivePreferences(
  params: GetOrCreateProactivePreferencesParams
): Promise<ProactivePreferencesRow> {
  const platform = params.platform ?? DEFAULT_PLATFORM
  const timezone = params.timezone ?? DEFAULT_TIMEZONE

  const { data: existingPreference, error: existingPreferenceError } = await params.supabase
    .from('proactive_preferences')
    .select('*')
    .eq('user_id', params.userId)
    .eq('platform', platform)
    .eq('telegram_chat_id', params.telegramChatId)
    .maybeSingle()

  if (existingPreferenceError) {
    throw existingPreferenceError
  }

  if (existingPreference) {
    return existingPreference as ProactivePreferencesRow
  }

  const { data: insertedPreference, error: insertError } = await params.supabase
    .from('proactive_preferences')
    .insert({
      user_id: params.userId,
      platform,
      telegram_chat_id: params.telegramChatId,
      timezone,
    })
    .select('*')
    .single()

  if (!insertError && insertedPreference) {
    return insertedPreference as ProactivePreferencesRow
  }

  const { data: createdByRacePreference, error: createdByRaceError } = await params.supabase
    .from('proactive_preferences')
    .select('*')
    .eq('user_id', params.userId)
    .eq('platform', platform)
    .eq('telegram_chat_id', params.telegramChatId)
    .single()

  if (createdByRaceError || !createdByRacePreference) {
    throw insertError ?? createdByRaceError
  }

  return createdByRacePreference as ProactivePreferencesRow
}

export async function generateDailyProactiveCheckins(
  params: GenerateDailyProactiveCheckinsParams
): Promise<ProactiveCheckinRow[]> {
  const platform = params.platform ?? DEFAULT_PLATFORM
  const preference = await getOrCreateProactivePreferences(params)
  const timezone = params.timezone ?? preference.timezone
  const localDate = getLocalDateString(params.date ?? new Date(), timezone)
  const dayStartIso = zonedDateTimeToUtcIso(localDate, '00:00', timezone)
  const nextDayStartIso = zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', timezone)

  const { data: existingCheckins, error: existingCheckinsError } = await params.supabase
    .from('proactive_checkins')
    .select('*')
    .eq('user_id', params.userId)
    .eq('platform', platform)
    .eq('telegram_chat_id', params.telegramChatId)
    .in('status', ACTIVE_CHECKIN_STATUSES)
    .gte('scheduled_for', dayStartIso)
    .lt('scheduled_for', nextDayStartIso)
    .order('scheduled_for', { ascending: true })

  if (existingCheckinsError) {
    throw existingCheckinsError
  }

  if (existingCheckins && existingCheckins.length > 0) {
    return existingCheckins as ProactiveCheckinRow[]
  }

  if (!preference.enabled) {
    return []
  }

  const random = params.random ?? Math.random
  const count = chooseDailyMessageCount(preference.daily_min_messages, preference.daily_max_messages, random)
  const chosenBlocks = chooseCheckinBlocks(count, random)
  const blockWindows = getBlockWindows(preference)
  const rowsToInsert = chosenBlocks.map((block) => {
    const window = blockWindows.find((candidate) => candidate.block === block)

    if (!window) {
      throw new Error(`Missing proactive check-in window for block: ${block}`)
    }

    return {
      user_id: params.userId,
      platform,
      telegram_chat_id: params.telegramChatId,
      scheduled_for: randomTimestampInLocalWindow(localDate, timezone, window.start, window.end, random),
      timezone,
      block,
      status: 'scheduled',
      message_type: 'check_in',
    }
  })

  const { data: insertedCheckins, error: insertCheckinsError } = await params.supabase
    .from('proactive_checkins')
    .insert(rowsToInsert)
    .select('*')
    .order('scheduled_for', { ascending: true })

  if (insertCheckinsError) {
    throw insertCheckinsError
  }

  return (insertedCheckins ?? []) as ProactiveCheckinRow[]
}

function chooseDailyMessageCount(minMessages: number, maxMessages: number, random: () => number): number {
  const min = clampInteger(minMessages, 2, 3)
  const max = Math.max(min, clampInteger(maxMessages, 2, 3))

  return min + Math.floor(randomUnit(random) * (max - min + 1))
}

function chooseCheckinBlocks(count: number, random: () => number): CheckinBlock[] {
  if (count >= CHECKIN_BLOCKS.length) {
    return [...CHECKIN_BLOCKS]
  }

  return shuffle([...CHECKIN_BLOCKS], random)
    .slice(0, count)
    .sort((first, second) => CHECKIN_BLOCKS.indexOf(first) - CHECKIN_BLOCKS.indexOf(second))
}

function getBlockWindows(preference: ProactivePreferencesRow): BlockWindow[] {
  return [
    { block: 'morning', start: preference.morning_start, end: preference.morning_end },
    { block: 'afternoon', start: preference.afternoon_start, end: preference.afternoon_end },
    { block: 'evening', start: preference.evening_start, end: preference.evening_end },
  ]
}

function randomTimestampInLocalWindow(
  localDate: string,
  timezone: string,
  startTime: string,
  endTime: string,
  random: () => number
): string {
  const startMs = Date.parse(zonedDateTimeToUtcIso(localDate, startTime, timezone))
  const endMs = Date.parse(zonedDateTimeToUtcIso(localDate, endTime, timezone))

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`Invalid proactive check-in time window: ${startTime}-${endTime}`)
  }

  const scheduledMs = startMs + Math.floor(randomUnit(random) * (endMs - startMs))
  return new Date(scheduledMs).toISOString()
}

function getLocalDateString(date: Date | string, timezone: string): string {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date
  }

  const instant = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)

  return `${getDateTimePart(parts, 'year')}-${getDateTimePart(parts, 'month')}-${getDateTimePart(parts, 'day')}`
}

function zonedDateTimeToUtcIso(localDate: string, localTime: string, timezone: string): string {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute, second] = normalizeTime(localTime).split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstPassUtc = utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timezone)
  const secondPassUtc = utcGuess - getTimeZoneOffsetMs(new Date(firstPassUtc), timezone)

  return new Date(secondPassUtc).toISOString()
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const year = Number(getDateTimePart(parts, 'year'))
  const month = Number(getDateTimePart(parts, 'month'))
  const day = Number(getDateTimePart(parts, 'day'))
  const hour = Number(getDateTimePart(parts, 'hour'))
  const minute = Number(getDateTimePart(parts, 'minute'))
  const second = Number(getDateTimePart(parts, 'second'))
  const zonedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)

  return zonedAsUtc - date.getTime()
}

function addDaysToLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))

  return date.toISOString().slice(0, 10)
}

function getDateTimePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type)

  if (!part) {
    throw new Error(`Missing date time part: ${type}`)
  }

  return part.value
}

function normalizeTime(time: string): string {
  const [hour = '00', minute = '00', second = '00'] = time.split(':')

  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomUnit(random) * (index + 1))
    const current = items[index]

    items[index] = items[swapIndex]
    items[swapIndex] = current
  }

  return items
}

function randomUnit(random: () => number): number {
  return Math.min(Math.max(random(), 0), 0.9999999999999999)
}
