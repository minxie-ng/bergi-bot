import { createClient } from '@supabase/supabase-js'

import { generateDailyProactiveCheckins, getOrCreateProactivePreferences } from '@/lib/proactive-checkins'

type TelegramUpdate = {
  message?: {
    from?: {
      id?: number
      username?: string
      first_name?: string
      last_name?: string
    }
    chat?: {
      id?: number
    }
    text?: string
    caption?: string
    sticker?: unknown
    animation?: unknown
    voice?: {
      file_id: string
      duration?: number
      mime_type?: string
      file_size?: number
    }
    photo?: Array<{
      file_id: string
      file_unique_id?: string
      width?: number
      height?: number
      file_size?: number
    }>
  }
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type FindOrCreateUserAccountParams = {
  supabase: ReturnType<typeof getSupabase>
  platformUserId: string
  username?: string
  firstName?: string
  lastName?: string
}

type SaveMessageParams = {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  role: 'user' | 'assistant'
  content: string
}

type UserProfile = {
  displayName: string | null
  preferredLanguage: string | null
  personalityPrompt: string
}

type ReminderExtraction =
  | {
      action: 'create_reminder'
      reminder_text: string
      event_time: string | null
      remind_at: string
      timezone: string
      confirmation_message: string
    }
  | {
      action: 'ask_clarifying_question'
      clarifying_question: string
    }
  | {
      action: 'not_reminder'
    }

type FutureEventExtraction =
  | {
      action: 'future_event_detected'
      event_title: string
      event_time: string
      timezone: string
      ask_message: string
    }
  | {
      action: 'ask_clarifying_question'
      clarifying_question: string
    }
  | {
      action: 'not_future_event'
    }

type AwaitingReminderRow = {
  id: string
  event_time: string
  timezone: string
  reminder_text: string
}

type ManagedReminderRow = {
  id: string
  reminder_text: string
  remind_at: string
  timezone: string
  status: string
}

type ReminderManagementIntent =
  | {
      action: 'reschedule_reminder'
      reminder_id: string
      new_remind_at: string
      reply: string
    }
  | {
      action: 'ask_clarifying_question'
      reply: string
    }
  | {
      action: 'not_reminder_management'
    }

type SaveReminderParams = {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  reminderText: string
  eventTime: string | null
  remindAt: string
  timezone: string
  sourceMessageContent: string
}

type ProactiveCheckinControlAction = 'pause' | 'resume' | 'status'
type TelegramSlashCommand = '/help' | '/checkin_status' | '/pause_checkins' | '/resume_checkins' | '/list_reminders'

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

function isAllowedTelegramUser(telegramUserId: number): boolean {
  const allowedTelegramUserIds = process.env.ALLOWED_TELEGRAM_USER_IDS

  if (!allowedTelegramUserIds) {
    return false
  }

  return allowedTelegramUserIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(String(telegramUserId))
}

function chooseTelegramPhotoSize(
  photoSizes: NonNullable<TelegramUpdate['message']>['photo']
): { file_id: string; width?: number; height?: number; file_size?: number } | null {
  if (!photoSizes || photoSizes.length === 0) {
    return null
  }

  return photoSizes[photoSizes.length - 1]
}

function isLikelyReminderRequest(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('remind me') ||
    lower.includes('reminder') ||
    lower.includes('提醒我') ||
    lower.includes('提醒') ||
    lower.includes('叫我') ||
    lower.includes('let me know') ||
    lower.includes('tell me before') ||
    lower.includes('erinnere mich') ||
    lower.includes('erinner mich') ||
    lower.includes('erinnerung') ||
    lower.includes('erinnere mich daran') ||
    lower.includes('erinner mich daran')
  )
}

function isLikelyFutureEventMention(text: string): boolean {
  const lower = text.toLowerCase()

  const hasTimeOrDate =
    /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text) ||
    /\b\d{1,2}\.\d{2}\s*(am|pm)?\b/i.test(text) ||
    /\b\d{1,2}\s*uhr\b/i.test(text) ||
    /\b\d{1,2}\.\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/i.test(lower) ||
    lower.includes('later') ||
    lower.includes('tomorrow') ||
    lower.includes('next ') ||
    lower.includes('today') ||
    lower.includes('tonight') ||
    lower.includes('morgen') ||
    lower.includes('heute') ||
    lower.includes('heute abend') ||
    lower.includes('nächste') ||
    lower.includes('naechste') ||
    lower.includes('nächsten') ||
    lower.includes('naechsten') ||
    lower.includes('明天') ||
    lower.includes('今天') ||
    lower.includes('今晚')

  const hasEventWord =
    lower.includes('meeting') ||
    lower.includes('class') ||
    lower.includes('call') ||
    lower.includes('interview') ||
    lower.includes('appointment') ||
    lower.includes('project') ||
    lower.includes('presentation') ||
    lower.includes('exam') ||
    lower.includes('test') ||
    lower.includes('deadline') ||
    lower.includes('meetup') ||
    lower.includes('trek') ||
    lower.includes('treffen') ||
    lower.includes('termin') ||
    lower.includes('unterricht') ||
    lower.includes('prüfung') ||
    lower.includes('pruefung') ||
    lower.includes('projekt') ||
    lower.includes('projektmeeting') ||
    lower.includes('anruf') ||
    lower.includes('präsentation') ||
    lower.includes('praesentation') ||
    lower.includes('会议') ||
    lower.includes('开会') ||
    lower.includes('课') ||
    lower.includes('考试') ||
    lower.includes('面试') ||
    lower.includes('项目') ||
    lower.includes('截止')

  return hasTimeOrDate && hasEventWord
}

function isLikelyReminderPreferenceReply(text: string): boolean {
  const lower = text.toLowerCase().trim()
  const standaloneDuration =
    /^(?:yes,?\s*)?(?:remind me\s*)?\d+\s*(mins?|minutes?|hours?|hrs?)$/i.test(lower) ||
    /^\d+\s*(minuten|stunden)$/i.test(lower) ||
    /^\d+\s*(分钟|小时)$/.test(lower)

  return (
    lower.includes('before') ||
    lower.includes('vorher') ||
    /(?:提前\s*\d+\s*(分钟|小时)|\d+\s*(分钟|小时)\s*前)/.test(text) ||
    standaloneDuration ||
    lower === 'now' ||
    lower === 'remind me now' ||
    lower.includes('现在') ||
    lower.includes('马上') ||
    lower === 'no' ||
    lower === 'nah' ||
    lower === 'no need' ||
    lower.includes('不用') ||
    lower.includes('不需要')
  )
}

function isLikelyNewReminderCommand(text: string): boolean {
  const lower = text.toLowerCase().trim()

  return (
    lower.includes('remind me to') ||
    lower.includes('remind me about') ||
    lower.includes('remind me at') ||
    lower.includes('remind me in') ||
    lower.includes('提醒我') ||
    lower.includes('叫我') ||
    lower.includes('erinnere mich') ||
    lower.includes('erinner mich')
  )
}

function isLikelyListRemindersRequest(text: string): boolean {
  const lower = text.toLowerCase().trim()
  const existingChecks =
    lower.includes('list reminders') ||
    lower.includes('show reminders') ||
    lower.includes('what reminders do i have') ||
    lower.includes('upcoming reminders') ||
    lower.includes('my reminders') ||
    lower.includes('我的提醒') ||
    lower.includes('提醒列表') ||
    lower.includes('有哪些提醒') ||
    lower.includes('welche erinnerungen habe ich') ||
    lower.includes('meine erinnerungen')
  const hasListWord =
    lower.includes('list') ||
    lower.includes('show') ||
    lower.includes('see') ||
    lower.includes('view') ||
    lower.includes('all') ||
    lower.includes('有哪些') ||
    lower.includes('列表') ||
    lower.includes('zeige') ||
    lower.includes('anzeigen')
  const hasReminderWord =
    lower.includes('reminder') ||
    lower.includes('reminders') ||
    lower.includes('提醒') ||
    lower.includes('erinnerung') ||
    lower.includes('erinnerungen')

  return existingChecks || (hasListWord && hasReminderWord)
}

function isLikelyCancelReminderRequest(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return (
    lower.includes('cancel latest reminder') ||
    lower.includes('cancel last reminder') ||
    lower.includes('cancel my latest reminder') ||
    lower.includes('delete latest reminder') ||
    lower.includes('cancel next reminder') ||
    lower.includes('delete next reminder') ||
    lower.includes('remove next reminder') ||
    lower.includes('cancel reminder') ||
    lower.includes('delete reminder') ||
    lower.includes('remove reminder') ||
    lower.includes('取消最新提醒') ||
    lower.includes('取消提醒')
  )
}

function isLikelyRescheduleReminderRequest(text: string): boolean {
  const lower = text.toLowerCase().trim()

  const hasReminderWord =
    lower.includes('reminder') || lower.includes('提醒') || lower.includes('erinnerung')

  const hasRescheduleVerb =
    lower.includes('reschedule') ||
    lower.includes('move') ||
    lower.includes('change') ||
    lower.includes('update') ||
    lower.includes('改') ||
    lower.includes('修改') ||
    lower.includes('verschiebe') ||
    lower.includes('ändern') ||
    lower.includes('aendern')

  return hasReminderWord && hasRescheduleVerb
}

function normalizeTelegramCommand(text: string): TelegramSlashCommand | null {
  const firstToken = text.trim().split(/\s+/)[0]?.toLowerCase()

  if (!firstToken?.startsWith('/')) {
    return null
  }

  const command = firstToken.split('@')[0]

  switch (command) {
    case '/help':
    case '/checkin_status':
    case '/pause_checkins':
    case '/resume_checkins':
    case '/list_reminders':
      return command
    default:
      return null
  }
}

function getHelpReply(): string {
  return `here’s what I can do:

/checkin_status — see whether proactive check-ins are on
/pause_checkins — pause proactive check-ins
/resume_checkins — resume proactive check-ins
/list_reminders — show active reminders

you can also just talk to me normally.`
}

function getProactiveCheckinControlActionFromCommand(
  command: TelegramSlashCommand | null
): ProactiveCheckinControlAction | null {
  switch (command) {
    case '/checkin_status':
      return 'status'
    case '/pause_checkins':
      return 'pause'
    case '/resume_checkins':
      return 'resume'
    default:
      return null
  }
}

function getProactiveCheckinControlAction(text: string): ProactiveCheckinControlAction | null {
  const normalized = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const mentionsCheckins =
    normalized.includes('check in') ||
    normalized.includes('checkins') ||
    normalized.includes('proactive') ||
    normalized.includes('proactive check') ||
    normalized.includes('proactive message')

  if (!mentionsCheckins) {
    return null
  }

  if (
    normalized.includes('pause') ||
    normalized.includes('stop') ||
    normalized.includes('turn off') ||
    normalized.includes('disable')
  ) {
    return 'pause'
  }

  if (
    normalized.includes('resume') ||
    normalized.includes('start') ||
    normalized.includes('turn on') ||
    normalized.includes('enable')
  ) {
    return 'resume'
  }

  if (
    normalized.includes('status') ||
    normalized.includes('settings') ||
    normalized.includes('setting') ||
    normalized.includes('are check ins on') ||
    normalized.includes('are checkins on')
  ) {
    return 'status'
  }

  return null
}

function parseReminderCancelNumber(text: string): number | null {
  const match = text.match(/(?:cancel|delete|remove)\s+reminder\s+(\d+)/i) ?? text.match(/取消提醒\s*(\d+)/)

  if (!match) {
    return null
  }

  return Number(match[1])
}

function formatManagedReminderTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatUpcomingReminders(reminders: ManagedReminderRow[]): string {
  if (reminders.length === 0) {
    return 'You don’t have any upcoming reminders.'
  }

  const reminderLines = reminders.flatMap((reminder, index) => [
    `${index + 1}. ${reminder.reminder_text}`,
    `- Time: ${formatManagedReminderTime(reminder.remind_at, reminder.timezone)} ${getTimezoneLabel(reminder.timezone)}`,
    `- Status: ${reminder.status}`,
    '',
  ])

  return `Upcoming reminders:

${reminderLines.join('\n').trim()}

To cancel, say:
cancel reminder 1`
}

async function getUpcomingReminders(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<ManagedReminderRow[]> {
  const { supabase, userId, chatId } = params

  const { data, error } = await supabase
    .from('reminders')
    .select('id, reminder_text, remind_at, timezone, status')
    .eq('user_id', userId)
    .eq('telegram_chat_id', chatId)
    .eq('status', 'pending')
    .gte('remind_at', new Date().toISOString())
    .order('remind_at', { ascending: true })
    .limit(10)

  if (error) {
    throw error
  }

  return (data ?? []) as ManagedReminderRow[]
}

async function cancelReminderById(params: {
  supabase: ReturnType<typeof getSupabase>
  reminderId: string
}): Promise<boolean> {
  const { supabase, reminderId } = params

  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', reminderId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  return data !== null
}

async function setProactiveCheckinsEnabled(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  enabled: boolean
}): Promise<{ timezone: string }> {
  const { supabase, userId, chatId, enabled } = params
  const preference = await getOrCreateProactivePreferences({
    supabase,
    userId,
    telegramChatId: chatId,
    platform: 'telegram',
  })
  const { error } = await supabase
    .from('proactive_preferences')
    .update({
      enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', preference.id)

  if (error) {
    throw error
  }

  return { timezone: preference.timezone }
}

async function cancelFutureScheduledProactiveCheckins(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<void> {
  const { supabase, userId, chatId } = params
  const { error } = await supabase
    .from('proactive_checkins')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'scheduled')
    .gte('scheduled_for', new Date().toISOString())

  if (error) {
    throw error
  }
}

async function countFutureScheduledProactiveCheckins(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<number> {
  const { supabase, userId, chatId } = params
  const { count, error } = await supabase
    .from('proactive_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'scheduled')
    .gte('scheduled_for', new Date().toISOString())

  if (error) {
    throw error
  }

  return count ?? 0
}

async function restoreTodayFutureCancelledProactiveCheckins(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  timezone: string
}): Promise<number> {
  const { supabase, userId, chatId, timezone } = params
  const now = new Date()
  const localDate = getLocalDateString(now, timezone)
  const nextLocalDate = addDaysToLocalDate(localDate, 1)
  const nowIso = now.toISOString()
  const nextDayStartIso = zonedDateTimeToUtcIso(nextLocalDate, '00:00', timezone)
  const restoreTime = new Date().toISOString()
  const { data, error } = await supabase
    .from('proactive_checkins')
    .update({
      status: 'scheduled',
      updated_at: restoreTime,
    })
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'cancelled')
    .gt('scheduled_for', nowIso)
    .lt('scheduled_for', nextDayStartIso)
    .select('id')

  if (error) {
    throw error
  }

  return data?.length ?? 0
}

function getLocalDateString(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

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

async function resolveProactiveCheckinControlReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  action: ProactiveCheckinControlAction
}): Promise<string> {
  const { supabase, userId, chatId, action } = params

  if (action === 'pause') {
    await setProactiveCheckinsEnabled({ supabase, userId, chatId, enabled: false })
    await cancelFutureScheduledProactiveCheckins({ supabase, userId, chatId })
    return 'okay min, I’ll pause proactive check-ins for now.'
  }

  if (action === 'resume') {
    const preference = await setProactiveCheckinsEnabled({ supabase, userId, chatId, enabled: true })
    const restoredCount = await restoreTodayFutureCancelledProactiveCheckins({
      supabase,
      userId,
      chatId,
      timezone: preference.timezone,
    })

    if (restoredCount > 0) {
      const checkinWord = restoredCount === 1 ? 'check-in' : 'check-ins'
      return `done min, proactive check-ins are back on. I restored ${restoredCount} upcoming ${checkinWord} for today.`
    }

    await generateDailyProactiveCheckins({
      supabase,
      userId,
      telegramChatId: chatId,
      platform: 'telegram',
      timezone: preference.timezone,
    })
    return 'done min, proactive check-ins are back on.'
  }

  const preference = await getOrCreateProactivePreferences({
    supabase,
    userId,
    telegramChatId: chatId,
    platform: 'telegram',
  })
  const upcomingCount = await countFutureScheduledProactiveCheckins({ supabase, userId, chatId })
  const enabledText = preference.enabled ? 'on' : 'off'
  const checkinWord = upcomingCount === 1 ? 'check-in' : 'check-ins'

  return `check-ins are ${enabledText}. You have ${upcomingCount} upcoming scheduled ${checkinWord}. Timezone: ${preference.timezone}.`
}

async function findOrCreateUserAccount(params: FindOrCreateUserAccountParams): Promise<string> {
  const { supabase, platformUserId, username, firstName, lastName } = params

  const { data: existingAccount, error: existingAccountError } = await supabase
    .from('user_accounts')
    .select('user_id')
    .eq('platform', 'telegram')
    .eq('platform_user_id', platformUserId)
    .maybeSingle()

  if (existingAccountError) {
    throw existingAccountError
  }

  if (existingAccount?.user_id) {
    return existingAccount.user_id
  }

  const { data: user, error: userError } = await supabase.from('users').insert({}).select('id').single()

  if (userError) {
    throw userError
  }

  const { error: userAccountError } = await supabase.from('user_accounts').insert({
    user_id: user.id,
    platform: 'telegram',
    platform_user_id: platformUserId,
    username: username ?? null,
    first_name: firstName ?? null,
    last_name: lastName ?? null,
  })

  if (userAccountError) {
    throw userAccountError
  }

  return user.id
}

async function saveMessage(params: SaveMessageParams): Promise<void> {
  const { supabase, userId, role, content } = params

  const { error } = await supabase.from('messages').insert({
    user_id: userId,
    platform: 'telegram',
    role,
    content,
  })

  if (error) {
    throw error
  }
}

function hasExplicitTimezoneOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
}

function parseReminderExtraction(raw: string): ReminderExtraction {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as ReminderExtraction
  } catch {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as ReminderExtraction
    }

    throw new Error(`Failed to parse reminder extraction JSON: ${raw}`)
  }
}

function parseFutureEventExtraction(raw: string): FutureEventExtraction {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as FutureEventExtraction
  } catch {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as FutureEventExtraction
    }

    throw new Error(`Failed to parse future event extraction JSON: ${raw}`)
  }
}

function parseReminderManagementIntent(raw: string): ReminderManagementIntent {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as ReminderManagementIntent
  } catch {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as ReminderManagementIntent
    }

    throw new Error(`Failed to parse reminder management JSON: ${raw}`)
  }
}

function getTimezoneLabel(timezone: string): string {
  if (timezone === 'Asia/Singapore') {
    return 'Singapore time'
  }

  return timezone
}

function formatReminderTimeForUser(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function extractReminderFromText(text: string): Promise<ReminderExtraction> {
  const now = new Date()
  const nowIso = now.toISOString()
  const singaporeNow = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now)
  const parserPrompt = `You are extracting reminder information for Bergi.

Current UTC time: ${nowIso}
Current Asia/Singapore time: ${singaporeNow}
Default timezone: Asia/Singapore

Return ONLY valid JSON.

If the user clearly asks to be reminded and enough information is available, return:
{
  "action": "create_reminder",
  "reminder_text": "...",
  "event_time": "ISO timestamp or null",
  "remind_at": "ISO timestamp",
  "timezone": "Asia/Singapore",
  "confirmation_message": "..."
}

If the user asks for a reminder but the reminder time is unclear, return:
{
  "action": "ask_clarifying_question",
  "clarifying_question": "..."
}

If this is not a reminder request, return:
{
  "action": "not_reminder"
}

Rules:
- Default timezone is Asia/Singapore.
- If the user does not mention a timezone or location, assume Asia/Singapore.
- Resolve relative dates like "today", "tomorrow", "tonight", and "next week" based on the timezone being used, not UTC.
- In confirmation_message, always mention the timezone used, for example "Singapore time".
- If the user explicitly mentions a timezone or location, use the best matching timezone:
  - Singapore / SG → Asia/Singapore
  - China / Hangzhou / Shanghai / Beijing → Asia/Shanghai
  - Malaysia / KL → Asia/Kuala_Lumpur
  - Japan / Tokyo → Asia/Tokyo
  - Korea / Seoul → Asia/Seoul
  - Germany / Berlin → Europe/Berlin
  - UK / London → Europe/London
- If the user says something ambiguous like "local time", "when I'm overseas", or implies travel without a clear location/timezone, return:
{
  "action": "ask_clarifying_question",
  "clarifying_question": "Which timezone should I use for this reminder — Singapore time or your local time?"
}
- For create_reminder, set the timezone field to the IANA timezone actually used.
- remind_at and event_time should be valid ISO timestamps representing the correct instant for that timezone.
- remind_at and event_time must include an explicit timezone offset or Z.
- Good examples: 2026-06-24T18:30:00+08:00, 2026-06-24T10:30:00.000Z.
- Bad example: 2026-06-24T18:30:00.
- If the user says "meeting tomorrow at 7pm, remind me half an hour before", event_time should be tomorrow 7pm in the chosen timezone and remind_at should be 30 minutes before.
- If the user says "remind me at 6:30pm tomorrow to prep for SMUX meeting", event_time can be null and remind_at should be tomorrow 6:30pm in the chosen timezone.
- German examples:
  - "Erinnere mich in 3 Minuten daran, Wasser zu trinken."
  - "Erinner mich morgen um 19 Uhr an mein Meeting."
  - "Erinnere mich 30 Minuten vor meinem Treffen daran."
- confirmation_message should clearly confirm the active reminder, mention the reminder time and timezone used, and stay concise.
- Example confirmation_message: "Got it — I’ll remind you tomorrow at 6:30pm Singapore time."`

  const response = await callLLM({
    systemPrompt: parserPrompt,
    chatMessages: [{ role: 'user', content: text }],
  })

  return parseReminderExtraction(response)
}

async function extractFutureEventFromText(text: string): Promise<FutureEventExtraction> {
  const now = new Date()
  const nowIso = now.toISOString()
  const singaporeNow = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now)
  const parserPrompt = `You are detecting future events for Bergi.

Current UTC time: ${nowIso}
Current Asia/Singapore time: ${singaporeNow}
Default timezone: Asia/Singapore

Return ONLY valid JSON. Do not create reminders directly.

If the user mentions a clear future event with enough event info and time info, return:
{
  "action": "future_event_detected",
  "event_title": "...",
  "event_time": "ISO timestamp with timezone offset or Z",
  "timezone": "Asia/Singapore",
  "ask_message": "..."
}

If the user seems to mention a future event but date/time is missing or unclear, return:
{
  "action": "ask_clarifying_question",
  "clarifying_question": "..."
}

If this is not a future event mention, return:
{
  "action": "not_future_event"
}

Rules:
- Default timezone is Asia/Singapore.
- If the user does not mention a timezone or location, assume Asia/Singapore.
- Resolve relative dates like "today", "later", "tomorrow", "tonight", and "next week" based on the timezone being used, not UTC.
- Only detect future events that have enough event info and time info.
- Do not create reminders directly. Ask whether Min wants a reminder.
- event_time must include an explicit timezone offset or Z.
- timezone must be an IANA timezone.
- Also support simple German future event mentions, especially words like: Treffen, Termin, Unterricht, Prüfung, Projekt, Projektmeeting, Anruf, Präsentation.
- German examples:
  - "Ich habe morgen um 19 Uhr ein Treffen."
  - "Ich habe nächsten Dienstag einen Termin."
  - "Ich habe am 25. Juni 2026 um 8 Uhr ein Projektmeeting."
- ask_message should ask whether Min wants to be reminded before the event.
- Example ask_message: "Got it — meeting at 4:30pm Singapore time. Want me to remind you before it? Reply like '10 mins before' or 'no'."`

  const response = await callLLM({
    systemPrompt: parserPrompt,
    chatMessages: [{ role: 'user', content: text }],
  })

  return parseFutureEventExtraction(response)
}

async function saveReminder(params: SaveReminderParams): Promise<void> {
  const { supabase, userId, chatId, reminderText, eventTime, remindAt, sourceMessageContent } = params
  const timezone = params.timezone || 'Asia/Singapore'

  if (!reminderText.trim()) {
    throw new Error('Reminder text is required')
  }

  if (Number.isNaN(Date.parse(remindAt))) {
    throw new Error('Reminder remind_at is invalid')
  }

  if (!hasExplicitTimezoneOffset(remindAt)) {
    throw new Error('Reminder remind_at must include timezone offset or Z')
  }

  if (new Date(remindAt).getTime() <= Date.now()) {
    throw new Error('Reminder remind_at must be in the future')
  }

  if (eventTime !== null && Number.isNaN(Date.parse(eventTime))) {
    throw new Error('Reminder event_time is invalid')
  }

  if (eventTime !== null && !hasExplicitTimezoneOffset(eventTime)) {
    throw new Error('Reminder event_time must include timezone offset or Z')
  }

  const { error } = await supabase.from('reminders').insert({
    user_id: userId,
    platform: 'telegram',
    telegram_chat_id: chatId,
    reminder_text: reminderText,
    event_time: eventTime,
    remind_at: remindAt,
    timezone,
    status: 'pending',
    source_message_content: sourceMessageContent,
  })

  if (error) {
    throw error
  }
}

async function extractReminderManagementIntent(params: {
  userText: string
  upcomingReminders: ManagedReminderRow[]
}): Promise<ReminderManagementIntent> {
  const { userText, upcomingReminders } = params
  const now = new Date()
  const nowIso = now.toISOString()
  const singaporeNow = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now)
  const reminderList = upcomingReminders
    .map(
      (reminder, index) =>
        `${index + 1}. id=${reminder.id}; reminder_text=${reminder.reminder_text}; remind_at=${reminder.remind_at}; timezone=${reminder.timezone}; status=${reminder.status}`
    )
    .join('\n')
  const parserPrompt = `You are extracting reminder management intent for Bergi.

Current UTC time: ${nowIso}
Current Asia/Singapore time: ${singaporeNow}
Default timezone: Asia/Singapore

Upcoming reminders:
${reminderList}

Return ONLY valid JSON.

If the user wants to reschedule an existing reminder, return:
{
  "action": "reschedule_reminder",
  "reminder_id": "one of the provided reminder ids",
  "new_remind_at": "ISO timestamp with timezone offset or Z",
  "reply": "..."
}

If the request is ambiguous or missing the target reminder/time, return:
{
  "action": "ask_clarifying_question",
  "reply": "..."
}

If this is not reminder management, return:
{
  "action": "not_reminder_management"
}

Rules:
- The reminder_id must be one of the provided upcoming reminder ids.
- If the user refers to reminder number 1, use the reminder with number 1 from the provided list.
- If the user refers by meaning, choose only if the match is clear.
- If ambiguous, ask a clarifying question.
- Resolve relative dates/times using Asia/Singapore by default.
- If the user says "later" or "earlier" while rescheduling an existing reminder, interpret it relative to that reminder's existing remind_at, not relative to the current time.
- Example: If reminder 1 is at 6:00pm and the user says "move reminder 1 to 30 minutes later", new_remind_at should be 6:30pm.
- new_remind_at must be an ISO timestamp with explicit timezone offset or Z.
- If the requested new time is in the past, ask for a future time.
- Do not invent reminders.`

  const response = await callLLM({
    systemPrompt: parserPrompt,
    chatMessages: [{ role: 'user', content: userText }],
  })

  return parseReminderManagementIntent(response)
}

async function saveAwaitingReminderPreference(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  eventTitle: string
  eventTime: string
  timezone: string
  sourceMessageContent: string
}): Promise<void> {
  const { supabase, userId, chatId, eventTitle, eventTime, sourceMessageContent } = params
  const timezone = params.timezone || 'Asia/Singapore'

  if (!eventTitle.trim()) {
    throw new Error('Future event title is required')
  }

  if (Number.isNaN(Date.parse(eventTime))) {
    throw new Error('Future event_time is invalid')
  }

  if (!hasExplicitTimezoneOffset(eventTime)) {
    throw new Error('Future event_time must include timezone offset or Z')
  }

  if (new Date(eventTime).getTime() <= Date.now()) {
    throw new Error('Future event_time must be in the future')
  }

  const { error } = await supabase.from('reminders').insert({
    user_id: userId,
    platform: 'telegram',
    telegram_chat_id: chatId,
    reminder_text: eventTitle,
    event_time: eventTime,
    remind_at: eventTime,
    timezone,
    status: 'awaiting_reminder_preference',
    source_message_content: sourceMessageContent,
  })

  if (error) {
    throw error
  }
}

async function getLatestAwaitingReminder(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<AwaitingReminderRow | null> {
  const { supabase, userId, chatId } = params
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('reminders')
    .select('id, event_time, timezone, reminder_text')
    .eq('user_id', userId)
    .eq('telegram_chat_id', chatId)
    .eq('status', 'awaiting_reminder_preference')
    .not('event_time', 'is', null)
    .gt('event_time', nowIso)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data as AwaitingReminderRow | null
}

async function resolveReminderPreferenceReply(params: {
  supabase: ReturnType<typeof getSupabase>
  awaitingReminder: AwaitingReminderRow
  userText: string
}): Promise<string> {
  const { supabase, awaitingReminder, userText } = params
  const lower = userText.toLowerCase().trim()

  if (lower === 'no' || lower === 'nah' || lower === 'no need' || lower.includes('不用') || lower.includes('不需要')) {
    const { error } = await supabase
      .from('reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', awaitingReminder.id)
      .eq('status', 'awaiting_reminder_preference')

    if (error) {
      throw error
    }

    return "Okay, I won’t remind you for that."
  }

  if (lower === 'now' || lower === 'remind me now' || lower.includes('现在') || lower.includes('马上')) {
    const nowIso = new Date().toISOString()
    const { error } = await supabase
      .from('reminders')
      .update({
        remind_at: nowIso,
        status: 'pending',
        updated_at: nowIso,
      })
      .eq('id', awaitingReminder.id)
      .eq('status', 'awaiting_reminder_preference')

    if (error) {
      throw error
    }

    return 'Okay, I’ll remind you now.'
  }

  let minutesBefore: number | null = null
  const minutesMatch = lower.match(/(\d+)\s*(mins?|minutes?)(\s*before)?/)
  const germanMinutesMatch = lower.match(/(\d+)\s*minuten\s*vorher/)
  const chineseMinutesMatch = lower.match(/(?:提前)?(\d+)\s*分钟(?:前)?/)
  const hoursMatch = lower.match(/(\d+)\s*(hours?|hrs?)(\s*before)?/)
  const germanHoursMatch = lower.match(/(\d+)\s*stunden\s*vorher/)
  const chineseHoursMatch = lower.match(/(?:提前)?(\d+)\s*小时(?:前)?/)

  if (minutesMatch) {
    minutesBefore = Number(minutesMatch[1])
  } else if (germanMinutesMatch) {
    minutesBefore = Number(germanMinutesMatch[1])
  } else if (chineseMinutesMatch) {
    minutesBefore = Number(chineseMinutesMatch[1])
  } else if (hoursMatch) {
    minutesBefore = Number(hoursMatch[1]) * 60
  } else if (germanHoursMatch) {
    minutesBefore = Number(germanHoursMatch[1]) * 60
  } else if (chineseHoursMatch) {
    minutesBefore = Number(chineseHoursMatch[1]) * 60
  } else if (lower.includes('half an hour before') || lower.includes('30 mins')) {
    minutesBefore = 30
  } else if (lower.includes('10 mins')) {
    minutesBefore = 10
  } else if (lower.includes('5 mins')) {
    minutesBefore = 5
  }

  if (minutesBefore === null || Number.isNaN(minutesBefore) || minutesBefore <= 0 || minutesBefore > 1440) {
    return 'How early before should I remind you? For example, 10 mins before or 30 mins before.'
  }

  const remindAt = new Date(new Date(awaitingReminder.event_time).getTime() - minutesBefore * 60 * 1000).toISOString()

  if (new Date(remindAt).getTime() <= Date.now()) {
    return 'That reminder time has already passed. Do you want me to remind you now, or choose another time?'
  }
  const { error } = await supabase
    .from('reminders')
    .update({
      remind_at: remindAt,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', awaitingReminder.id)
    .eq('status', 'awaiting_reminder_preference')

  if (error) {
    throw error
  }

  return `Okay, I’ll remind you at ${formatReminderTimeForUser(remindAt, awaitingReminder.timezone)} ${getTimezoneLabel(awaitingReminder.timezone)}.`
}

async function rescheduleReminderById(params: {
  supabase: ReturnType<typeof getSupabase>
  reminderId: string
  newRemindAt: string
}): Promise<boolean> {
  const { supabase, reminderId, newRemindAt } = params

  const { data, error } = await supabase
    .from('reminders')
    .update({
      remind_at: newRemindAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reminderId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  return data !== null
}

async function getUserProfile(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<UserProfile | null> {
  const { supabase, userId } = params

  const { data, error } = await supabase
    .from('user_profiles')
    .select('display_name, preferred_language, personality_prompt')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    return null
  }

  return {
    displayName: data.display_name,
    preferredLanguage: data.preferred_language,
    personalityPrompt: data.personality_prompt,
  }
}

async function getRecentMessages(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { supabase, userId } = params

  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    throw error
  }

  return (data ?? [])
    .reverse()
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content as string }))
}

function trimMessagesByCharacterLimit(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxCharacters: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const selectedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let totalCharacters = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const messageLength = message.content.length

    if (totalCharacters + messageLength > maxCharacters) {
      if (selectedMessages.length === 0) {
        selectedMessages.push({
          ...message,
          content: message.content.slice(0, maxCharacters),
        })
      }

      continue
    }

    selectedMessages.push(message)
    totalCharacters += messageLength
  }

  return selectedMessages.reverse()
}

async function logOpenAIChatCompletionFailure(response: Response): Promise<void> {
  let responseBodyText: string

  try {
    responseBodyText = await response.text()
  } catch (error) {
    responseBodyText = `Failed to read response body: ${error instanceof Error ? error.message : String(error)}`
  }

  console.error('OpenAI chat completion request failed', {
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    status: response.status,
    responseBodyText,
  })
}

function shouldRetryOpenAIChatCompletion(status: number): boolean {
  return status === 503 || status === 429 || status === 500
}

async function fetchOpenAIChatCompletion(params: {
  baseUrl: string
  apiKey: string
  model: string
  body: Record<string, unknown>
}): Promise<Response> {
  const { baseUrl, apiKey, model, body } = params

  return fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      model,
    }),
  })
}

async function fetchOpenAIChatCompletionWithFallback(params: {
  baseUrl: string
  apiKey: string
  model: string
  fallbackModel?: string
  body: Record<string, unknown>
}): Promise<Response> {
  const response = await fetchOpenAIChatCompletion(params)

  if (!response.ok && params.fallbackModel && shouldRetryOpenAIChatCompletion(response.status)) {
    await logOpenAIChatCompletionFailure(response)
    return fetchOpenAIChatCompletion({
      ...params,
      model: params.fallbackModel,
    })
  }

  return response
}

async function callLLM(params: { chatMessages: ChatMessage[]; systemPrompt: string }): Promise<string> {
  const { chatMessages, systemPrompt } = params
  const baseUrl = process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL
  const fallbackModel = process.env.OPENAI_FALLBACK_MODEL

  if (!baseUrl || !apiKey || !model) {
    throw new Error('Missing OpenAI environment variables')
  }

  const response = await fetchOpenAIChatCompletionWithFallback({
    baseUrl,
    apiKey,
    model,
    fallbackModel,
    body: {
      max_completion_tokens: 300,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...chatMessages,
      ],
    },
  })

  if (!response.ok) {
    await logOpenAIChatCompletionFailure(response)
    throw new Error(`OpenAI API request failed: ${response.status}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.'
}

async function describeImage(imageBuffer: ArrayBuffer, mimeType = 'image/jpeg', caption?: string): Promise<string> {
  const baseUrl = process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL
  const fallbackModel = process.env.OPENAI_FALLBACK_MODEL

  if (!baseUrl || !apiKey || !model) {
    throw new Error('Missing OpenAI environment variables')
  }

  const base64Image = Buffer.from(imageBuffer).toString('base64')
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`
  const prompt = caption
    ? `The user sent a Telegram photo with this caption/question:
${caption}

Analyze the image specifically to help answer the caption/question. Focus only on what is visible in the image. If the caption asks for a count, estimate the count from the visible image. If unsure, say that it is approximate. Do not write as Bergi. Do not make jokes. Do not suggest a reply. Return only a short neutral image analysis that can be used as context for a later chat reply.`
    : 'Describe this image briefly in 1–2 sentences. Focus only on what is visibly in the image. Do not suggest a reply. Do not write as Bergi. Do not include headings, bullet points, or labels. Just return a short neutral description that can be used as context for a later chat reply.'

  const response = await fetchOpenAIChatCompletionWithFallback({
    baseUrl,
    apiKey,
    model,
    fallbackModel,
    body: {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    },
  })

  if (!response.ok) {
    await logOpenAIChatCompletionFailure(response)
    throw new Error(`Image description request failed: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (typeof content !== 'string') {
    throw new Error('Image description response did not include content')
  }

  return content
}

async function getTelegramFilePath(fileId: string): Promise<string> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`)

  if (!response.ok) {
    throw new Error(`Telegram getFile request failed: ${response.status}`)
  }

  const data = await response.json()
  const filePath = data.result?.file_path

  if (!data.ok || typeof filePath !== 'string') {
    throw new Error('Telegram getFile response did not include a file path')
  }

  return filePath
}

async function downloadTelegramFile(filePath: string): Promise<ArrayBuffer> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`)
  }

  return response.arrayBuffer()
}

async function transcribeAudio(audioBuffer: ArrayBuffer, filename = 'voice.ogg'): Promise<string> {
  const baseUrl = process.env.TRANSCRIPTION_BASE_URL
  const apiKey = process.env.TRANSCRIPTION_API_KEY
  const model = process.env.TRANSCRIPTION_MODEL || 'whisper-1'

  if (!baseUrl || !apiKey) {
    throw new Error('Missing transcription environment variables')
  }

  const formData = new FormData()
  const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' })

  formData.append('model', model)
  formData.append('file', audioBlob, filename)

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Audio transcription request failed: ${response.status}`)
  }

  const data = await response.json()

  if (typeof data.text !== 'string') {
    throw new Error('Audio transcription response did not include text')
  }

  return data.text
}

function formatVoiceTranscriptForLLM(transcript: string): string {
  return `The user's message below was transcribed from a Telegram voice message.
It may contain filler words, repeated phrases, incomplete sentences, mixed language, or transcription errors.
Infer the user's intent carefully using the recent conversation context, but do not invent missing details.
If the transcript is unclear, ask a brief clarifying question instead of pretending to understand.

Transcript:
${transcript}`
}

function formatForTelegramPlainText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram sendMessage request failed: ${response.status}`)
  }
}

export async function POST(request: Request) {
  let chatId: number | undefined

  try {
    const update = (await request.json()) as TelegramUpdate
    chatId = update.message?.chat?.id
    const userText = update.message?.text
    const caption = update.message?.caption
    const voice = update.message?.voice
    const photo = update.message?.photo
    const from = update.message?.from
    const isLocalTestMode = process.env.LOCAL_TEST_MODE === 'true'

    console.log('Telegram webhook message:', update.message)

    if (chatId === undefined || from?.id === undefined) {
      return new Response('OK', { status: 200 })
    }

    if (!isAllowedTelegramUser(from.id)) {
      console.log('Blocked unauthorized Telegram user:', from.id)

      if (isLocalTestMode) {
        console.log('Local test unauthorized response:', 'Sorry, Bergi is currently private.')
      } else {
        await sendTelegramMessage(chatId, 'Sorry, Bergi is currently private.')
      }

      return new Response('OK', { status: 200 })
    }

    const selectedPhoto = chooseTelegramPhotoSize(photo)

    if (userText === undefined && voice === undefined && selectedPhoto === null) {
      let nonTextReply = "eh I received something, but I don't know how to process it yet 😵‍💫"
      let nonTextContent = '[unknown] user sent an unsupported message type'

      if (update.message?.sticker) {
        nonTextReply = 'wah sticker only ah, I cannot read your mind yet 😭'
        nonTextContent = '[sticker] user sent a sticker'
      } else if (update.message?.animation) {
        nonTextReply = 'gif received but I not smart enough to understand it yet sia'
        nonTextContent = '[gif] user sent a GIF'
      }

      const supabase = getSupabase()
      const userId = await findOrCreateUserAccount({
        supabase,
        platformUserId: String(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      })

      await saveMessage({ supabase, userId, role: 'user', content: nonTextContent })

      if (isLocalTestMode) {
        console.log('Local test non-text response:', nonTextReply)
      } else {
        await sendTelegramMessage(chatId, nonTextReply)
      }

      try {
        await saveMessage({ supabase, userId, role: 'assistant', content: nonTextReply })
      } catch (saveAssistantError) {
        console.error('Failed to save non-text assistant reply:', saveAssistantError)
      }

      return new Response('OK', { status: 200 })
    }

    const supabase = getSupabase()
    const userId = await findOrCreateUserAccount({
      supabase,
      platformUserId: String(from.id),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    })

    let userMessageToSave: string
    let userMessageForLLM: string

    if (voice !== undefined) {
      if (voice.duration !== undefined && voice.duration > 40) {
        const voiceTooLongReply = 'wah minxie this voice note too long sia 😭 keep it under 40 seconds first'

        await saveMessage({
          supabase,
          userId,
          role: 'user',
          content: '[voice too long] user sent a voice message longer than 40 seconds',
        })

        if (isLocalTestMode) {
          console.log('Local test voice too long response:', voiceTooLongReply)
        } else {
          await sendTelegramMessage(chatId, voiceTooLongReply)
        }

        try {
          await saveMessage({ supabase, userId, role: 'assistant', content: voiceTooLongReply })
        } catch (saveAssistantError) {
          console.error('Failed to save voice-too-long assistant reply:', saveAssistantError)
        }

        return new Response('OK', { status: 200 })
      }

      const filePath = await getTelegramFilePath(voice.file_id)
      const audioBuffer = await downloadTelegramFile(filePath)
      const transcript = await transcribeAudio(audioBuffer)

      userMessageToSave = `[voice transcript] ${transcript}`
      userMessageForLLM = formatVoiceTranscriptForLLM(transcript)
    } else if (selectedPhoto !== null) {
      const filePath = await getTelegramFilePath(selectedPhoto.file_id)
      const imageBuffer = await downloadTelegramFile(filePath)
      const imageDescription = await describeImage(imageBuffer, 'image/jpeg', caption)

      if (caption) {
        userMessageToSave = `[photo] ${imageDescription}\n[caption] ${caption}`
        userMessageForLLM = `The user sent a Telegram photo with a caption/question. Use the image analysis below to answer the user's caption/question directly first. After answering, you may add Bergi personality lightly, but do not ignore the question.

Image description:
${imageDescription}

User caption:
${caption}

Reply naturally as Bergi using the recent conversation context.`
      } else {
        userMessageToSave = `[photo] ${imageDescription}`
        userMessageForLLM = `The user sent a Telegram photo. The image was analyzed automatically.

Image description:
${imageDescription}

Reply naturally as Bergi using the recent conversation context.`
      }
    } else {
      if (userText === undefined) {
        throw new Error('Expected text message but userText was undefined')
      }

      userMessageToSave = userText
      userMessageForLLM = userText
    }

    await saveMessage({ supabase, userId, role: 'user', content: userMessageToSave })

    const isPlainTextMessage = userText !== undefined && voice === undefined && selectedPhoto === null

    if (isPlainTextMessage) {
      const telegramCommand = normalizeTelegramCommand(userText)

      if (telegramCommand === '/help') {
        const helpReply = getHelpReply()

        if (isLocalTestMode) {
          console.log('Local test help reply:', helpReply)
        } else {
          await sendTelegramMessage(chatId, helpReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: helpReply })
        return new Response('OK', { status: 200 })
      }

      const proactiveCheckinAction =
        getProactiveCheckinControlActionFromCommand(telegramCommand) ?? getProactiveCheckinControlAction(userText)

      if (proactiveCheckinAction !== null) {
        const proactiveCheckinReply = await resolveProactiveCheckinControlReply({
          supabase,
          userId,
          chatId,
          action: proactiveCheckinAction,
        })

        if (isLocalTestMode) {
          console.log('Local test proactive check-in control reply:', proactiveCheckinReply)
        } else {
          await sendTelegramMessage(chatId, proactiveCheckinReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: proactiveCheckinReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (
      isPlainTextMessage &&
      (normalizeTelegramCommand(userText) === '/list_reminders' || isLikelyListRemindersRequest(userText))
    ) {
      const upcomingReminders = await getUpcomingReminders({ supabase, userId, chatId })
      const remindersReply = formatUpcomingReminders(upcomingReminders)

      if (isLocalTestMode) {
        console.log('Local test reminders list:', remindersReply)
      } else {
        await sendTelegramMessage(chatId, remindersReply)
      }

      await saveMessage({ supabase, userId, role: 'assistant', content: remindersReply })
      return new Response('OK', { status: 200 })
    }

    if (isPlainTextMessage && isLikelyCancelReminderRequest(userText)) {
      const upcomingReminders = await getUpcomingReminders({ supabase, userId, chatId })
      const cancelNumber = parseReminderCancelNumber(userText)
      const lowerUserText = userText.toLowerCase()
      const shouldCancelNext =
        lowerUserText.includes('cancel next reminder') ||
        lowerUserText.includes('delete next reminder') ||
        lowerUserText.includes('remove next reminder')
      const shouldCancelLatest =
        lowerUserText.includes('latest') || lowerUserText.includes('last') || lowerUserText.includes('最新')
      let cancelReply: string

      if (cancelNumber !== null) {
        const reminderToCancel = upcomingReminders[cancelNumber - 1]

        if (!reminderToCancel) {
          cancelReply = `I can’t find reminder ${cancelNumber}. Say “list reminders” to see your upcoming reminders.`
        } else {
          const didCancel = await cancelReminderById({ supabase, reminderId: reminderToCancel.id })
          cancelReply = didCancel
            ? `Cancelled reminder ${cancelNumber}: ${reminderToCancel.reminder_text}`
            : 'That reminder is no longer active. Say “list reminders” to see your upcoming reminders.'
        }
      } else if (shouldCancelNext) {
        const reminderToCancel = upcomingReminders[0]

        if (!reminderToCancel) {
          cancelReply = 'You don’t have any upcoming reminders.'
        } else {
          const didCancel = await cancelReminderById({ supabase, reminderId: reminderToCancel.id })
          cancelReply = didCancel
            ? `Cancelled your next reminder: ${reminderToCancel.reminder_text}`
            : 'That reminder is no longer active. Say “list reminders” to see your upcoming reminders.'
        }
      } else if (shouldCancelLatest) {
        cancelReply = '“Latest” can be ambiguous. Say “list reminders” first, then “cancel reminder 1”, or say “cancel next reminder”.'
      } else {
        cancelReply = 'Which reminder should I cancel? Say “list reminders” to see them.'
      }

      if (isLocalTestMode) {
        console.log('Local test cancel reminder reply:', cancelReply)
      } else {
        await sendTelegramMessage(chatId, cancelReply)
      }

      await saveMessage({ supabase, userId, role: 'assistant', content: cancelReply })
      return new Response('OK', { status: 200 })
    }

    if (isPlainTextMessage && isLikelyRescheduleReminderRequest(userText)) {
      const upcomingReminders = await getUpcomingReminders({ supabase, userId, chatId })

      if (upcomingReminders.length === 0) {
        const noRemindersReply = 'You don’t have any upcoming reminders to reschedule.'

        if (isLocalTestMode) {
          console.log('Local test reschedule no reminders reply:', noRemindersReply)
        } else {
          await sendTelegramMessage(chatId, noRemindersReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: noRemindersReply })
        return new Response('OK', { status: 200 })
      }

      const managementIntent = await extractReminderManagementIntent({ userText, upcomingReminders })

      if (managementIntent.action === 'ask_clarifying_question') {
        const clarifyingReply = formatForTelegramPlainText(managementIntent.reply)

        if (isLocalTestMode) {
          console.log('Local test reschedule clarifying reply:', clarifyingReply)
        } else {
          await sendTelegramMessage(chatId, clarifyingReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: clarifyingReply })
        return new Response('OK', { status: 200 })
      }

      if (managementIntent.action === 'reschedule_reminder') {
        const reminderToReschedule = upcomingReminders.find((reminder) => reminder.id === managementIntent.reminder_id)
        let rescheduleReply: string

        if (!reminderToReschedule) {
          rescheduleReply = 'I couldn’t find that reminder. Say “list reminders” to see your upcoming reminders.'
        } else if (Number.isNaN(Date.parse(managementIntent.new_remind_at))) {
          rescheduleReply = 'I couldn’t understand the new reminder time. Can you give me a clear future time?'
        } else if (!hasExplicitTimezoneOffset(managementIntent.new_remind_at)) {
          rescheduleReply = 'Please include a clear timezone for the new reminder time.'
        } else if (new Date(managementIntent.new_remind_at).getTime() <= Date.now()) {
          rescheduleReply = 'That new reminder time has already passed. Please choose a future time.'
        } else {
          const didReschedule = await rescheduleReminderById({
            supabase,
            reminderId: managementIntent.reminder_id,
            newRemindAt: managementIntent.new_remind_at,
          })
          rescheduleReply = didReschedule
            ? `Moved "${reminderToReschedule.reminder_text}" to ${formatManagedReminderTime(
                managementIntent.new_remind_at,
                reminderToReschedule.timezone
              )} ${getTimezoneLabel(reminderToReschedule.timezone)}.`
            : 'That reminder is no longer active. Say “list reminders” to see your upcoming reminders.'
        }

        if (isLocalTestMode) {
          console.log('Local test reschedule reply:', rescheduleReply)
        } else {
          await sendTelegramMessage(chatId, rescheduleReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: rescheduleReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage) {
      const awaitingReminder = await getLatestAwaitingReminder({ supabase, userId, chatId })
      const lowerUserText = userText.toLowerCase().trim()

      if (
        awaitingReminder &&
        isLikelyReminderPreferenceReply(userText) &&
        (!isLikelyNewReminderCommand(userText) || lowerUserText === 'remind me now')
      ) {
        const preferenceReply = formatForTelegramPlainText(
          await resolveReminderPreferenceReply({ supabase, awaitingReminder, userText })
        )

        if (isLocalTestMode) {
          console.log('Local test reminder preference reply:', preferenceReply)
        } else {
          await sendTelegramMessage(chatId, preferenceReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: preferenceReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage && isLikelyReminderRequest(userText)) {
      const reminderExtraction = await extractReminderFromText(userText)

      if (reminderExtraction.action === 'create_reminder') {
        await saveReminder({
          supabase,
          userId,
          chatId,
          reminderText: reminderExtraction.reminder_text,
          eventTime: reminderExtraction.event_time,
          remindAt: reminderExtraction.remind_at,
          timezone: reminderExtraction.timezone || 'Asia/Singapore',
          sourceMessageContent: userText,
        })

        const reminderConfirmation = formatForTelegramPlainText(reminderExtraction.confirmation_message)

        if (isLocalTestMode) {
          console.log('Local test reminder confirmation:', reminderConfirmation)
        } else {
          await sendTelegramMessage(chatId, reminderConfirmation)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: reminderConfirmation })
        return new Response('OK', { status: 200 })
      }

      if (reminderExtraction.action === 'ask_clarifying_question') {
        const clarifyingQuestion = formatForTelegramPlainText(reminderExtraction.clarifying_question)

        if (isLocalTestMode) {
          console.log('Local test reminder clarifying question:', clarifyingQuestion)
        } else {
          await sendTelegramMessage(chatId, clarifyingQuestion)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: clarifyingQuestion })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage && !isLikelyReminderRequest(userText)) {
      if (isLikelyFutureEventMention(userText)) {
        const futureEventExtraction = await extractFutureEventFromText(userText)

        if (futureEventExtraction.action === 'future_event_detected') {
          await saveAwaitingReminderPreference({
            supabase,
            userId,
            chatId,
            eventTitle: futureEventExtraction.event_title,
            eventTime: futureEventExtraction.event_time,
            timezone: futureEventExtraction.timezone || 'Asia/Singapore',
            sourceMessageContent: userText,
          })

          const askMessage = formatForTelegramPlainText(futureEventExtraction.ask_message)

          if (isLocalTestMode) {
            console.log('Local test future event ask message:', askMessage)
          } else {
            await sendTelegramMessage(chatId, askMessage)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: askMessage })
          return new Response('OK', { status: 200 })
        }

        if (futureEventExtraction.action === 'ask_clarifying_question') {
          const clarifyingQuestion = formatForTelegramPlainText(futureEventExtraction.clarifying_question)

          if (isLocalTestMode) {
            console.log('Local test future event clarifying question:', clarifyingQuestion)
          } else {
            await sendTelegramMessage(chatId, clarifyingQuestion)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: clarifyingQuestion })
          return new Response('OK', { status: 200 })
        }
      }
    }

    const profile = await getUserProfile({ supabase, userId })
    const systemPrompt =
      profile?.personalityPrompt ??
      'You are Bergi, a private AI friend on Telegram. Reply casually, warmly, and concisely. Use recent chat history for context, but do not over-explain.'
    const responseModeGuidance = `
Response mode guidance:
Before replying, privately decide what kind of response Min needs. Do not mention the mode label.

Use casual chat mode when Min is just chatting, sharing something lightly, or asking for a normal friendly reply.

Use organise mode when Min explicitly says things like:
- organise this
- summarize this
- make this clearer
- help me plan this
- what should I do next
- turn this into steps
- structure this
- clean this up

Also use organise mode when Min sends a long, messy, brain-dump style message or voice transcript that clearly needs structure, even if he does not explicitly say "organise".

In organise mode:
- be clear and useful first
- use compact plain-text structure
- use short plain-text section labels like "Do this now:" or "Next steps:"
- use numbered lists for priority/order
- use simple bullets with "-"
- remove repeated/filler ideas
- preserve Min's intended meaning
- do not invent missing details
- ask a brief clarifying question if the message is too unclear
- keep the output compact unless Min asks for detail

Telegram formatting rule:
Telegram messages are currently sent as plain text. Do not use Markdown or HTML formatting.
Never use:
- **bold**
- *italic*
- ### headings
- markdown tables
- horizontal rules
- backticks for emphasis

Bad:
**Do this now:**
**1. Boss meeting prep**

Good:
Do this now:

1. Boss meeting prep
- What you finished
- What is pending

Style rule:
Always answer Min's actual request first. Use humour, Singlish, and playful friend energy lightly, but not in every reply. Avoid turning every response into a comedy bit.
`
    const finalSystemPrompt = `${systemPrompt}

${responseModeGuidance}`
    const recentMessages = await getRecentMessages({ supabase, userId })
    const recentMessagesForLLM = [...recentMessages]

    if (voice !== undefined || selectedPhoto !== null) {
      for (let index = recentMessagesForLLM.length - 1; index >= 0; index -= 1) {
        const message = recentMessagesForLLM[index]

        if (message.role === 'user') {
          recentMessagesForLLM[index] = { ...message, content: userMessageForLLM }
          break
        }
      }
    } else if (userText !== undefined) {
      let latestUserMessageIndex = -1

      for (let index = recentMessagesForLLM.length - 1; index >= 0; index -= 1) {
        if (recentMessagesForLLM[index].role === 'user') {
          latestUserMessageIndex = index
          break
        }
      }

      const latestPhotoContext = recentMessagesForLLM
        .slice(0, latestUserMessageIndex)
        .reverse()
        .find((message) => message.role === 'user' && message.content.startsWith('[photo]'))?.content

      if (latestUserMessageIndex !== -1 && latestPhotoContext) {
        recentMessagesForLLM[latestUserMessageIndex] = {
          ...recentMessagesForLLM[latestUserMessageIndex],
          content: `The user sent this text message after a recent photo.

Recent photo context:
${latestPhotoContext}

Current text message:
${userText}

Reply naturally as Bergi. If the current text seems related to the photo, use the photo context. If it does not seem related, prioritize the text message.`,
        }
      }
    }

    const trimmedMessages = trimMessagesByCharacterLimit(recentMessagesForLLM, 4000)
    const llmResponse = await callLLM({ chatMessages: trimmedMessages, systemPrompt: finalSystemPrompt })
    const telegramReply = formatForTelegramPlainText(llmResponse)

    if (isLocalTestMode) {
      console.log('Local test LLM response:', telegramReply)
      await saveMessage({ supabase, userId, role: 'assistant', content: telegramReply })
    } else {
      await sendTelegramMessage(chatId, telegramReply)
      await saveMessage({ supabase, userId, role: 'assistant', content: telegramReply })
    }
  } catch (error) {
    console.error('Telegram webhook error:', error)

    try {
      if (chatId !== undefined) {
        await sendTelegramMessage(chatId, 'eh minxie I glitch a bit just now 😵‍💫 try again later can?')
      }
    } catch (fallbackError) {
      console.error('Telegram fallback message error:', fallbackError)
    }
  }

  return new Response('OK', { status: 200 })
}

export async function GET() {
  return Response.json({
    ok: true,
    route: 'telegram webhook',
    message: 'Bergi Telegram route is alive',
  })
}
