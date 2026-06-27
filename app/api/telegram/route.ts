import { createClient } from '@supabase/supabase-js'

import {
  classifyLifeThreadLabel,
  getLifeThreadNotesForDateRange,
  getRecentLifeThreadNotes,
} from '@/lib/life-thread-notes'
import {
  formatRecentLifeThreadNotesForTelegram,
  formatNaturalMemorySummary,
  findMostRelevantLifeThreadNote,
  formatMostRelevantLifeThreadNoteForPrompt,
  formatRecentLifeThreadNotesForPrompt,
  formatLifeThreadTopic,
} from '@/lib/memory-prompts'
import { formatRecentProactiveCheckinForPrompt } from '@/lib/proactive-reply-context'
import {
  formatDailyRecapNotesForPrompt,
  getDailyRecapSystemPrompt,
  getDailyRecapThreadFilter,
  isDailyRecapRequest,
} from '@/lib/daily-recap'
import {
  CalendarReadError,
  type CalendarEvent,
  type CalendarPlanningIntent,
  type CalendarQueryIntent,
  detectCalendarPlanningIntent,
  detectCalendarQueryIntent,
  createGoogleCalendarEvent,
  getCalendarClarificationReply,
  getCalendarPlanningClarificationReply,
  getCalendarReadEnvValidationMetadata,
  queryGoogleCalendarEvents,
} from '@/lib/calendar-read'
import { inferCalendarEventColor } from '@/lib/calendar-colors'
import {
  classifyFinanceIntent,
  createNotionExpenseLog,
  detectFinanceCandidate,
  detectFinanceQueryIntent,
  formatFinanceCorrectionForParser,
  formatExpenseLoggedReply,
  type FinanceExpenseQueryResult,
  type FinanceQueryIntent,
  NotionExpenseLogError,
  parseFinanceAmountCorrection,
  parseExpenseLogWithLLM,
  parsePendingSuspiciousExpenseConfirmation,
  queryNotionExpenses,
  validateExpenseLogForNotion,
} from '@/lib/finance-logging'
import { generateDailyProactiveCheckins, getOrCreateProactivePreferences } from '@/lib/proactive-checkins'
import { createSupabaseExpense, querySupabaseExpenses } from '@/lib/supabase-expenses'
import { truncateText } from '@/lib/text-utils'
import {
  ensureDefaultFeatureFlags,
  type UserFeatureFlags,
  isOwnerTelegramUser,
  setUserProactiveFeature,
  upsertOnboardingState,
} from '@/lib/user-feature-flags'
import {
  disconnectGoogleCalendarIntegration,
  getGoogleCalendarConnectionStatus,
  getGoogleCalendarOAuthAccess,
  GoogleCalendarOAuthError,
  type GoogleCalendarAccess,
} from '@/lib/google-calendar-oauth'

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
  callback_query?: {
    id: string
    data?: string
    from?: {
      id?: number
      username?: string
      first_name?: string
      last_name?: string
    }
    message?: {
      chat?: {
        id?: number
      }
    }
  }
}

function getTelegramMessageTypes(message: TelegramUpdate['message']): string[] {
  if (!message) {
    return []
  }

  return [
    typeof message.text === 'string' ? 'text' : null,
    typeof message.caption === 'string' ? 'caption' : null,
    message.voice ? 'voice' : null,
    message.photo ? 'photo' : null,
    message.sticker ? 'sticker' : null,
    message.animation ? 'animation' : null,
  ].filter((messageType): messageType is string => messageType !== null)
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function logFinanceInfo(event: string, fields: Record<string, unknown> = {}): void {
  console.log(event, fields)
}

function logFinanceError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(event, fields)
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

type PendingReminderTimeRow = {
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

type PendingCalendarEventRow = {
  id: string
  title: string
  start_at: string
  end_at: string
  is_all_day: boolean
  all_day_date: string | null
  timezone: string
  description: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

type PendingCalendarTimeRow = PendingCalendarEventRow
type PendingCalendarDateRow = PendingCalendarEventRow

type CalendarEventDraft = {
  title: string
  startAt: string
  endAt: string
  isAllDay: boolean
  allDayDate: string | null
  timezone: string
  description: string | null
  datePeriod: string
  durationMinutes: number
  colorCategory: string
  colorId?: string
}

type CalendarCreateTimeRange = {
  startTime: string
  endTime: string
  durationMinutes: number
  crossesMidnight: boolean
  needsClarification: boolean
}

type CalendarCreateIntent =
  | {
      action: 'draft'
      draft: CalendarEventDraft
    }
  | {
      action: 'ask_time'
      reply: string
      title: string
      localDate: string
      timezone: string
      datePeriod: string
      durationMinutes: number
    }
  | {
      action: 'ask_date'
      reply: string
      title: string
      timezone: string
      durationMinutes: number
      defaultAllDay: boolean
    }
  | {
      action: 'ask_clarifying_question'
      reply: string
    }
  | {
      action: 'not_calendar_create'
    }

const PENDING_CALENDAR_EVENT_SELECT =
  'id, title, start_at, end_at, is_all_day, all_day_date, timezone, description, expires_at, created_at, updated_at'

type RecentSentProactiveCheckinRow = {
  id: string
  message_text: string | null
  sent_at: string | null
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
type TelegramSlashCommand =
  | '/start'
  | '/help'
  | '/privacy'
  | '/connect_calendar'
  | '/disconnect_calendar'
  | '/calendar_status'
  | '/stop_checkins'
  | '/checkin_status'
  | '/pause_checkins'
  | '/resume_checkins'
  | '/list_reminders'
  | '/capture_this'
  | '/notes'

type ThoughtCaptureSourceMessage = {
  id: string
  content: string
}

type ThoughtNoteDraft = {
  title: string | null
  summary: string
  open_question: string | null
  next_step: string | null
}

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
    case '/start':
    case '/help':
    case '/privacy':
    case '/connect_calendar':
    case '/disconnect_calendar':
    case '/calendar_status':
    case '/stop_checkins':
    case '/checkin_status':
    case '/pause_checkins':
    case '/resume_checkins':
    case '/list_reminders':
    case '/capture_this':
    case '/notes':
      return command
    default:
      return null
  }
}

function getHelpReply(): string {
  return `hey, I’m Bergi — kind of an AI companion you can talk to.

you can:
• chat with me normally
• send me voice notes
• send me photos and ask about them
• ask me to organise messy thoughts
• ask me to remind you about things
• practise German casually with me
• let me check in on you during the day
• ask me what i remember from recent thoughts

commands:
/checkin_status — see whether check-ins are on
/pause_checkins — pause check-ins
/resume_checkins — resume check-ins
/list_reminders — show active reminders
/capture_this — save the previous thought as a note

you don’t need exact commands most of the time — just talk to me naturally.`
}

function getAlphaStartReply(): string {
  return `Hey, I’m Bergi — Min Xie’s private AI companion project.

For this short private alpha, I can help with:

• chat naturally with you
• remember useful life notes
• understand voice messages
• understand photos you send
• set reminders
• check in proactively, if you enable it
• log and query simple finance records
• help with Google Calendar planning, if you connect Calendar

To work properly, I may store things like your messages, reminders, finance logs, calendar connection status, and useful memory notes.

Please don’t send passwords, private keys, or highly sensitive information.

Ready to try Bergi?`
}

function getAlphaPrivacyReply(): string {
  return `Bergi stores only what it needs to work during this private alpha: messages, reminders, finance logs, check-in settings, calendar connection status, and useful memory notes.

Please don’t send passwords, private keys, or highly sensitive information.

Calendar requires connecting Google Calendar later.`
}

function getAlphaAskNameReply(): string {
  return 'What should I call you?'
}

function getAlphaProactiveChoiceReply(): string {
  return `Do you want Bergi to proactively check in with you during this test?

This is one of Bergi’s core features — it lets Bergi message first instead of only replying when you start the chat.`
}

function getAlphaCalendarChoiceReply(): string {
  return `Want to connect Google Calendar?

This lets Bergi help you check your schedule, find free time, and create calendar events after confirmation.`
}

function getAlphaOnboardingDoneReply(): string {
  return `You’re set.

Try asking me:
• send me a voice note
• send me a photo and ask what I think
• remind me to drink water in 30 minutes
• what’s on my calendar tomorrow?
• when am I free today?
• schedule gym tomorrow 7pm
• log $5 lunch
• check in with me tomorrow morning`
}

function getAlphaCalendarUnavailableReply(): string {
  return 'Please connect Google Calendar first.'
}

function getAlphaCalendarNotConfiguredReply(): string {
  return 'Google Calendar connection is not configured yet. I can still help with reminders and planning in chat.'
}

function getGoogleCalendarConnectUrl(params: { telegramUserId: number; chatId: number }): string | null {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()

  if (!redirectUri) {
    return null
  }

  try {
    const url = new URL('/api/integrations/google/start', new URL(redirectUri).origin)
    url.searchParams.set('telegram_user_id', String(params.telegramUserId))
    url.searchParams.set('chat_id', String(params.chatId))

    return url.toString()
  } catch {
    return null
  }
}

function getGoogleCalendarConnectReplyMarkup(connectUrl: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Connect Google Calendar', url: connectUrl }]],
  }
}

function getGoogleCalendarConnectReply(connectUrl: string | null): {
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
} {
  if (!connectUrl) {
    return { text: getAlphaCalendarNotConfiguredReply() }
  }

  return {
    text: 'Tap below to connect Google Calendar.',
    replyMarkup: getGoogleCalendarConnectReplyMarkup(connectUrl),
  }
}

type CalendarAccessResolution =
  | { canUseCalendar: true; mode: 'service_account' | 'oauth'; access?: GoogleCalendarAccess }
  | { canUseCalendar: false; reply: string }

async function resolveTelegramCalendarAccess(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  telegramUserId: number
  chatId: number
  isOwner: boolean
  featureFlags: UserFeatureFlags
}): Promise<CalendarAccessResolution> {
  if (params.isOwner && params.featureFlags.calendar_enabled) {
    return { canUseCalendar: true, mode: 'service_account' }
  }

  if (params.isOwner) {
    return { canUseCalendar: false, reply: getFeatureUnavailableReply('Calendar') }
  }

  if (!params.featureFlags.calendar_enabled) {
    return { canUseCalendar: false, reply: getAlphaCalendarUnavailableReply() }
  }

  try {
    const access = await getGoogleCalendarOAuthAccess({
      supabase: params.supabase,
      userId: params.userId,
    })

    return { canUseCalendar: true, mode: 'oauth', access }
  } catch (error) {
    const category =
      error instanceof GoogleCalendarOAuthError ? error.category : 'google_calendar_oauth_access_failed'

    console.warn('google_calendar_oauth_access_failed', { category })

    if (category === 'missing_env' || category === 'missing_token_encryption_key') {
      return { canUseCalendar: false, reply: getAlphaCalendarNotConfiguredReply() }
    }

    if (category === 'needs_reconnect' || category === 'token_refresh_failed') {
      return { canUseCalendar: false, reply: 'Please reconnect Google Calendar first.' }
    }

    return { canUseCalendar: false, reply: getAlphaCalendarUnavailableReply() }
  }
}

function getCalendarAccessParams(access: CalendarAccessResolution | null): GoogleCalendarAccess | undefined {
  return access?.canUseCalendar && access.mode === 'oauth' ? access.access : undefined
}

function getFeatureUnavailableReply(feature: string): string {
  return `${feature} isn’t available in this alpha yet.`
}

function getAlphaStartReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Agree and start', callback_data: 'alpha_onboarding_agree' }],
      [{ text: 'Privacy details', callback_data: 'alpha_onboarding_privacy' }],
    ],
  }
}

function getAlphaProactiveReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Light check-ins — recommended', callback_data: 'alpha_onboarding_proactive_light' }],
      [{ text: 'No, only reply when I message', callback_data: 'alpha_onboarding_proactive_none' }],
    ],
  }
}

function getAlphaCalendarReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Connect Google Calendar — recommended', callback_data: 'alpha_onboarding_calendar_connect' }],
      [{ text: 'Skip for now', callback_data: 'alpha_onboarding_calendar_skip' }],
    ],
  }
}

function getProactiveCheckinControlActionFromCommand(
  command: TelegramSlashCommand | null
): ProactiveCheckinControlAction | null {
  switch (command) {
    case '/checkin_status':
      return 'status'
    case '/stop_checkins':
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

function isThoughtCaptureCommand(text: string): boolean {
  if (normalizeTelegramCommand(text) === '/capture_this') {
    return true
  }

  const normalized = text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return (
    normalized === 'save this thought' ||
    normalized === 'capture this' ||
    normalized === 'save that thought' ||
    normalized === 'remember this as a thread note'
  )
}

function isNaturalMemorySummaryRequest(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[?!.。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return (
    normalized === 'what do you remember from recently' ||
    normalized === 'what do you remember about me recently' ||
    normalized === 'what have i been thinking about' ||
    normalized === 'what did i ask you to keep track of' ||
    normalized === 'what are my recent thoughts' ||
    normalized === 'what have i captured recently' ||
    normalized === 'what did you remember'
  )
}

function isMeaningfulThoughtSource(content: string): boolean {
  const normalized = content
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[.!?。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length < 8) {
    return false
  }

  if (normalized.startsWith('/')) {
    return false
  }

  if (isThoughtCaptureCommand(content)) {
    return false
  }

  return !['yes', 'no', 'ok', 'okay', 'haha', 'idk', 'lol', 'nah', 'yep', 'nope'].includes(normalized)
}

function cleanJsonResponse(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1)
  }

  return cleaned
}

function nullableShortString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  return truncateText(trimmed, maxLength)
}

function fallbackThoughtNoteDraft(rawText: string): ThoughtNoteDraft {
  return {
    title: 'captured thought',
    summary: truncateText(rawText, 240),
    open_question: null,
    next_step: null,
  }
}

function parseThoughtNoteDraft(raw: string, rawText: string): ThoughtNoteDraft {
  const parsed = JSON.parse(cleanJsonResponse(raw)) as Record<string, unknown>
  const summary = nullableShortString(parsed.summary, 240)

  if (!summary) {
    return fallbackThoughtNoteDraft(rawText)
  }

  return {
    title: nullableShortString(parsed.title, 80),
    summary,
    open_question: nullableShortString(parsed.open_question, 160),
    next_step: nullableShortString(parsed.next_step, 160),
  }
}

async function structureThoughtNote(rawText: string): Promise<ThoughtNoteDraft> {
  try {
    const raw = await callLLM({
      systemPrompt:
        'You structure a manually captured thought note. Return only valid JSON with keys title, summary, open_question, next_step. Keep every field short. Use null for open_question or next_step when not obvious. Do not add markdown.',
      chatMessages: [
        {
          role: 'user',
          content: `Raw thought:\n${rawText}`,
        },
      ],
    })

    return parseThoughtNoteDraft(raw, rawText)
  } catch (error) {
    console.error('Failed to structure thought note:', error)
    return fallbackThoughtNoteDraft(rawText)
  }
}

async function getLatestMeaningfulPreviousUserMessage(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<ThoughtCaptureSourceMessage | null> {
  const { supabase, userId } = params
  const { data, error } = await supabase
    .from('messages')
    .select('id, content')
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    throw error
  }

  const sourceMessage = (data ?? []).find((message) => {
    const content = typeof message.content === 'string' ? message.content : ''
    return isMeaningfulThoughtSource(content)
  })

  if (!sourceMessage || typeof sourceMessage.content !== 'string') {
    return null
  }

  return {
    id: String(sourceMessage.id),
    content: sourceMessage.content,
  }
}

async function saveLifeThreadNote(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  sourceMessageId: string
  rawText: string
  note: ThoughtNoteDraft
}): Promise<void> {
  const { supabase, userId, sourceMessageId, rawText, note } = params
  const threadLabel = classifyLifeThreadLabel({
    title: note.title,
    summary: note.summary,
    openQuestion: note.open_question,
    nextStep: note.next_step,
    rawText,
  })
  const { error } = await supabase.from('life_thread_notes').insert({
    user_id: userId,
    source_message_id: sourceMessageId,
    title: note.title,
    summary: note.summary,
    open_question: note.open_question,
    next_step: note.next_step,
    thread_label: threadLabel,
    raw_text: rawText,
  })

  if (error) {
    if (await isDuplicateLifeThreadSourceMessageError({ supabase, sourceMessageId, error })) {
      return
    }

    throw error
  }
}

async function isDuplicateLifeThreadSourceMessageError(params: {
  supabase: ReturnType<typeof getSupabase>
  sourceMessageId: string
  error: { code?: string } | null
}): Promise<boolean> {
  if (params.error?.code !== '23505') {
    return false
  }

  const { data, error } = await params.supabase
    .from('life_thread_notes')
    .select('id')
    .eq('source_message_id', params.sourceMessageId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return Boolean(data)
}

function isMeaningfulProactiveProgressReply(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[?!。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (
    normalized.length < 18 ||
    normalized.startsWith('/') ||
    ['yes', 'no', 'ok', 'okay', 'idk', 'haha', 'lol', 'nah', 'nope'].includes(normalized)
  ) {
    return false
  }

  if (/^(can|could|would|will|do|does|did|is|are|what|why|how|when|where)\b/i.test(normalized)) {
    return false
  }

  const progressSignals = [
    'became clearer',
    'become clearer',
    'got clearer',
    'more clear',
    'clearer',
    'got easier',
    'easier',
    'learned',
    'learnt',
    'understood',
    'realised',
    'realized',
    'figured out',
    'finished',
    'completed',
    'moved forward',
    'made progress',
    'less stuck',
    'unstuck',
    'managed to',
    'i did',
    'i got',
    'i think i understood',
  ]

  return progressSignals.some((signal) => normalized.includes(signal))
}

function buildProactiveProgressFallbackNote(rawText: string): ThoughtNoteDraft {
  return {
    title: 'progress from check-in',
    summary: truncateText(rawText, 240),
    open_question: null,
    next_step: null,
  }
}

async function structureProactiveProgressNote(rawText: string): Promise<ThoughtNoteDraft> {
  try {
    const raw = await callLLM({
      systemPrompt:
        'You structure a short progress event from a user replying to a proactive check-in. Return only valid JSON with keys title, summary, open_question, next_step. Title should describe what changed. Summary should be one short sentence in third person using Min. Use null for open_question or next_step when not obvious. Do not add markdown.',
      chatMessages: [
        {
          role: 'user',
          content: `User proactive check-in reply:\n${rawText}`,
        },
      ],
    })

    return parseThoughtNoteDraft(raw, rawText)
  } catch (error) {
    console.error('Failed to structure proactive progress note:', error)
    return buildProactiveProgressFallbackNote(rawText)
  }
}

async function saveProactiveProgressNoteIfMeaningful(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  sourceMessageId: string
  rawText: string
  recentProactiveCheckin: RecentSentProactiveCheckinRow | null
}): Promise<void> {
  const { supabase, userId, sourceMessageId, rawText, recentProactiveCheckin } = params

  if (!recentProactiveCheckin || !isMeaningfulProactiveProgressReply(rawText)) {
    return
  }

  const { data: existingNote, error: existingNoteError } = await supabase
    .from('life_thread_notes')
    .select('id')
    .eq('source_message_id', sourceMessageId)
    .maybeSingle()

  if (existingNoteError) {
    throw existingNoteError
  }

  if (existingNote) {
    return
  }

  const duplicateSinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recentDuplicateNote, error: recentDuplicateNoteError } = await supabase
    .from('life_thread_notes')
    .select('id')
    .eq('user_id', userId)
    .eq('raw_text', rawText)
    .gte('created_at', duplicateSinceIso)
    .limit(1)
    .maybeSingle()

  if (recentDuplicateNoteError) {
    throw recentDuplicateNoteError
  }

  if (recentDuplicateNote) {
    return
  }

  const note = await structureProactiveProgressNote(rawText)
  await saveLifeThreadNote({
    supabase,
    userId,
    sourceMessageId,
    rawText,
    note: {
      ...note,
      title: note.title ?? 'check-in progress',
      summary: `Check-in reply: ${note.summary}`,
    },
  })
}

async function resolveThoughtCaptureReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<string> {
  const { supabase, userId } = params
  const sourceMessage = await getLatestMeaningfulPreviousUserMessage({ supabase, userId })

  if (!sourceMessage) {
    return 'i don’t see a previous thought to capture yet — send me the thought first, then say “save this thought”.'
  }

  const note = await structureThoughtNote(sourceMessage.content)
  await saveLifeThreadNote({
    supabase,
    userId,
    sourceMessageId: sourceMessage.id,
    rawText: sourceMessage.content,
    note,
  })

  return `saved — i captured this as a thread note: ${truncateText(note.summary, 180)}`
}

async function getDailyRecapTimezone(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<string> {
  const { data, error } = await params.supabase
    .from('proactive_preferences')
    .select('timezone')
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return typeof data?.timezone === 'string' && data.timezone.trim() ? data.timezone : 'Asia/Singapore'
}

async function resolveDailyRecapReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  userText: string
}): Promise<string> {
  const timezone = await getDailyRecapTimezone(params)
  const localDate = getLocalDateString(new Date(), timezone)
  const startIso = zonedDateTimeToUtcIso(localDate, '00:00', timezone)
  const endIso = zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', timezone)
  const threadFilter = getDailyRecapThreadFilter(params.userText)
  const notes = await getLifeThreadNotesForDateRange({
    supabase: params.supabase,
    userId: params.userId,
    startIso,
    endIso,
    threadLabel: threadFilter,
  })

  if (notes.length === 0) {
    return 'i don’t have much saved from today yet, so i can’t really recap properly.'
  }

  const threadFocus = threadFilter ? formatLifeThreadTopic(threadFilter) : 'all saved threads'
  const rawRecap = await callLLM({
    systemPrompt: getDailyRecapSystemPrompt(),
    chatMessages: [
      {
        role: 'user',
        content: `User asked: ${params.userText}
Local date: ${localDate}
Timezone: ${timezone}
Thread focus: ${threadFocus}

Today’s notes/progress events:
${formatDailyRecapNotesForPrompt(notes)}`,
      },
    ],
  })

  return formatForTelegramPlainText(rawRecap)
}

function addMonthsToLocalDate(localDate: string, months: number): string {
  const [year, month, day] = localDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, day))

  return date.toISOString().slice(0, 10)
}

function getFinanceQueryDateRange(params: {
  intent: FinanceQueryIntent
  timezone: string
}): { startIso?: string; endIso?: string; label: string; recentLimit?: number } {
  const localDate = getLocalDateString(new Date(), params.timezone)

  if (params.intent.period === 'recent') {
    return {
      label: 'recent',
      recentLimit: 10,
    }
  }

  if (params.intent.period === 'today') {
    return {
      label: 'today',
      startIso: zonedDateTimeToUtcIso(localDate, '00:00', params.timezone),
      endIso: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', params.timezone),
    }
  }

  if (params.intent.period === 'week') {
    const [year, month, day] = localDate.split('-').map(Number)
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const daysSinceMonday = (dayOfWeek + 6) % 7
    const weekStart = addDaysToLocalDate(localDate, -daysSinceMonday)

    return {
      label: 'this week',
      startIso: zonedDateTimeToUtcIso(weekStart, '00:00', params.timezone),
      endIso: zonedDateTimeToUtcIso(addDaysToLocalDate(weekStart, 7), '00:00', params.timezone),
    }
  }

  if (params.intent.period === 'month') {
    const monthStart = `${localDate.slice(0, 7)}-01`

    return {
      label: 'this month',
      startIso: zonedDateTimeToUtcIso(monthStart, '00:00', params.timezone),
      endIso: zonedDateTimeToUtcIso(addMonthsToLocalDate(monthStart, 1), '00:00', params.timezone),
    }
  }

  const yearStart = `${localDate.slice(0, 4)}-01-01`
  const nextYearStart = `${Number(localDate.slice(0, 4)) + 1}-01-01`

  return {
    label: 'this year',
    startIso: zonedDateTimeToUtcIso(yearStart, '00:00', params.timezone),
    endIso: zonedDateTimeToUtcIso(nextYearStart, '00:00', params.timezone),
  }
}

function formatSgdAmount(amount: number): string {
  return `SGD ${amount.toFixed(2)}`
}

function formatFinanceQueryCategory(category: string): string {
  return category.toLowerCase()
}

function formatFinanceQueryReply(params: {
  result: FinanceExpenseQueryResult
  intent: FinanceQueryIntent
  rangeLabel: string
}): string {
  const { result, intent, rangeLabel } = params

  if (result.entries.length === 0) {
    return rangeLabel === 'recent'
      ? "I don’t see any recent expenses logged yet."
      : `I don’t see any expenses logged for ${rangeLabel} yet.`
  }

  if (intent.category) {
    return `${rangeLabel}’s ${formatFinanceQueryCategory(intent.category)} spending is ${formatSgdAmount(
      result.total
    )} across ${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'}.`
  }

  if (intent.kind === 'list' || intent.period === 'today' || intent.period === 'recent') {
    const entryLines = result.entries
      .slice(0, 8)
      .map((entry) => `- ${entry.title} — ${formatSgdAmount(entry.amount)}`)
      .join('\n')
    const moreLine = result.entries.length > 8 ? `\n\nand ${result.entries.length - 8} more.` : ''

    return `${rangeLabel === 'recent' ? 'recently' : rangeLabel}, you spent ${formatSgdAmount(result.total)}:

${entryLines}${moreLine}`
  }

  const categoryLines = result.categoryTotals
    .slice(0, 5)
    .map((category) => `- ${formatFinanceQueryCategory(category.category)}: ${formatSgdAmount(category.total)}`)
    .join('\n')

  return `so far ${rangeLabel}, you spent ${formatSgdAmount(result.total)}.

biggest categories:
${categoryLines}`
}

async function resolveFinanceQueryReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  intent: FinanceQueryIntent
  useNotionFinance: boolean
}): Promise<string> {
  const timezone = await getDailyRecapTimezone(params)
  const range = getFinanceQueryDateRange({ intent: params.intent, timezone })

  logFinanceInfo('finance_query_started', {
    period: params.intent.period,
    hasCategory: params.intent.category !== undefined,
    store: params.useNotionFinance ? 'notion' : 'supabase',
  })

  const result = params.useNotionFinance
    ? await queryNotionExpenses({
        startIso: range.startIso,
        endIso: range.endIso,
        category: params.intent.category,
        recentLimit: range.recentLimit,
      })
    : await querySupabaseExpenses({
        supabase: params.supabase,
        userId: params.userId,
        startIso: range.startIso,
        endIso: range.endIso,
        category: params.intent.category,
        recentLimit: range.recentLimit,
      })

  logFinanceInfo('finance_query_success', {
    count: result.entries.length,
  })

  return formatFinanceQueryReply({
    result,
    intent: params.intent,
    rangeLabel: range.label,
  })
}

async function saveParsedExpenseLog(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  expenseLog: Awaited<ReturnType<typeof parseExpenseLogWithLLM>>
  rawText: string
  source: string
  useNotionFinance: boolean
}): Promise<void> {
  if (params.useNotionFinance) {
    await createNotionExpenseLog({
      expense: params.expenseLog.expense,
      date: params.expenseLog.date,
      amount: params.expenseLog.amount,
      category: params.expenseLog.category,
      comment: params.expenseLog.comment ?? params.rawText,
    })
    return
  }

  await createSupabaseExpense({
    supabase: params.supabase,
    userId: params.userId,
    expenseLog: params.expenseLog,
    rawText: params.rawText,
    source: params.source,
  })
}

function getCalendarQueryDateRange(params: {
  intent: CalendarQueryIntent
  timezone: string
}): { timeMin: string; timeMax?: string; label: string; maxResults: number } {
  const now = new Date()
  const localDate = getLocalDateString(now, params.timezone)

  if (params.intent.period === 'next') {
    return {
      label: 'next',
      timeMin: now.toISOString(),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 365), '00:00', params.timezone),
      maxResults: 1,
    }
  }

  if (params.intent.period === 'tomorrow') {
    const tomorrow = addDaysToLocalDate(localDate, 1)

    return {
      label: 'tomorrow',
      timeMin: zonedDateTimeToUtcIso(tomorrow, '00:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(tomorrow, 1), '00:00', params.timezone),
      maxResults: 10,
    }
  }

  if (params.intent.period === 'today_tomorrow') {
    return {
      label: 'today and tomorrow',
      timeMin: zonedDateTimeToUtcIso(localDate, '00:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 2), '00:00', params.timezone),
      maxResults: 20,
    }
  }

  if (params.intent.period === 'next_weekday') {
    const weekday = params.intent.weekday

    if (weekday === undefined) {
      return {
        label: 'next Monday',
        timeMin: zonedDateTimeToUtcIso(localDate, '00:00', params.timezone),
        timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', params.timezone),
        maxResults: 10,
      }
    }

    const [year, month, day] = localDate.split('-').map(Number)
    const todayDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const daysUntilWeekday = (weekday - todayDayOfWeek + 7) % 7 || 7
    const targetDate = addDaysToLocalDate(localDate, daysUntilWeekday)

    return {
      label: params.intent.weekdayLabel ?? 'next day',
      timeMin: zonedDateTimeToUtcIso(targetDate, '00:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(targetDate, 1), '00:00', params.timezone),
      maxResults: 10,
    }
  }

  if (params.intent.period === 'evening') {
    return {
      label: 'this evening',
      timeMin: zonedDateTimeToUtcIso(localDate, '18:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', params.timezone),
      maxResults: 10,
    }
  }

  if (params.intent.period === 'week' || params.intent.period === 'next_week') {
    const [year, month, day] = localDate.split('-').map(Number)
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const daysSinceMonday = (dayOfWeek + 6) % 7
    const weekStart = addDaysToLocalDate(localDate, -daysSinceMonday + (params.intent.period === 'next_week' ? 7 : 0))

    return {
      label: params.intent.period === 'next_week' ? 'next week' : 'this week',
      timeMin: zonedDateTimeToUtcIso(weekStart, '00:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(weekStart, 7), '00:00', params.timezone),
      maxResults: 50,
    }
  }

  return {
    label: 'today',
    timeMin: zonedDateTimeToUtcIso(localDate, '00:00', params.timezone),
    timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', params.timezone),
    maxResults: 10,
  }
}

function getCalendarEventLocalDate(event: CalendarEvent, timezone: string): string {
  return getLocalDateString(new Date(event.start), timezone)
}

function formatCalendarBusyDayLabel(localDate: string, timezone: string): string {
  const date = new Date(zonedDateTimeToUtcIso(localDate, '12:00', timezone))

  return new Intl.DateTimeFormat('en-SG', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date)
}

function getCalendarEventDurationMs(event: CalendarEvent): number {
  if (event.isAllDay || event.end === null) {
    return 0
  }

  const startMs = Date.parse(event.start)
  const endMs = Date.parse(event.end)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0
  }

  return endMs - startMs
}

function formatScheduledDuration(durationMs: number): string | null {
  if (durationMs <= 0) {
    return null
  }

  const totalMinutes = Math.round(durationMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes}m`
  }

  if (minutes === 0) {
    return `${hours}h`
  }

  return `${hours}h ${minutes}m`
}

function getCalendarBusyJudgment(eventCount: number): 'clear' | 'light' | 'moderate' | 'packed' {
  if (eventCount === 0) {
    return 'clear'
  }

  if (eventCount <= 3) {
    return 'light'
  }

  if (eventCount <= 8) {
    return 'moderate'
  }

  return 'packed'
}

function formatCalendarBusyReply(params: {
  events: CalendarEvent[]
  timezone: string
  label: string
}): string {
  const { events, timezone, label } = params
  const judgment = getCalendarBusyJudgment(events.length)

  if (events.length === 0) {
    return `${label} looks clear.`
  }

  const dayCounts = new Map<string, number>()
  let scheduledDurationMs = 0

  for (const event of events) {
    const eventLocalDate = getCalendarEventLocalDate(event, timezone)
    dayCounts.set(eventLocalDate, (dayCounts.get(eventLocalDate) ?? 0) + 1)
    scheduledDurationMs += getCalendarEventDurationMs(event)
  }

  const busierDayLines = [...dayCounts.entries()]
    .sort(([dateA, countA], [dateB, countB]) => countB - countA || dateA.localeCompare(dateB))
    .slice(0, 5)
    .map(([localDate, count]) => `- ${formatCalendarBusyDayLabel(localDate, timezone)}: ${count}`)
    .join('\n')
  const duration = formatScheduledDuration(scheduledDurationMs)
  const durationLine = duration ? `\n\nabout ${duration} scheduled.` : ''

  return `${label} looks ${judgment === 'moderate' ? 'moderately busy' : judgment} — you have ${events.length} ${
    events.length === 1 ? 'event' : 'events'
  }.${durationLine}

busier days:
${busierDayLines}`
}

function formatCalendarEventTime(event: CalendarEvent, timezone: string): string {
  if (event.isAllDay) {
    return 'all day'
  }

  return new Intl.DateTimeFormat('en-SG', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(event.start))
}

function formatCalendarQueryReply(params: {
  events: CalendarEvent[]
  intent: CalendarQueryIntent
  timezone: string
  label: string
}): string {
  const { events, intent, timezone, label } = params

  if (events.length === 0) {
    if (intent.period === 'next') {
      return 'I don’t see any upcoming calendar events.'
    }

    return `${label} looks clear.`
  }

  if (intent.period === 'next') {
    const [event] = events

    return `your next calendar event is ${event.title} at ${formatCalendarEventTime(event, timezone)}.`
  }

  const eventLines = events
    .slice(0, 10)
    .map((event) => `${formatCalendarEventTime(event, timezone)} — ${event.title}`)
    .join('\n')
  const moreLine = events.length > 10 ? `\n\nand ${events.length - 10} more.` : ''

  return `${label} you have ${events.length} ${events.length === 1 ? 'thing' : 'things'}:

${eventLines}${moreLine}`
}

async function resolveCalendarQueryReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  intent: CalendarQueryIntent
  calendarAccess?: GoogleCalendarAccess
}): Promise<string> {
  if (params.intent.mode === 'clarify' || params.intent.period === 'unsupported') {
    return getCalendarClarificationReply()
  }

  const timezone = await getDailyRecapTimezone(params)
  const range = getCalendarQueryDateRange({ intent: params.intent, timezone })

  console.log('calendar_query_started', {
    period: params.intent.period,
    env: getCalendarReadEnvValidationMetadata(),
  })

  const events = await queryGoogleCalendarEvents({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    maxResults: range.maxResults,
    accessToken: params.calendarAccess?.accessToken,
    calendarId: params.calendarAccess?.calendarId,
  })

  console.log('calendar_query_success', {
    count: events.length,
  })

  if (params.intent.mode === 'busy') {
    return formatCalendarBusyReply({
      events,
      timezone,
      label: range.label,
    })
  }

  return formatCalendarQueryReply({
    events,
    intent: params.intent,
    timezone,
    label: range.label,
  })
}

function isLikelyCalendarCreateRequest(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  const hasBirthdayKeyword = /\b(bday|birthday)\b/.test(normalized)
  const hasMonthDate = hasCalendarMonthDate(normalized)
  const hasCalendarCreateVerb =
    /\b(add|create|schedule|block)\b/.test(normalized) ||
    /\bput\b.*\b(?:calendar|schedule)\b/.test(normalized) ||
    /\bcreate\s+(?:calendar\s+)?event\b/.test(normalized)
  const hasDateOrTime =
    /\b(today|tdy|tomorrow|tmr|this\s+(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)|next\s+(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|morning|afternoon|evening|tonight)\b/.test(
      normalized
    ) ||
    hasMonthDate ||
    /\b(?:at\s*)?(?:[01]?\d|2[0-3])(?::[0-5]\d|\.[0-5]\d)?\s*(?:am|pm)\b/.test(normalized)

  return hasCalendarCreateVerb && (hasDateOrTime || hasBirthdayKeyword)
}

function isCalendarCreateConfirmation(text: string): boolean {
  return /^(yes|yea|yep|yeah|confirm|confirmed|add it|looks good|ok|okay|sure|go ahead|do it)$/i.test(text.trim())
}

function isCalendarCreateCancellation(text: string): boolean {
  return /^(no|nah|cancel|cancel it|don't add it|dont add it|stop|change|not now)$/i.test(text.trim())
}

function isCalendarDraftEditRequest(text: string): boolean {
  return /(?:^|\b)(?:change|move|update|make)(?:\s+it)?\s+to\b/i.test(text.trim())
}

function getWeekdayIndexFromText(value: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (/^sun/.test(value)) return 0
  if (/^mon/.test(value)) return 1
  if (/^tue/.test(value)) return 2
  if (/^wed/.test(value)) return 3
  if (/^thu/.test(value)) return 4
  if (/^fri/.test(value)) return 5
  if (/^sat/.test(value)) return 6

  return null
}

const CALENDAR_MONTH_ALIASES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

const CALENDAR_MONTH_PATTERN =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

function hasCalendarMonthDate(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    new RegExp(`\\b(?:[0-2]?\\d|3[01])(?:st|nd|rd|th)?\\s+${CALENDAR_MONTH_PATTERN}\\b`, 'i').test(normalized) ||
    new RegExp(`\\b${CALENDAR_MONTH_PATTERN}\\s+(?:[0-2]?\\d|3[01])(?:st|nd|rd|th)?\\b`, 'i').test(normalized)
  )
}

function parseCalendarCreateMonthDate(params: {
  text: string
  timezone: string
}): { localDate: string; period: string } | null {
  const normalized = params.text.toLowerCase()
  const dayFirstMatch = normalized.match(
    new RegExp(`\\b([0-2]?\\d|3[01])(?:st|nd|rd|th)?\\s+${CALENDAR_MONTH_PATTERN}(?:\\s+(\\d{4}))?\\b`, 'i')
  )
  const monthFirstMatch =
    dayFirstMatch ??
    normalized.match(
      new RegExp(`\\b${CALENDAR_MONTH_PATTERN}\\s+([0-2]?\\d|3[01])(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`, 'i')
    )

  if (!monthFirstMatch) {
    return null
  }

  const dayText = dayFirstMatch ? monthFirstMatch[1] : monthFirstMatch[2]
  const monthText = dayFirstMatch ? monthFirstMatch[2] : monthFirstMatch[1]
  const explicitYearText = monthFirstMatch[3]

  if (!dayText || !monthText) {
    return null
  }

  const day = Number(dayText)
  const month = CALENDAR_MONTH_ALIASES[monthText.toLowerCase()]

  if (!month || Number.isNaN(day)) {
    return null
  }

  const today = getLocalDateString(new Date(), params.timezone)
  const [currentYear] = today.split('-').map(Number)
  let year = explicitYearText ? Number(explicitYearText) : currentYear
  let localDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  if (!isValidLocalDate(localDate, year, month, day)) {
    return null
  }

  if (!explicitYearText && localDate < today) {
    year += 1
    localDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return {
    localDate,
    period: normalized.slice(monthFirstMatch.index ?? 0, (monthFirstMatch.index ?? 0) + monthFirstMatch[0].length),
  }
}

function isValidLocalDate(localDate: string, year: number, month: number, day: number): boolean {
  const date = new Date(`${localDate}T00:00:00.000Z`)

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function parseCalendarCreateLocalDate(params: {
  text: string
  timezone: string
}): { localDate: string; period: string } | null {
  const normalized = params.text.toLowerCase()
  const today = getLocalDateString(new Date(), params.timezone)

  const monthDate = parseCalendarCreateMonthDate(params)

  if (monthDate) {
    return monthDate
  }

  if (/\b(today|tdy)\b/.test(normalized)) {
    return { localDate: today, period: 'today' }
  }

  if (/\b(tomorrow|tmr)\b/.test(normalized)) {
    return { localDate: addDaysToLocalDate(today, 1), period: 'tomorrow' }
  }

  const weekdayMatch = normalized.match(/\b(this|next)\s+(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/)

  if (weekdayMatch) {
    const relation = weekdayMatch[1]
    const weekday = getWeekdayIndexFromText(weekdayMatch[2])

    if (weekday === null) {
      return null
    }

    const [year, month, day] = today.split('-').map(Number)
    const todayDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    let daysUntil = (weekday - todayDayOfWeek + 7) % 7

    if (relation === 'next' && daysUntil === 0) {
      daysUntil = 7
    }

    return {
      localDate: addDaysToLocalDate(today, daysUntil),
      period: `${relation} ${weekdayMatch[2]}`,
    }
  }

  const bareWeekdayMatch = normalized.match(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/)

  if (!bareWeekdayMatch) {
    return null
  }

  const weekday = getWeekdayIndexFromText(bareWeekdayMatch[1])

  if (weekday === null) {
    return null
  }

  const [year, month, day] = today.split('-').map(Number)
  const todayDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  let daysUntil = (weekday - todayDayOfWeek + 7) % 7

  if (daysUntil === 0) {
    daysUntil = 7
  }

  return {
    localDate: addDaysToLocalDate(today, daysUntil),
    period: bareWeekdayMatch[1],
  }
}

function parseCalendarCreateExplicitDurationMinutes(text: string): number | null {
  const normalized = text.toLowerCase()
  const hoursMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/)
  const minutesMatch = normalized.match(/\b(\d+)\s*(minutes?|mins?|m)\b/)

  if (hoursMatch) {
    return Math.max(15, Math.round(Number(hoursMatch[1]) * 60))
  }

  if (minutesMatch) {
    return Math.max(15, Number(minutesMatch[1]))
  }

  return null
}

function parseCalendarCreateStartTime(text: string): string | null {
  const normalized = text.toLowerCase()
  const atOrColonMatch =
    normalized.match(/\bat\s*([01]?\d|2[0-3])(?:(?::|\.)([0-5]\d))?\s*(am|pm)?\b/) ??
    normalized.match(/\b([01]?\d|2[0-3])(?::|\.)([0-5]\d)\s*(am|pm)?\b/)
  const meridiemMatch = normalized.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/)

  if (atOrColonMatch || meridiemMatch) {
    const hour = Number((atOrColonMatch ?? meridiemMatch)?.[1])
    const minute = atOrColonMatch?.[2] ?? '00'
    const meridiem = atOrColonMatch?.[3] ?? meridiemMatch?.[2]

    if (meridiem === 'pm' && hour < 12) {
      return `${String(hour + 12).padStart(2, '0')}:${minute}`
    }

    if (meridiem === 'am' && hour === 12) {
      return `00:${minute}`
    }

    return `${String(hour).padStart(2, '0')}:${minute}`
  }

  if (/\bmorning\b/.test(normalized)) {
    return '09:00'
  }

  if (/\bafternoon\b/.test(normalized)) {
    return '14:00'
  }

  if (/\b(evening|tonight)\b/.test(normalized)) {
    return '19:00'
  }

  return null
}

function resolveTimeParts(hourText: string, minuteText: string | undefined, meridiem?: string): string | null {
  const hour = Number(hourText)
  const minute = minuteText ? Number(minuteText) : 0

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return null
  }

  if (meridiem === 'pm' && hour >= 1 && hour <= 11) {
    return `${String(hour + 12).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  if (meridiem === 'am' && hour === 12) {
    return `00:${String(minute).padStart(2, '0')}`
  }

  if (hour < 0 || hour > 23) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseCalendarCreateTimeRange(text: string): CalendarCreateTimeRange | null {
  const normalized = text.toLowerCase().replace(/[–—]/g, '-')
  const rangeMatch = normalized.match(
    /\b(?:from\s+)?([01]?\d|2[0-3])(?:(?::|\.)([0-5]\d))?\s*(am|pm)?\s*(?:-|to)\s*([01]?\d|2[0-3])(?:(?::|\.)([0-5]\d))?\s*(am|pm)?\b/
  )

  if (!rangeMatch) {
    return null
  }

  const rawStartHour = Number(rangeMatch[1])
  const rawEndHour = Number(rangeMatch[4])
  const startMeridiem = rangeMatch[3]
  const endMeridiem = rangeMatch[6]
  let inferredStartMeridiem = startMeridiem
  let inferredEndMeridiem = endMeridiem

  if (!inferredStartMeridiem && inferredEndMeridiem) {
    if (inferredEndMeridiem === 'pm') {
      inferredStartMeridiem = rawEndHour === 12 || rawStartHour > rawEndHour ? 'am' : 'pm'
    } else {
      inferredStartMeridiem = 'am'
    }
  }

  if (inferredStartMeridiem && !inferredEndMeridiem) {
    inferredEndMeridiem = inferredStartMeridiem
  }

  const startTime = resolveTimeParts(rangeMatch[1], rangeMatch[2], inferredStartMeridiem)
  const endTime = resolveTimeParts(rangeMatch[4], rangeMatch[5], inferredEndMeridiem)

  if (!startTime || !endTime) {
    return null
  }

  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const startTotal = startHour * 60 + startMinute
  let endTotal = endHour * 60 + endMinute
  const clearlyOvernight =
    /\bovernight\b/.test(normalized) ||
    (inferredStartMeridiem === 'pm' && inferredEndMeridiem === 'am') ||
    (rawStartHour >= 18 && rawEndHour <= 6)

  if (endTotal <= startTotal) {
    if (!clearlyOvernight) {
      return {
        startTime,
        endTime,
        durationMinutes: endTotal - startTotal,
        crossesMidnight: false,
        needsClarification: true,
      }
    }

    endTotal += 24 * 60
  }

  return {
    startTime,
    endTime,
    durationMinutes: endTotal - startTotal,
    crossesMidnight: endTotal >= 24 * 60,
    needsClarification: false,
  }
}

function addMinutesToIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60 * 1000).toISOString()
}

function getCalendarRangeEndAt(params: {
  localDate: string
  endTime: string
  timezone: string
  crossesMidnight: boolean
}): string {
  return zonedDateTimeToUtcIso(
    params.crossesMidnight ? addDaysToLocalDate(params.localDate, 1) : params.localDate,
    params.endTime,
    params.timezone
  )
}

function titleCaseCalendarTitle(title: string): string {
  return title
    .replace(/[–—-]+\s*$/g, '')
    .replace(/\s+[–—-]\s+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 && word.toLowerCase() !== 'gym' ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ')
}

function extractCalendarCreateTitle(text: string): string {
  const title = text
    .replace(/[’']/g, "'")
    .replace(/\bbday\b/gi, 'birthday')
    .replace(/\b(create\s+calendar\s+event\s+for|create\s+event\s+for|put\s+on\s+(?:my\s+)?calendar|add|schedule|block\s+time\s+to|block\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|h)\s+for|block)\b/gi, ' ')
    .replace(new RegExp(`\\b(?:[0-2]?\\d|3[01])(?:st|nd|rd|th)?\\s+${CALENDAR_MONTH_PATTERN}(?:\\s+\\d{4})?\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b${CALENDAR_MONTH_PATTERN}\\s+(?:[0-2]?\\d|3[01])(?:st|nd|rd|th)?(?:\\s+\\d{4})?\\b`, 'gi'), ' ')
    .replace(/\b(today|tdy|tomorrow|tmr|this\s+(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|next\s+(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi, ' ')
    .replace(/\b(?:from\s+)?(?:[01]?\d|2[0-3])(?:(?::|\.)[0-5]\d)?\s*(?:am|pm)?\s*(?:-|to)\s*(?:[01]?\d|2[0-3])(?:(?::|\.)[0-5]\d)?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b(?:at\s*)?(?:[01]?\d|2[0-3])(?:(?::|\.)[0-5]\d)?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b(morning|afternoon|evening|tonight)\b/gi, ' ')
    .replace(/\b(for|to|on|at)\b/gi, ' ')
    .replace(/[–—-]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return titleCaseCalendarTitle(title || 'Calendar event')
}

function parseCalendarCreateIntent(params: {
  text: string
  timezone: string
}): CalendarCreateIntent {
  if (!isLikelyCalendarCreateRequest(params.text)) {
    return { action: 'not_calendar_create' }
  }

  const timeRange = parseCalendarCreateTimeRange(params.text)
  const startTime = timeRange?.startTime ?? parseCalendarCreateStartTime(params.text)
  const title = extractCalendarCreateTitle(params.text)
  const color = inferCalendarEventColor(title)
  const isBirthday = /\bbirthday\b/i.test(title)

  if (timeRange?.needsClarification) {
    return {
      action: 'ask_clarifying_question',
      reply: 'I found an end time before the start time. Should this be an overnight event?',
    }
  }

  const date = parseCalendarCreateLocalDate({ text: params.text, timezone: params.timezone })

  if (!date) {
    if (!isBirthday) {
      return {
        action: 'ask_clarifying_question',
        reply: 'what day should I add that to your calendar?',
      }
    }

    return {
      action: 'ask_date',
      reply: `what date should I add ${title.toLowerCase()} to your calendar?`,
      title,
      timezone: params.timezone,
      durationMinutes: parseCalendarCreateExplicitDurationMinutes(params.text) ?? timeRange?.durationMinutes ?? 60,
      defaultAllDay: isBirthday && !startTime,
    }
  }

  if (!startTime) {
    if (isBirthday) {
      return {
        action: 'draft',
        draft: {
          title,
          startAt: zonedDateTimeToUtcIso(date.localDate, '00:00', params.timezone),
          endAt: zonedDateTimeToUtcIso(addDaysToLocalDate(date.localDate, 1), '00:00', params.timezone),
          isAllDay: true,
          allDayDate: date.localDate,
          timezone: params.timezone,
          description: null,
          datePeriod: date.period,
          durationMinutes: 24 * 60,
          colorCategory: color.category,
          colorId: color.colorId,
        },
      }
    }

    return {
      action: 'ask_time',
      reply: `what time should I add ${title.toLowerCase()} ${date.period}?`,
      title,
      localDate: date.localDate,
      timezone: params.timezone,
      datePeriod: date.period,
      durationMinutes: parseCalendarCreateExplicitDurationMinutes(params.text) ?? 60,
    }
  }

  const durationMinutes =
    timeRange?.durationMinutes ?? parseCalendarCreateExplicitDurationMinutes(params.text) ?? 60
  const startAt = zonedDateTimeToUtcIso(date.localDate, startTime, params.timezone)

  return {
    action: 'draft',
    draft: {
      title,
      startAt,
      endAt: timeRange
        ? getCalendarRangeEndAt({
            localDate: date.localDate,
            endTime: timeRange.endTime,
            timezone: params.timezone,
            crossesMidnight: timeRange.crossesMidnight,
          })
        : addMinutesToIso(startAt, durationMinutes),
      isAllDay: false,
      allDayDate: null,
      timezone: params.timezone,
      description: null,
      datePeriod: date.period,
      durationMinutes,
      colorCategory: color.category,
      colorId: color.colorId,
    },
  }
}

function formatCalendarDraftTimeRange(params: {
  startAt: string
  endAt: string
  timezone: string
}): string {
  const dayLabel = new Intl.DateTimeFormat('en-SG', {
    timeZone: params.timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(params.startAt))
  const start = formatCalendarPlanningTime(Date.parse(params.startAt), params.timezone)
  const end = formatCalendarPlanningTime(Date.parse(params.endAt), params.timezone)

  return `${dayLabel}, ${start}-${end}`
}

function formatCalendarAllDayDate(localDate: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${localDate}T12:00:00.000Z`))
}

function formatCalendarDraftDateTime(draft: CalendarEventDraft | PendingCalendarEventRow): string {
  const isAllDay = 'isAllDay' in draft ? draft.isAllDay : draft.is_all_day
  const allDayDate = 'allDayDate' in draft ? draft.allDayDate : draft.all_day_date

  if (isAllDay && allDayDate) {
    return `${formatCalendarAllDayDate(allDayDate)}, all day`
  }

  return formatCalendarDraftTimeRange({
    startAt: 'startAt' in draft ? draft.startAt : draft.start_at,
    endAt: 'endAt' in draft ? draft.endAt : draft.end_at,
    timezone: draft.timezone,
  })
}

function formatCalendarCreateDraftReply(draft: CalendarEventDraft): string {
  return `I can add this to your calendar:

${draft.title}
${formatCalendarDraftDateTime(draft)}

Confirm?`
}

function formatCalendarCreatedReply(draft: PendingCalendarEventRow): string {
  return `added: ${draft.title} — ${formatCalendarDraftDateTime(draft)}.`
}

function getCalendarPendingSafeMetadata(draft: PendingCalendarEventRow): {
  pendingAgeSeconds: number
  durationMinutes: number
  hasStartTime: boolean
  hasEndTime: boolean
} {
  return {
    pendingAgeSeconds: Math.max(0, Math.round((Date.now() - Date.parse(draft.created_at)) / 1000)),
    durationMinutes: Math.max(0, Math.round((Date.parse(draft.end_at) - Date.parse(draft.start_at)) / 60000)),
    hasStartTime: !draft.is_all_day && !Number.isNaN(Date.parse(draft.start_at)),
    hasEndTime: !draft.is_all_day && !Number.isNaN(Date.parse(draft.end_at)),
  }
}

async function savePendingCalendarEvent(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  draft: CalendarEventDraft
}): Promise<void> {
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString()

  const { error: supersedeError } = await params.supabase
    .from('pending_calendar_events')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .in('status', ['pending', 'awaiting_time', 'awaiting_date'])

  if (supersedeError) {
    throw supersedeError
  }

  const { error } = await params.supabase.from('pending_calendar_events').insert({
    user_id: params.userId,
    platform: 'telegram',
    telegram_chat_id: params.chatId,
    title: params.draft.title,
    start_at: params.draft.startAt,
    end_at: params.draft.endAt,
    is_all_day: params.draft.isAllDay,
    all_day_date: params.draft.allDayDate,
    timezone: params.draft.timezone,
    description: params.draft.description,
    status: 'pending',
    expires_at: expiresAt,
  })

  if (error) {
    throw error
  }
}

async function getLatestPendingCalendarEvent(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<PendingCalendarEventRow | null> {
  const { data, error } = await params.supabase
    .from('pending_calendar_events')
    .select(PENDING_CALENDAR_EVENT_SELECT)
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function updatePendingCalendarEventStatus(params: {
  supabase: ReturnType<typeof getSupabase>
  id: string
  status: 'confirmed' | 'cancelled' | 'failed'
}): Promise<void> {
  const { error } = await params.supabase
    .from('pending_calendar_events')
    .update({ status: params.status, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) {
    throw error
  }
}

async function updatePendingCalendarEventDraft(params: {
  supabase: ReturnType<typeof getSupabase>
  id: string
  startAt: string
  endAt: string
  timezone: string
}): Promise<PendingCalendarEventRow> {
  const { data, error } = await params.supabase
    .from('pending_calendar_events')
    .update({
      start_at: params.startAt,
      end_at: params.endAt,
      is_all_day: false,
      all_day_date: null,
      timezone: params.timezone,
      status: 'pending',
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('status', 'pending')
    .select(PENDING_CALENDAR_EVENT_SELECT)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Pending calendar event was not updated')
  }

  return data
}

async function savePendingCalendarTimeClarification(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  title: string
  localDate: string
  timezone: string
  durationMinutes: number
}): Promise<void> {
  const nowIso = new Date().toISOString()
  const placeholderStart = zonedDateTimeToUtcIso(params.localDate, '00:00', params.timezone)
  const placeholderEnd = addMinutesToIso(placeholderStart, Math.max(15, params.durationMinutes))
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString()

  const { error: supersedeError } = await params.supabase
    .from('pending_calendar_events')
    .update({ status: 'superseded', updated_at: nowIso })
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .in('status', ['pending', 'awaiting_time', 'awaiting_date'])

  if (supersedeError) {
    throw supersedeError
  }

  const { error } = await params.supabase.from('pending_calendar_events').insert({
    user_id: params.userId,
    platform: 'telegram',
    telegram_chat_id: params.chatId,
    title: params.title,
    start_at: placeholderStart,
    end_at: placeholderEnd,
    is_all_day: false,
    all_day_date: null,
    timezone: params.timezone,
    description: null,
    status: 'awaiting_time',
    expires_at: expiresAt,
  })

  if (error) {
    throw error
  }
}

async function getLatestPendingCalendarTime(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<PendingCalendarTimeRow | null> {
  const { data, error } = await params.supabase
    .from('pending_calendar_events')
    .select(PENDING_CALENDAR_EVENT_SELECT)
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .eq('status', 'awaiting_time')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function savePendingCalendarDateClarification(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  title: string
  timezone: string
  durationMinutes: number
  defaultAllDay: boolean
}): Promise<void> {
  const nowIso = new Date().toISOString()
  const placeholderDate = getLocalDateString(new Date(), params.timezone)
  const placeholderStart = zonedDateTimeToUtcIso(placeholderDate, '00:00', params.timezone)
  const placeholderEnd = addMinutesToIso(placeholderStart, Math.max(15, params.durationMinutes))
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString()

  const { error: supersedeError } = await params.supabase
    .from('pending_calendar_events')
    .update({ status: 'superseded', updated_at: nowIso })
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .in('status', ['pending', 'awaiting_time', 'awaiting_date'])

  if (supersedeError) {
    throw supersedeError
  }

  const { error } = await params.supabase.from('pending_calendar_events').insert({
    user_id: params.userId,
    platform: 'telegram',
    telegram_chat_id: params.chatId,
    title: params.title,
    start_at: placeholderStart,
    end_at: placeholderEnd,
    is_all_day: params.defaultAllDay,
    all_day_date: null,
    timezone: params.timezone,
    description: null,
    status: 'awaiting_date',
    expires_at: expiresAt,
  })

  if (error) {
    throw error
  }
}

async function getLatestPendingCalendarDate(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<PendingCalendarDateRow | null> {
  const { data, error } = await params.supabase
    .from('pending_calendar_events')
    .select(PENDING_CALENDAR_EVENT_SELECT)
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .eq('status', 'awaiting_date')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function cancelPendingCalendarTime(params: {
  supabase: ReturnType<typeof getSupabase>
  id: string
}): Promise<void> {
  const { error } = await params.supabase
    .from('pending_calendar_events')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('status', 'awaiting_time')

  if (error) {
    throw error
  }
}

async function cancelPendingCalendarDate(params: {
  supabase: ReturnType<typeof getSupabase>
  id: string
}): Promise<void> {
  const { error } = await params.supabase
    .from('pending_calendar_events')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('status', 'awaiting_date')

  if (error) {
    throw error
  }
}

function formatCalendarDraftChangedReply(draft: PendingCalendarEventRow): string {
  const changedTime = formatCalendarDraftDateTime(draft)

  return `Changed to ${changedTime}.

${draft.title}
${changedTime}

Confirm?`
}

async function resolveCalendarCreateRequestReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
}): Promise<string | null> {
  const timezone = await getDailyRecapTimezone(params)
  const intent = parseCalendarCreateIntent({ text: params.text, timezone })

  if (intent.action === 'not_calendar_create') {
    return null
  }

  console.log('calendar_create_detected')

  if (intent.action === 'ask_time') {
    await savePendingCalendarTimeClarification({
      supabase: params.supabase,
      userId: params.userId,
      chatId: params.chatId,
      title: intent.title,
      localDate: intent.localDate,
      timezone: intent.timezone,
      durationMinutes: intent.durationMinutes,
    })

    console.log('calendar_create_time_needed', {
      datePeriod: intent.datePeriod,
      durationMinutes: intent.durationMinutes,
    })

    return intent.reply
  }

  if (intent.action === 'ask_date') {
    await savePendingCalendarDateClarification({
      supabase: params.supabase,
      userId: params.userId,
      chatId: params.chatId,
      title: intent.title,
      timezone: intent.timezone,
      durationMinutes: intent.durationMinutes,
      defaultAllDay: intent.defaultAllDay,
    })

    console.log('calendar_create_date_needed', {
      durationMinutes: intent.durationMinutes,
      defaultAllDay: intent.defaultAllDay,
    })

    return intent.reply
  }

  if (intent.action === 'ask_clarifying_question') {
    return intent.reply
  }

  await savePendingCalendarEvent({
    supabase: params.supabase,
    userId: params.userId,
    chatId: params.chatId,
    draft: intent.draft,
  })

  console.log('calendar_create_draft_created', {
    durationMinutes: intent.draft.durationMinutes,
    datePeriod: intent.draft.datePeriod,
    colorCategory: intent.draft.colorCategory,
  })

  return formatCalendarCreateDraftReply(intent.draft)
}

async function resolveCalendarCreateEditReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
}): Promise<string | null> {
  if (!isCalendarDraftEditRequest(params.text)) {
    return null
  }

  const pendingCalendarEvent = await getLatestPendingCalendarEvent(params)

  if (!pendingCalendarEvent) {
    return null
  }

  const date =
    parseCalendarCreateLocalDate({ text: params.text, timezone: pendingCalendarEvent.timezone }) ??
    {
      localDate: getLocalDateString(new Date(pendingCalendarEvent.start_at), pendingCalendarEvent.timezone),
      period: 'existing date',
  }
  const timeRange = parseCalendarCreateTimeRange(params.text)
  const startTime = timeRange?.startTime ?? parseCalendarCreateStartTime(params.text)

  if (timeRange?.needsClarification) {
    return 'I found an end time before the start time. Should this be an overnight event?'
  }

  if (!startTime) {
    return 'what time should I move it to?'
  }

  const existingDurationMinutes = Math.max(
    15,
    Math.round((Date.parse(pendingCalendarEvent.end_at) - Date.parse(pendingCalendarEvent.start_at)) / 60000)
  )
  const startAt = zonedDateTimeToUtcIso(date.localDate, startTime, pendingCalendarEvent.timezone)
  const endAt = timeRange
    ? getCalendarRangeEndAt({
        localDate: date.localDate,
        endTime: timeRange.endTime,
        timezone: pendingCalendarEvent.timezone,
        crossesMidnight: timeRange.crossesMidnight,
      })
    : addMinutesToIso(startAt, existingDurationMinutes)
  const color = inferCalendarEventColor(pendingCalendarEvent.title)

  const updatedPendingCalendarEvent = await updatePendingCalendarEventDraft({
    supabase: params.supabase,
    id: pendingCalendarEvent.id,
    startAt,
    endAt,
    timezone: pendingCalendarEvent.timezone,
  })

  console.log('calendar_pending_updated', {
    ...getCalendarPendingSafeMetadata(updatedPendingCalendarEvent),
    colorCategory: color.category,
  })

  return formatCalendarDraftChangedReply(updatedPendingCalendarEvent)
}

async function resolveCalendarCreateTimeClarificationReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
}): Promise<string | null> {
  const pendingCalendarTime = await getLatestPendingCalendarTime(params)

  if (!pendingCalendarTime) {
    return null
  }

  if (isCalendarCreateCancellation(params.text)) {
    await cancelPendingCalendarTime({ supabase: params.supabase, id: pendingCalendarTime.id })
    return 'okay, I won’t add it.'
  }

  const timeRange = parseCalendarCreateTimeRange(params.text)
  const startTime = timeRange?.startTime ?? parseCalendarCreateStartTime(params.text)

  if (timeRange?.needsClarification) {
    return 'I found an end time before the start time. Should this be an overnight event?'
  }

  if (!startTime) {
    return null
  }

  const localDate = getLocalDateString(new Date(pendingCalendarTime.start_at), pendingCalendarTime.timezone)
  const existingDurationMinutes = Math.max(
    15,
    Math.round((Date.parse(pendingCalendarTime.end_at) - Date.parse(pendingCalendarTime.start_at)) / 60000)
  )
  const startAt = zonedDateTimeToUtcIso(localDate, startTime, pendingCalendarTime.timezone)
  const endAt = timeRange
    ? getCalendarRangeEndAt({
        localDate,
        endTime: timeRange.endTime,
        timezone: pendingCalendarTime.timezone,
        crossesMidnight: timeRange.crossesMidnight,
      })
    : addMinutesToIso(startAt, existingDurationMinutes)
  const color = inferCalendarEventColor(pendingCalendarTime.title)

  const { data, error } = await params.supabase
    .from('pending_calendar_events')
    .update({
      start_at: startAt,
      end_at: endAt,
      is_all_day: false,
      all_day_date: null,
      status: 'pending',
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingCalendarTime.id)
    .eq('status', 'awaiting_time')
    .select(PENDING_CALENDAR_EVENT_SELECT)
    .maybeSingle()

  if (error || !data) {
    console.error('calendar_create_draft_update_failed', {
      category: error ? 'supabase_error' : 'pending_calendar_not_found',
    })
    return 'I couldn’t update that calendar draft right now.'
  }

  console.log('calendar_pending_updated', {
    ...getCalendarPendingSafeMetadata(data),
    colorCategory: color.category,
  })

  return formatCalendarCreateDraftReply({
    title: data.title,
    startAt: data.start_at,
    endAt: data.end_at,
    isAllDay: data.is_all_day,
    allDayDate: data.all_day_date,
    timezone: data.timezone,
    description: data.description,
    datePeriod: 'pending_date',
    durationMinutes: getCalendarPendingSafeMetadata(data).durationMinutes,
    colorCategory: color.category,
    colorId: color.colorId,
  })
}

async function resolveCalendarCreateDateClarificationReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
}): Promise<string | null> {
  const pendingCalendarDate = await getLatestPendingCalendarDate(params)

  if (!pendingCalendarDate) {
    return null
  }

  if (isCalendarCreateCancellation(params.text)) {
    await cancelPendingCalendarDate({ supabase: params.supabase, id: pendingCalendarDate.id })
    return 'okay, I won’t add it.'
  }

  const date = parseCalendarCreateLocalDate({
    text: params.text,
    timezone: pendingCalendarDate.timezone,
  })

  if (!date) {
    return null
  }

  const timeRange = parseCalendarCreateTimeRange(params.text)
  const startTime = timeRange?.startTime ?? parseCalendarCreateStartTime(params.text)

  if (timeRange?.needsClarification) {
    return 'I found an end time before the start time. Should this be an overnight event?'
  }

  const existingDurationMinutes = Math.max(
    15,
    Math.round((Date.parse(pendingCalendarDate.end_at) - Date.parse(pendingCalendarDate.start_at)) / 60000)
  )
  const isAllDay = pendingCalendarDate.is_all_day && !startTime
  const startAt = isAllDay
    ? zonedDateTimeToUtcIso(date.localDate, '00:00', pendingCalendarDate.timezone)
    : zonedDateTimeToUtcIso(date.localDate, startTime ?? '09:00', pendingCalendarDate.timezone)
  const endAt = isAllDay
    ? zonedDateTimeToUtcIso(addDaysToLocalDate(date.localDate, 1), '00:00', pendingCalendarDate.timezone)
    : timeRange
      ? getCalendarRangeEndAt({
          localDate: date.localDate,
          endTime: timeRange.endTime,
          timezone: pendingCalendarDate.timezone,
          crossesMidnight: timeRange.crossesMidnight,
        })
      : addMinutesToIso(startAt, existingDurationMinutes)
  const color = inferCalendarEventColor(pendingCalendarDate.title)

  const { data, error } = await params.supabase
    .from('pending_calendar_events')
    .update({
      start_at: startAt,
      end_at: endAt,
      is_all_day: isAllDay,
      all_day_date: isAllDay ? date.localDate : null,
      status: 'pending',
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingCalendarDate.id)
    .eq('status', 'awaiting_date')
    .select(PENDING_CALENDAR_EVENT_SELECT)
    .maybeSingle()

  if (error || !data) {
    console.error('calendar_create_draft_update_failed', {
      category: error ? 'supabase_error' : 'pending_calendar_not_found',
    })
    return 'I couldn’t update that calendar draft right now.'
  }

  console.log('calendar_pending_updated', {
    ...getCalendarPendingSafeMetadata(data),
    colorCategory: color.category,
  })

  return formatCalendarCreateDraftReply({
    title: data.title,
    startAt: data.start_at,
    endAt: data.end_at,
    isAllDay: data.is_all_day,
    allDayDate: data.all_day_date,
    timezone: data.timezone,
    description: data.description,
    datePeriod: date.period,
    durationMinutes: getCalendarPendingSafeMetadata(data).durationMinutes,
    colorCategory: color.category,
    colorId: color.colorId,
  })
}

async function resolveCalendarCreateConfirmationReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
  calendarAccess?: GoogleCalendarAccess
}): Promise<string | null> {
  if (!isCalendarCreateConfirmation(params.text) && !isCalendarCreateCancellation(params.text)) {
    return null
  }

  const pendingCalendarEvent = await getLatestPendingCalendarEvent(params)

  if (!pendingCalendarEvent) {
    return null
  }

  const pendingMetadata = getCalendarPendingSafeMetadata(pendingCalendarEvent)
  console.log('calendar_pending_loaded_for_confirmation', pendingMetadata)

  if (isCalendarCreateCancellation(params.text)) {
    await updatePendingCalendarEventStatus({
      supabase: params.supabase,
      id: pendingCalendarEvent.id,
      status: 'cancelled',
    })

    return 'okay, I won’t add it.'
  }

  console.log('calendar_create_confirmation_received')
  const color = inferCalendarEventColor(pendingCalendarEvent.title)
  console.log('calendar_create_started', {
    ...pendingMetadata,
    colorCategory: color.category,
  })

  try {
    await createGoogleCalendarEvent({
      title: pendingCalendarEvent.title,
      start: pendingCalendarEvent.start_at,
      end: pendingCalendarEvent.end_at,
      timezone: pendingCalendarEvent.timezone,
      description: pendingCalendarEvent.description,
      colorId: color.colorId,
      allDayDate: pendingCalendarEvent.is_all_day ? pendingCalendarEvent.all_day_date : null,
      allDayEndDate:
        pendingCalendarEvent.is_all_day && pendingCalendarEvent.all_day_date
          ? addDaysToLocalDate(pendingCalendarEvent.all_day_date, 1)
          : null,
      accessToken: params.calendarAccess?.accessToken,
      calendarId: params.calendarAccess?.calendarId,
    })

    await updatePendingCalendarEventStatus({
      supabase: params.supabase,
      id: pendingCalendarEvent.id,
      status: 'confirmed',
    })

    console.log('calendar_create_success', {
      ...getCalendarPendingSafeMetadata(pendingCalendarEvent),
      colorCategory: color.category,
    })

    return formatCalendarCreatedReply(pendingCalendarEvent)
  } catch (error) {
    const calendarError =
      error instanceof CalendarReadError ? error : new CalendarReadError({ category: 'google_unknown_error' })

    await updatePendingCalendarEventStatus({
      supabase: params.supabase,
      id: pendingCalendarEvent.id,
      status: 'failed',
    })

    console.error('calendar_create_failed', {
      category: calendarError.category,
    })

    if (calendarError.category === 'calendar_write_permission_denied') {
      return 'I can read your calendar, but I don’t have permission to add events yet.'
    }

    return 'I couldn’t add that to your calendar right now.'
  }
}

type CalendarPlanningRange = {
  label: string
  timeMin: string
  timeMax: string
  maxResults: number
  localDates: string[]
  windowStartTime: string
  windowEndTime: string
}

type CalendarBusyBlock = {
  startMs: number
  endMs: number
}

type CalendarFreeWindow = {
  startMs: number
  endMs: number
}

function getCalendarPlanningDateRange(params: {
  intent: CalendarPlanningIntent
  timezone: string
}): CalendarPlanningRange {
  const localDate = getLocalDateString(new Date(), params.timezone)

  if (params.intent.period === 'next_week') {
    const [year, month, day] = localDate.split('-').map(Number)
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const daysSinceMonday = (dayOfWeek + 6) % 7
    const weekStart = addDaysToLocalDate(localDate, -daysSinceMonday + 7)
    const localDates = Array.from({ length: 7 }, (_, index) => addDaysToLocalDate(weekStart, index))

    return {
      label: 'next week',
      timeMin: zonedDateTimeToUtcIso(weekStart, '00:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(weekStart, 7), '00:00', params.timezone),
      maxResults: 50,
      localDates,
      windowStartTime: '08:00',
      windowEndTime: '22:00',
    }
  }

  if (params.intent.period === 'tomorrow' || params.intent.period === 'tomorrow_evening') {
    const tomorrow = addDaysToLocalDate(localDate, 1)

    return {
      label: params.intent.period === 'tomorrow_evening' ? 'tomorrow evening' : 'tomorrow',
      timeMin: zonedDateTimeToUtcIso(tomorrow, '00:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(tomorrow, 1), '00:00', params.timezone),
      maxResults: 20,
      localDates: [tomorrow],
      windowStartTime: params.intent.period === 'tomorrow_evening' ? '18:00' : '08:00',
      windowEndTime: params.intent.period === 'tomorrow_evening' ? '22:00' : '22:00',
    }
  }

  if (params.intent.period === 'evening') {
    return {
      label: 'this evening',
      timeMin: zonedDateTimeToUtcIso(localDate, '18:00', params.timezone),
      timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', params.timezone),
      maxResults: 10,
      localDates: [localDate],
      windowStartTime: '18:00',
      windowEndTime: '22:00',
    }
  }

  return {
    label: 'today',
    timeMin: zonedDateTimeToUtcIso(localDate, '00:00', params.timezone),
    timeMax: zonedDateTimeToUtcIso(addDaysToLocalDate(localDate, 1), '00:00', params.timezone),
    maxResults: 20,
    localDates: [localDate],
    windowStartTime: '08:00',
    windowEndTime: '22:00',
  }
}

function getCalendarPlanningWindowMs(params: {
  localDate: string
  startTime: string
  endTime: string
  timezone: string
}): { startMs: number; endMs: number } {
  return {
    startMs: Date.parse(zonedDateTimeToUtcIso(params.localDate, params.startTime, params.timezone)),
    endMs: Date.parse(zonedDateTimeToUtcIso(params.localDate, params.endTime, params.timezone)),
  }
}

function getCalendarPlanningBusyBlocks(params: {
  events: CalendarEvent[]
  localDate: string
  windowStartTime: string
  windowEndTime: string
  timezone: string
}): CalendarBusyBlock[] {
  const window = getCalendarPlanningWindowMs({
    localDate: params.localDate,
    startTime: params.windowStartTime,
    endTime: params.windowEndTime,
    timezone: params.timezone,
  })

  return params.events
    .filter((event) => !event.isAllDay && event.end !== null)
    .map((event) => ({
      startMs: Date.parse(event.start),
      endMs: Date.parse(event.end ?? event.start),
    }))
    .filter((block) => Number.isFinite(block.startMs) && Number.isFinite(block.endMs) && block.endMs > block.startMs)
    .map((block) => ({
      startMs: Math.max(block.startMs, window.startMs),
      endMs: Math.min(block.endMs, window.endMs),
    }))
    .filter((block) => block.endMs > block.startMs)
    .sort((a, b) => a.startMs - b.startMs)
}

function mergeCalendarBusyBlocks(blocks: CalendarBusyBlock[]): CalendarBusyBlock[] {
  const merged: CalendarBusyBlock[] = []

  for (const block of blocks) {
    const previous = merged[merged.length - 1]

    if (!previous || block.startMs > previous.endMs) {
      merged.push({ ...block })
    } else {
      previous.endMs = Math.max(previous.endMs, block.endMs)
    }
  }

  return merged
}

function getCalendarPlanningFreeWindows(params: {
  events: CalendarEvent[]
  localDate: string
  windowStartTime: string
  windowEndTime: string
  timezone: string
}): CalendarFreeWindow[] {
  const planningWindow = getCalendarPlanningWindowMs({
    localDate: params.localDate,
    startTime: params.windowStartTime,
    endTime: params.windowEndTime,
    timezone: params.timezone,
  })
  const busyBlocks = mergeCalendarBusyBlocks(getCalendarPlanningBusyBlocks(params))
  const freeWindows: CalendarFreeWindow[] = []
  let cursorMs = planningWindow.startMs

  for (const block of busyBlocks) {
    if (block.startMs > cursorMs) {
      freeWindows.push({ startMs: cursorMs, endMs: block.startMs })
    }

    cursorMs = Math.max(cursorMs, block.endMs)
  }

  if (cursorMs < planningWindow.endMs) {
    freeWindows.push({ startMs: cursorMs, endMs: planningWindow.endMs })
  }

  return freeWindows.filter((window) => window.endMs - window.startMs >= 30 * 60 * 1000)
}

function getBestCalendarFreeWindow(windows: CalendarFreeWindow[]): CalendarFreeWindow | null {
  return windows.reduce<CalendarFreeWindow | null>((best, window) => {
    if (!best || window.endMs - window.startMs > best.endMs - best.startMs) {
      return window
    }

    return best
  }, null)
}

function formatCalendarPlanningTime(valueMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  })
    .format(new Date(valueMs))
    .replace(/\s+/g, '')
    .toLowerCase()
}

function formatCalendarPlanningWindow(window: CalendarFreeWindow, timezone: string): string {
  return `${formatCalendarPlanningTime(window.startMs, timezone)}-${formatCalendarPlanningTime(window.endMs, timezone)}`
}

function getCalendarPlanningDayCounts(events: CalendarEvent[], timezone: string): Map<string, number> {
  const dayCounts = new Map<string, number>()

  for (const event of events) {
    const localDate = getCalendarEventLocalDate(event, timezone)
    dayCounts.set(localDate, (dayCounts.get(localDate) ?? 0) + 1)
  }

  return dayCounts
}

function doesRequestedPlanningTimeLookFree(params: {
  intent: CalendarPlanningIntent
  range: CalendarPlanningRange
  events: CalendarEvent[]
  timezone: string
}): boolean | null {
  if (!params.intent.requestedTime || params.range.localDates.length !== 1) {
    return null
  }

  const requestedStartMs = Date.parse(
    zonedDateTimeToUtcIso(params.range.localDates[0], params.intent.requestedTime, params.timezone)
  )
  const requestedEndMs = requestedStartMs + 60 * 60 * 1000
  const busyBlocks = getCalendarPlanningBusyBlocks({
    events: params.events,
    localDate: params.range.localDates[0],
    windowStartTime: params.range.windowStartTime,
    windowEndTime: params.range.windowEndTime,
    timezone: params.timezone,
  })

  return !busyBlocks.some((block) => requestedStartMs < block.endMs && requestedEndMs > block.startMs)
}

function formatCalendarPlanningReply(params: {
  events: CalendarEvent[]
  intent: CalendarPlanningIntent
  timezone: string
  range: CalendarPlanningRange
}): string {
  const { events, intent, timezone, range } = params
  const allDayCount = events.filter((event) => event.isAllDay).length
  const concreteEvents = events.filter((event) => !event.isAllDay)
  const allDayLine = allDayCount > 0 ? `\n\nalso note: you have ${allDayCount} all-day item${allDayCount === 1 ? '' : 's'}.` : ''

  if (intent.kind === 'create_request') {
    const requestedFree = doesRequestedPlanningTimeLookFree({ intent, range, events, timezone })
    const timeText =
      intent.requestedTime && range.localDates.length === 1
        ? `${formatCalendarPlanningTime(
            Date.parse(zonedDateTimeToUtcIso(range.localDates[0], intent.requestedTime, timezone)),
            timezone
          )} ${range.label}`
        : range.label
    const possibilityText =
      requestedFree === null
        ? 'I can suggest a time first.'
        : `${timeText} looks ${requestedFree ? 'possible' : 'busy'} based on your calendar.`

    return `I can help plan it, but I can’t add calendar events yet. ${possibilityText}`
  }

  if (intent.period === 'next_week' || intent.kind === 'packed_check') {
    const judgment = getCalendarBusyJudgment(events.length)
    const dayCounts = getCalendarPlanningDayCounts(events, timezone)
    const busierDays = [...dayCounts.entries()]
      .sort(([dateA, countA], [dateB, countB]) => countB - countA || dateA.localeCompare(dateB))
      .slice(0, 4)
      .map(([localDate, count]) => `- ${formatCalendarBusyDayLabel(localDate, timezone)}: ${count}`)
      .join('\n')

    if (events.length === 0) {
      return 'next week looks clear. Good week for deeper work or bigger plans.'
    }

    return `next week looks ${judgment === 'moderate' ? 'moderately busy' : judgment} — you have ${events.length} event${
      events.length === 1 ? '' : 's'
    }.

busier days:
${busierDays}${allDayLine}`
  }

  const dailyWindows = range.localDates.flatMap((localDate) =>
    getCalendarPlanningFreeWindows({
      events,
      localDate,
      windowStartTime: range.windowStartTime,
      windowEndTime: range.windowEndTime,
      timezone,
    }).map((window) => ({ localDate, window }))
  )
  const bestWindow = getBestCalendarFreeWindow(dailyWindows.map(({ window }) => window))
  const bestWindowText = bestWindow ? formatCalendarPlanningWindow(bestWindow, timezone) : null
  const eventCountText = `you have ${events.length} calendar event${events.length === 1 ? '' : 's'}`

  if (intent.kind === 'fit_activity') {
    const fitWindow = dailyWindows.find(({ window }) => window.endMs - window.startMs >= 45 * 60 * 1000)?.window
    const activity = intent.activity ?? 'that'

    if (fitWindow) {
      return `${range.label} looks free ${formatCalendarPlanningWindow(
        fitWindow,
        timezone
      )}, so yes — a 45-60 min ${activity} should fit.${allDayLine}`
    }

    return `${range.label} looks tight for ${activity}; I don’t see a clean 45-60 min window in your calendar.${allDayLine}`
  }

  if (intent.kind === 'free_time') {
    if (dailyWindows.length === 0) {
      return `I don’t see a clean free window ${range.label}.${allDayLine}`
    }

    const windowLines = dailyWindows
      .slice(0, 3)
      .map(({ window }) => `- ${formatCalendarPlanningWindow(window, timezone)}`)
      .join('\n')

    return `your clearest windows ${range.label} are:
${windowLines}${allDayLine}`
  }

  if (intent.kind === 'work_focus') {
    if (bestWindowText) {
      const activity = intent.activity ?? 'focused work'

      return `best slot looks like ${bestWindowText} ${range.label} for ${activity}. ${eventCountText}, so use the cleanest block for the hardest thing.${allDayLine}`
    }

    return `${range.label} looks fairly packed, so keep the focus list short and use smaller admin tasks between events.${allDayLine}`
  }

  if (bestWindow && bestWindowText) {
    const firstEventHour = concreteEvents
      .map((event) => Date.parse(event.start))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0]
    const openText =
      firstEventHour && bestWindow.startMs < firstEventHour
        ? `${range.label} looks pretty open before ${formatCalendarPlanningTime(firstEventHour, timezone)}.`
        : `${range.label} has a cleanest block around ${bestWindowText}.`

    return `${openText}

suggested plan:
- morning: deep work / Bergi build
- afternoon: lighter admin
- evening: keep flexible

${eventCountText}, so protect your cleanest block.${allDayLine}`
  }

  return `${range.label} looks packed. Keep the plan light and use short gaps for admin.${allDayLine}`
}

async function resolveCalendarPlanningReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  intent: CalendarPlanningIntent
  calendarAccess?: GoogleCalendarAccess
}): Promise<string> {
  if (params.intent.kind === 'clarify' || params.intent.period === 'unsupported') {
    return getCalendarPlanningClarificationReply()
  }

  const timezone = await getDailyRecapTimezone(params)
  const range = getCalendarPlanningDateRange({ intent: params.intent, timezone })

  console.log('calendar_planning_started', {
    period: params.intent.period,
    kind: params.intent.kind,
  })

  const events = await queryGoogleCalendarEvents({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    maxResults: range.maxResults,
    accessToken: params.calendarAccess?.accessToken,
    calendarId: params.calendarAccess?.calendarId,
  })

  console.log('calendar_planning_success', {
    count: events.length,
  })

  return formatCalendarPlanningReply({
    events,
    intent: params.intent,
    timezone,
    range,
  })
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
  userId: string
  reminderId: string
}): Promise<boolean> {
  const { supabase, userId, reminderId } = params

  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
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
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', chatId)

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

async function getRecentSentProactiveCheckinForReplyContext(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<RecentSentProactiveCheckinRow | null> {
  const { supabase, userId, chatId } = params
  const sinceIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: checkin, error: checkinError } = await supabase
    .from('proactive_checkins')
    .select('id, message_text, sent_at')
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'sent')
    .not('sent_at', 'is', null)
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (checkinError) {
    throw checkinError
  }

  if (!checkin?.sent_at || !checkin.message_text) {
    return null
  }

  const { count: messagesSinceCheckin, error: messagesError } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .gte('created_at', checkin.sent_at)

  if (messagesError) {
    throw messagesError
  }

  if ((messagesSinceCheckin ?? 0) > 8) {
    return null
  }

  return checkin as RecentSentProactiveCheckinRow
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
    await setUserProactiveFeature({ supabase, userId, enabled: false })
    await setProactiveCheckinsEnabled({ supabase, userId, chatId, enabled: false })
    await cancelFutureScheduledProactiveCheckins({ supabase, userId, chatId })
    return 'Okay, I’ll pause proactive check-ins for now.'
  }

  if (action === 'resume') {
    await setUserProactiveFeature({ supabase, userId, enabled: true })
    const preference = await setProactiveCheckinsEnabled({ supabase, userId, chatId, enabled: true })
    const restoredCount = await restoreTodayFutureCancelledProactiveCheckins({
      supabase,
      userId,
      chatId,
      timezone: preference.timezone,
    })

    if (restoredCount > 0) {
      const checkinWord = restoredCount === 1 ? 'check-in' : 'check-ins'
      return `Done, proactive check-ins are back on. I restored ${restoredCount} upcoming ${checkinWord} for today.`
    }

    await generateDailyProactiveCheckins({
      supabase,
      userId,
      telegramChatId: chatId,
      platform: 'telegram',
      timezone: preference.timezone,
    })
    return 'Done, proactive check-ins are back on.'
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

async function saveMessage(params: SaveMessageParams): Promise<string> {
  const { supabase, userId, role, content } = params

  const { data, error } = await supabase
    .from('messages')
    .insert({
      user_id: userId,
      platform: 'telegram',
      role,
      content,
    })
    .select('id')
    .single()

  if (error) {
    throw error
  }

  return String(data.id)
}

async function getLatestPendingFinanceConfirmation(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}) {
  const { supabase, userId } = params
  const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('messages')
    .select('content')
    .eq('user_id', userId)
    .eq('platform', 'telegram')
    .eq('role', 'assistant')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const latestMessage = data?.[0]
  const content = typeof latestMessage?.content === 'string' ? latestMessage.content : ''
  const pendingConfirmation = parsePendingSuspiciousExpenseConfirmation(content)

  if (pendingConfirmation) {
    return pendingConfirmation
  }

  return null
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

function parsePendingReminderDate(params: { text: string; timezone: string }): string | null {
  const date = parseCalendarCreateLocalDate({ text: params.text, timezone: params.timezone })

  return date?.localDate ?? null
}

function parsePendingReminderDatePeriod(params: { text: string; timezone: string }): string | null {
  const date = parseCalendarCreateLocalDate({ text: params.text, timezone: params.timezone })

  return date?.period ?? null
}

function hasExplicitReminderTime(text: string): boolean {
  const normalized = text.toLowerCase()

  return (
    /\b(?:at\s*)?(?:[01]?\d|2[0-3])(?:(?::|\.)[0-5]\d)?\s*(?:am|pm)\b/.test(normalized) ||
    /\b(?:[01]?\d|2[0-3])(?::|\.)[0-5]\d\b/.test(normalized) ||
    /\bin\s+\d+\s*(?:mins?|minutes?|hours?|hrs?|h)\b/.test(normalized) ||
    /\b\d+\s*(?:mins?|minutes?|hours?|hrs?|h)\s+from\s+now\b/.test(normalized)
  )
}

function extractPendingReminderText(text: string): string {
  const reminderText = text
    .replace(/[’']/g, "'")
    .replace(/\b(remind me|reminder|let me know|tell me)\b/gi, ' ')
    .replace(/\b(today|tdy|tomorrow|tmr|tonight|this\s+(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|next\s+(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))\b/gi, ' ')
    .replace(/\b(?:at\s*)?(?:[01]?\d|2[0-3])(?::[0-5]\d|\.[0-5]\d)?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b(to|about|for|on|at)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return reminderText || 'that'
}

function formatMissingReminderTimeQuestion(params: { text: string; timezone: string }): string | null {
  const period = parsePendingReminderDatePeriod({ text: params.text, timezone: params.timezone })

  if (!period) {
    return null
  }

  const reminderText = extractPendingReminderText(params.text)

  return `What time ${period} would you like me to remind you to ${reminderText}?`
}

async function savePendingReminderTimeClarification(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
  timezone: string
  sourceMessageContent: string
}): Promise<boolean> {
  const localDate = parsePendingReminderDate({ text: params.text, timezone: params.timezone })

  if (!localDate) {
    return false
  }

  const reminderText = extractPendingReminderText(params.text)
  const placeholderAt = zonedDateTimeToUtcIso(localDate, '00:00', params.timezone)
  const nowIso = new Date().toISOString()

  const { error: supersedeError } = await params.supabase
    .from('reminders')
    .update({ status: 'cancelled', updated_at: nowIso })
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .eq('status', 'awaiting_reminder_time')

  if (supersedeError) {
    throw supersedeError
  }

  const { error } = await params.supabase.from('reminders').insert({
    user_id: params.userId,
    platform: 'telegram',
    telegram_chat_id: params.chatId,
    reminder_text: reminderText,
    event_time: placeholderAt,
    remind_at: placeholderAt,
    timezone: params.timezone,
    status: 'awaiting_reminder_time',
    source_message_content: params.sourceMessageContent,
  })

  if (error) {
    throw error
  }

  console.log('pending_reminder_created')
  return true
}

async function getLatestPendingReminderTime(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
}): Promise<PendingReminderTimeRow | null> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await params.supabase
    .from('reminders')
    .select('id, event_time, timezone, reminder_text')
    .eq('user_id', params.userId)
    .eq('platform', 'telegram')
    .eq('telegram_chat_id', params.chatId)
    .eq('status', 'awaiting_reminder_time')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data as PendingReminderTimeRow | null
}

function parseReminderTimeOnly(text: string): string | null {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ')
  const meridiemMatch = normalized.match(/^(?:at\s+)?([1-9]|1[0-2])(?::|\.|\s)?([0-5]\d)?\s*(am|pm)$/)

  if (meridiemMatch) {
    return resolveTimeParts(meridiemMatch[1], meridiemMatch[2], meridiemMatch[3])
  }

  const compactMatch = normalized.match(/^([01]?\d|2[0-3])(?::|\.)([0-5]\d)$/)

  if (compactMatch) {
    return resolveTimeParts(compactMatch[1], compactMatch[2])
  }

  const militaryMatch = normalized.match(/^(\d{3,4})$/)

  if (!militaryMatch) {
    return null
  }

  const compact = militaryMatch[1].padStart(4, '0')
  const hour = compact.slice(0, 2)
  const minute = compact.slice(2, 4)

  return resolveTimeParts(hour, minute)
}

async function cancelPendingReminderTime(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  id: string
}): Promise<void> {
  const { error } = await params.supabase
    .from('reminders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('user_id', params.userId)
    .eq('id', params.id)
    .eq('status', 'awaiting_reminder_time')

  if (error) {
    throw error
  }
}

async function resolvePendingReminderTimeReply(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  text: string
}): Promise<string | null> {
  const pendingReminder = await getLatestPendingReminderTime(params)

  if (!pendingReminder) {
    return null
  }

  if (/^(cancel|cancel it|stop|never mind|nevermind)$/i.test(params.text.trim())) {
    await cancelPendingReminderTime({ supabase: params.supabase, userId: params.userId, id: pendingReminder.id })
    return "Okay, I won’t set that reminder."
  }

  const time = parseReminderTimeOnly(params.text)

  if (!time) {
    if (
      detectFinanceCandidate(params.text) ||
      isLikelyListRemindersRequest(params.text) ||
      isLikelyNewReminderCommand(params.text)
    ) {
      return null
    }

    return `What time should I use for ${pendingReminder.reminder_text}?`
  }

  console.log('pending_reminder_completed')

  const localDate = getLocalDateString(new Date(pendingReminder.event_time), pendingReminder.timezone)
  const remindAt = zonedDateTimeToUtcIso(localDate, time, pendingReminder.timezone)

  if (new Date(remindAt).getTime() <= Date.now()) {
    return 'That reminder time has already passed. What future time should I use?'
  }

  console.log('pending_reminder_insert_started')

  const { data, error } = await params.supabase
    .from('reminders')
    .update({
      event_time: remindAt,
      remind_at: remindAt,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingReminder.id)
    .eq('status', 'awaiting_reminder_time')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    console.error('pending_reminder_insert_failed', {
      category: error ? 'supabase_error' : 'pending_reminder_not_found',
    })
    return 'I couldn’t save that reminder right now.'
  }

  console.log('pending_reminder_insert_success')

  return `Ok, reminder set for ${formatReminderTimeForUser(remindAt, pendingReminder.timezone)} ${getTimezoneLabel(
    pendingReminder.timezone
  )} to ${pendingReminder.reminder_text}.`
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
  userId: string
  awaitingReminder: AwaitingReminderRow
  userText: string
}): Promise<string> {
  const { supabase, userId, awaitingReminder, userText } = params
  const lower = userText.toLowerCase().trim()

  if (lower === 'no' || lower === 'nah' || lower === 'no need' || lower.includes('不用') || lower.includes('不需要')) {
    const { error } = await supabase
      .from('reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
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
      .eq('user_id', userId)
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
    .eq('user_id', userId)
    .eq('id', awaitingReminder.id)
    .eq('status', 'awaiting_reminder_preference')

  if (error) {
    throw error
  }

  return `Okay, I’ll remind you at ${formatReminderTimeForUser(remindAt, awaitingReminder.timezone)} ${getTimezoneLabel(awaitingReminder.timezone)}.`
}

async function rescheduleReminderById(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  reminderId: string
  newRemindAt: string
}): Promise<boolean> {
  const { supabase, userId, reminderId, newRemindAt } = params

  const { data, error } = await supabase
    .from('reminders')
    .update({
      remind_at: newRemindAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
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

async function getLatestAssistantMessage(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<string | null> {
  const { data, error } = await params.supabase
    .from('messages')
    .select('content')
    .eq('user_id', params.userId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return typeof data?.content === 'string' ? data.content : null
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
  console.error('OpenAI chat completion request failed', {
    status: response.status,
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

async function callLLM(params: {
  chatMessages: ChatMessage[]
  systemPrompt: string
  maxCompletionTokens?: number
}): Promise<string> {
  const { chatMessages, systemPrompt, maxCompletionTokens = 300 } = params
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
      max_completion_tokens: maxCompletionTokens,
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

type TelegramInlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup
): Promise<void> {
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
      reply_markup: replyMarkup,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram sendMessage request failed: ${response.status}`)
  }
}

async function answerTelegramCallbackQuery(callbackQueryId: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram answerCallbackQuery request failed: ${response.status}`)
  }
}

export async function POST(request: Request) {
  let chatId: number | undefined

  try {
    const update = (await request.json()) as TelegramUpdate
    chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id
    const userText = update.message?.text
    const caption = update.message?.caption
    const voice = update.message?.voice
    const photo = update.message?.photo
    const from = update.message?.from ?? update.callback_query?.from
    const callbackData = update.callback_query?.data
    const isLocalTestMode = process.env.LOCAL_TEST_MODE === 'true'

    console.log('Telegram webhook received', {
      hasMessage: Boolean(update.message),
      hasCallbackQuery: Boolean(update.callback_query),
      messageTypes: getTelegramMessageTypes(update.message),
      hasChatId: chatId !== undefined,
      hasUserId: from?.id !== undefined,
    })

    if (chatId === undefined || from?.id === undefined) {
      return new Response('OK', { status: 200 })
    }

    if (!isAllowedTelegramUser(from.id)) {
      console.log('Blocked unauthorized Telegram user')

      if (isLocalTestMode) {
        console.log('Local test unauthorized response generated')
      } else {
        await sendTelegramMessage(chatId, 'Sorry, Bergi is currently private.')
      }

      return new Response('OK', { status: 200 })
    }

    if (callbackData !== undefined && update.callback_query?.id !== undefined) {
      const supabase = getSupabase()
      const userId = await findOrCreateUserAccount({
        supabase,
        platformUserId: String(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      })
      const isOwner = isOwnerTelegramUser(from.id)
      await ensureDefaultFeatureFlags({ supabase, userId, isOwner })
      let callbackReply: string | null = null
      let callbackReplyMarkup: TelegramInlineKeyboardMarkup | undefined

      if (callbackData === 'alpha_onboarding_agree') {
        await upsertOnboardingState({
          supabase,
          userId,
          status: 'awaiting_name',
          privacyAcknowledgedAt: new Date().toISOString(),
        })
        callbackReply = getAlphaAskNameReply()
      } else if (callbackData === 'alpha_onboarding_privacy') {
        callbackReply = getAlphaPrivacyReply()
      } else if (
        callbackData === 'alpha_onboarding_proactive_light' ||
        callbackData === 'alpha_onboarding_proactive_none'
      ) {
        const enabled = callbackData === 'alpha_onboarding_proactive_light'
        await setUserProactiveFeature({ supabase, userId, enabled })
        await setProactiveCheckinsEnabled({ supabase, userId, chatId, enabled })
        if (!enabled) {
          await cancelFutureScheduledProactiveCheckins({ supabase, userId, chatId })
        }
        await upsertOnboardingState({
          supabase,
          userId,
          status: 'choosing_calendar',
          proactivePreference: enabled ? 'light' : 'off',
        })
        callbackReply = getAlphaCalendarChoiceReply()
        callbackReplyMarkup = getAlphaCalendarReplyMarkup()
      } else if (
        callbackData === 'alpha_onboarding_calendar_connect' ||
        callbackData === 'alpha_onboarding_calendar_skip'
      ) {
        await upsertOnboardingState({
          supabase,
          userId,
          status: 'complete',
        })
        if (callbackData === 'alpha_onboarding_calendar_connect') {
          if (isOwner) {
            callbackReply = `Google Calendar is already available for you.\n\n${getAlphaOnboardingDoneReply()}`
          } else {
            const connectionStatus = await getGoogleCalendarConnectionStatus({ supabase, userId })
            if (connectionStatus.status === 'connected') {
              callbackReply = `Google Calendar is already connected.\n\n${getAlphaOnboardingDoneReply()}`
            } else {
              const connectReply = getGoogleCalendarConnectReply(
                getGoogleCalendarConnectUrl({ telegramUserId: from.id, chatId })
              )
              callbackReply = `${connectReply.text}\n\n${getAlphaOnboardingDoneReply()}`
              callbackReplyMarkup = connectReply.replyMarkup
            }
          }
        } else {
          callbackReply = getAlphaOnboardingDoneReply()
        }
      }

      if (callbackReply !== null) {
        if (!isLocalTestMode) {
          await answerTelegramCallbackQuery(update.callback_query.id)
          await sendTelegramMessage(chatId, callbackReply, callbackReplyMarkup)
        } else {
          console.log('Local test onboarding callback reply generated')
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: callbackReply })
        return new Response('OK', { status: 200 })
      }
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
      await ensureDefaultFeatureFlags({
        supabase,
        userId,
        isOwner: isOwnerTelegramUser(from.id),
      })

      await saveMessage({ supabase, userId, role: 'user', content: nonTextContent })

      if (isLocalTestMode) {
        console.log('Local test non-text response generated')
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
    const isOwner = isOwnerTelegramUser(from.id)
    const featureFlags = await ensureDefaultFeatureFlags({ supabase, userId, isOwner })
    const canUseNotionFinance = isOwner && featureFlags.notion_enabled

    if (!featureFlags.chat_enabled || !featureFlags.alpha_enabled) {
      const unavailableReply = getFeatureUnavailableReply('Chat')

      if (isLocalTestMode) {
        console.log('Local test chat disabled reply generated')
      } else {
        await sendTelegramMessage(chatId, unavailableReply)
      }

      await saveMessage({ supabase, userId, role: 'assistant', content: unavailableReply })
      return new Response('OK', { status: 200 })
    }

    let userMessageToSave: string
    let userMessageForLLM: string
    let transcribedVoiceText: string | null = null

    if (voice !== undefined) {
      if (!featureFlags.voice_enabled) {
        const voiceDisabledReply = getFeatureUnavailableReply('Voice messages')

        await saveMessage({
          supabase,
          userId,
          role: 'user',
          content: '[voice] user sent a voice message while voice was disabled',
        })

        if (isLocalTestMode) {
          console.log('Local test voice disabled reply generated')
        } else {
          await sendTelegramMessage(chatId, voiceDisabledReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: voiceDisabledReply })
        return new Response('OK', { status: 200 })
      }

      if (voice.duration !== undefined && voice.duration > 40) {
        const voiceTooLongReply = 'wah minxie this voice note too long sia 😭 keep it under 40 seconds first'

        await saveMessage({
          supabase,
          userId,
          role: 'user',
          content: '[voice too long] user sent a voice message longer than 40 seconds',
        })

        if (isLocalTestMode) {
          console.log('Local test voice-too-long response generated')
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
      transcribedVoiceText = transcript
      logFinanceInfo('voice_transcription_completed', {
        transcriptLength: transcript.length,
      })

      userMessageToSave = `[voice transcript] ${transcript}`
      userMessageForLLM = formatVoiceTranscriptForLLM(transcript)
    } else if (selectedPhoto !== null) {
      if (!featureFlags.photo_enabled) {
        const photoDisabledReply = getFeatureUnavailableReply('Photos')

        await saveMessage({
          supabase,
          userId,
          role: 'user',
          content: '[photo] user sent a photo while photos were disabled',
        })

        if (isLocalTestMode) {
          console.log('Local test photo disabled reply generated')
        } else {
          await sendTelegramMessage(chatId, photoDisabledReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: photoDisabledReply })
        return new Response('OK', { status: 200 })
      }

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

    const isPlainTextMessage = userText !== undefined && voice === undefined && selectedPhoto === null
    const financeText = selectedPhoto === null ? userText ?? transcribedVoiceText : null
    const financeSource = transcribedVoiceText !== null ? 'voice' : 'text'
    const isFinanceCandidate = financeText !== null && detectFinanceCandidate(financeText)
    const telegramUserId = from.id
    const telegramChatId = chatId

    if (financeSource === 'voice' && financeText !== null) {
      logFinanceInfo('voice_transcription_finance_checked', {
        transcriptLength: financeText.length,
        isCandidate: isFinanceCandidate,
      })
    }

    let calendarAccessForRequest: CalendarAccessResolution | null = null
    const resolveCalendarAccessForRequest = async (): Promise<CalendarAccessResolution> => {
      if (calendarAccessForRequest === null) {
        calendarAccessForRequest = await resolveTelegramCalendarAccess({
          supabase,
          userId,
          telegramUserId,
          chatId: telegramChatId,
          isOwner,
          featureFlags,
        })
      }

      return calendarAccessForRequest
    }

    if (isPlainTextMessage && isThoughtCaptureCommand(userText)) {
      if (!featureFlags.memory_enabled) {
        const memoryUnavailableReply = getFeatureUnavailableReply('Memory')

        if (isLocalTestMode) {
          console.log('Local test memory disabled reply generated')
        } else {
          await sendTelegramMessage(chatId, memoryUnavailableReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: memoryUnavailableReply })
        return new Response('OK', { status: 200 })
      }

      const thoughtCaptureReply = await resolveThoughtCaptureReply({ supabase, userId })

      if (isLocalTestMode) {
        console.log('Local test thought capture reply generated')
      } else {
        await sendTelegramMessage(chatId, thoughtCaptureReply)
      }

      await saveMessage({ supabase, userId, role: 'assistant', content: thoughtCaptureReply })
      return new Response('OK', { status: 200 })
    }

    const savedUserMessageId = await saveMessage({ supabase, userId, role: 'user', content: userMessageToSave })

    if (isPlainTextMessage && normalizeTelegramCommand(userText) === null) {
      const latestAssistantMessage = await getLatestAssistantMessage({ supabase, userId })

      if (latestAssistantMessage === getAlphaAskNameReply()) {
        await upsertOnboardingState({
          supabase,
          userId,
          status: 'choosing_proactive',
          preferredName: userText.trim().slice(0, 80),
        })
        const proactiveChoiceReply = getAlphaProactiveChoiceReply()

        if (isLocalTestMode) {
          console.log('Local test onboarding proactive choice reply generated')
        } else {
          await sendTelegramMessage(chatId, proactiveChoiceReply, getAlphaProactiveReplyMarkup())
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: proactiveChoiceReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage) {
      const telegramCommand = normalizeTelegramCommand(userText)

      if (telegramCommand === '/start') {
        const startReply = getAlphaStartReply()

        if (isLocalTestMode) {
          console.log('Local test start reply generated')
        } else {
          await sendTelegramMessage(chatId, startReply, getAlphaStartReplyMarkup())
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: startReply })
        return new Response('OK', { status: 200 })
      }

      if (telegramCommand === '/help') {
        const helpReply = getHelpReply()

        if (isLocalTestMode) {
          console.log('Local test help reply generated')
        } else {
          await sendTelegramMessage(chatId, helpReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: helpReply })
        return new Response('OK', { status: 200 })
      }

      if (telegramCommand === '/privacy') {
        const privacyReply = getAlphaPrivacyReply()

        if (isLocalTestMode) {
          console.log('Local test privacy reply generated')
        } else {
          await sendTelegramMessage(chatId, privacyReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: privacyReply })
        return new Response('OK', { status: 200 })
      }

      if (telegramCommand === '/connect_calendar') {
        let connectReply: string
        let connectReplyMarkup: TelegramInlineKeyboardMarkup | undefined

        if (isOwner && featureFlags.calendar_enabled) {
          connectReply = 'Google Calendar is already available for you.'
        } else {
          const connectionStatus = await getGoogleCalendarConnectionStatus({ supabase, userId })
          if (!isOwner && connectionStatus.status === 'connected') {
            connectReply = 'Google Calendar is already connected.'
          } else {
            const response = getGoogleCalendarConnectReply(getGoogleCalendarConnectUrl({ telegramUserId: from.id, chatId }))
            connectReply = response.text
            connectReplyMarkup = response.replyMarkup
          }
        }

        if (isLocalTestMode) {
          console.log('Local test calendar connect reply generated')
        } else {
          await sendTelegramMessage(chatId, connectReply, connectReplyMarkup)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: connectReply })
        return new Response('OK', { status: 200 })
      }

      if (telegramCommand === '/disconnect_calendar') {
        const disconnectReply =
          isOwner && featureFlags.calendar_enabled
            ? 'Owner Calendar uses Bergi’s service-account setup, so I won’t disconnect it here.'
            : await (async () => {
                await disconnectGoogleCalendarIntegration({ supabase, userId })
                return 'Google Calendar disconnected.'
              })()

        if (isLocalTestMode) {
          console.log('Local test calendar disconnect reply generated')
        } else {
          await sendTelegramMessage(chatId, disconnectReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: disconnectReply })
        return new Response('OK', { status: 200 })
      }

      if (telegramCommand === '/calendar_status') {
        let statusReply: string

        if (isOwner && featureFlags.calendar_enabled) {
          statusReply = 'Google Calendar is connected for you through Bergi Core.'
        } else {
          const connectionStatus = await getGoogleCalendarConnectionStatus({ supabase, userId })
          if (connectionStatus.status === 'connected') {
            statusReply = connectionStatus.email
              ? `Google Calendar is connected as ${connectionStatus.email}.`
              : 'Google Calendar is connected.'
          } else if (connectionStatus.status === 'needs_reconnect' || connectionStatus.status === 'expired') {
            statusReply = 'Google Calendar needs reconnecting.'
          } else {
            statusReply = 'Google Calendar is not connected.'
          }
        }

        if (isLocalTestMode) {
          console.log('Local test calendar status reply generated')
        } else {
          await sendTelegramMessage(chatId, statusReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: statusReply })
        return new Response('OK', { status: 200 })
      }

      if (telegramCommand === '/notes') {
        if (!featureFlags.memory_enabled) {
          const memoryUnavailableReply = getFeatureUnavailableReply('Memory')

          if (isLocalTestMode) {
            console.log('Local test memory disabled reply generated')
          } else {
            await sendTelegramMessage(chatId, memoryUnavailableReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: memoryUnavailableReply })
          return new Response('OK', { status: 200 })
        }

        const recentNotes = await getRecentLifeThreadNotes({ supabase, userId, limit: 3 })
        const notesReply = formatRecentLifeThreadNotesForTelegram(recentNotes)

        if (isLocalTestMode) {
          console.log('Local test notes reply generated')
        } else {
          await sendTelegramMessage(chatId, notesReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: notesReply })
        return new Response('OK', { status: 200 })
      }

      if (isNaturalMemorySummaryRequest(userText)) {
        if (!featureFlags.memory_enabled) {
          const memoryUnavailableReply = getFeatureUnavailableReply('Memory')

          if (isLocalTestMode) {
            console.log('Local test memory disabled reply generated')
          } else {
            await sendTelegramMessage(chatId, memoryUnavailableReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: memoryUnavailableReply })
          return new Response('OK', { status: 200 })
        }

        const recentNotes = await getRecentLifeThreadNotes({ supabase, userId, limit: 5 })
        const memorySummaryReply = formatNaturalMemorySummary(recentNotes)

        if (isLocalTestMode) {
          console.log('Local test natural memory summary reply generated')
        } else {
          await sendTelegramMessage(chatId, memorySummaryReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: memorySummaryReply })
        return new Response('OK', { status: 200 })
      }

      if (isDailyRecapRequest(userText)) {
        const dailyRecapReply = await resolveDailyRecapReply({ supabase, userId, chatId, userText })

        if (isLocalTestMode) {
          console.log('Local test daily recap reply generated')
        } else {
          await sendTelegramMessage(chatId, dailyRecapReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: dailyRecapReply })
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
          console.log('Local test proactive check-in control reply generated')
        } else {
          await sendTelegramMessage(chatId, proactiveCheckinReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: proactiveCheckinReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (
      isPlainTextMessage &&
      !featureFlags.reminders_enabled &&
      (normalizeTelegramCommand(userText) === '/list_reminders' ||
        isLikelyListRemindersRequest(userText) ||
        isLikelyCancelReminderRequest(userText) ||
        isLikelyRescheduleReminderRequest(userText) ||
        isLikelyReminderRequest(userText))
    ) {
      const remindersUnavailableReply = getFeatureUnavailableReply('Reminders')

      if (isLocalTestMode) {
        console.log('Local test reminders disabled reply generated')
      } else {
        await sendTelegramMessage(chatId, remindersUnavailableReply)
      }

      await saveMessage({ supabase, userId, role: 'assistant', content: remindersUnavailableReply })
      return new Response('OK', { status: 200 })
    }

    if (
      isPlainTextMessage &&
      (normalizeTelegramCommand(userText) === '/list_reminders' || isLikelyListRemindersRequest(userText))
    ) {
      const upcomingReminders = await getUpcomingReminders({ supabase, userId, chatId })
      const remindersReply = formatUpcomingReminders(upcomingReminders)

      if (isLocalTestMode) {
        console.log('Local test reminders list reply generated')
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
          const didCancel = await cancelReminderById({ supabase, userId, reminderId: reminderToCancel.id })
          cancelReply = didCancel
            ? `Cancelled reminder ${cancelNumber}: ${reminderToCancel.reminder_text}`
            : 'That reminder is no longer active. Say “list reminders” to see your upcoming reminders.'
        }
      } else if (shouldCancelNext) {
        const reminderToCancel = upcomingReminders[0]

        if (!reminderToCancel) {
          cancelReply = 'You don’t have any upcoming reminders.'
        } else {
          const didCancel = await cancelReminderById({ supabase, userId, reminderId: reminderToCancel.id })
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
        console.log('Local test cancel reminder reply generated')
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
          console.log('Local test reschedule no-reminders reply generated')
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
          console.log('Local test reschedule clarifying reply generated')
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
            userId,
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
          console.log('Local test reschedule reply generated')
        } else {
          await sendTelegramMessage(chatId, rescheduleReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: rescheduleReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage) {
      const calendarPlanningIntent = financeText !== null ? detectCalendarPlanningIntent(financeText) : null
      const calendarQueryIntent = financeText !== null ? detectCalendarQueryIntent(financeText) : null
      const calendarCreateRequested = isLikelyCalendarCreateRequest(userText)

      if (calendarCreateRequested || calendarPlanningIntent !== null || calendarQueryIntent !== null) {
        const accessResolution = await resolveCalendarAccessForRequest()

        console.log('calendar_access_checked', {
          isOwner,
          calendarEnabled: featureFlags.calendar_enabled,
          hasCreateIntent: calendarCreateRequested,
          hasPlanningIntent: calendarPlanningIntent !== null,
          hasQueryIntent: calendarQueryIntent !== null,
          mode: accessResolution.canUseCalendar ? accessResolution.mode : 'unavailable',
        })

        if (!accessResolution.canUseCalendar) {
          const calendarUnavailableReply = accessResolution.reply

          if (isLocalTestMode) {
            console.log('Local test calendar unavailable reply generated')
          } else {
            await sendTelegramMessage(chatId, calendarUnavailableReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: calendarUnavailableReply })
          return new Response('OK', { status: 200 })
        }
      }
    }

    if (
      isPlainTextMessage &&
      (isCalendarCreateConfirmation(userText) || isCalendarCreateCancellation(userText))
    ) {
      const pendingCalendarEvent = await getLatestPendingCalendarEvent({ supabase, userId, chatId })

      if (pendingCalendarEvent !== null) {
        const accessResolution = await resolveCalendarAccessForRequest()

        if (!accessResolution.canUseCalendar && isCalendarCreateConfirmation(userText)) {
          const calendarUnavailableReply = accessResolution.reply

          if (isLocalTestMode) {
            console.log('Local test calendar unavailable reply generated')
          } else {
            await sendTelegramMessage(chatId, calendarUnavailableReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: calendarUnavailableReply })
          return new Response('OK', { status: 200 })
        }

        const calendarCreateConfirmationReply = await resolveCalendarCreateConfirmationReply({
          supabase,
          userId,
          chatId,
          text: userText,
          calendarAccess: getCalendarAccessParams(accessResolution),
        })

        if (calendarCreateConfirmationReply !== null) {
          if (isLocalTestMode) {
            console.log('Local test calendar create confirmation reply generated')
          } else {
            await sendTelegramMessage(chatId, calendarCreateConfirmationReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: calendarCreateConfirmationReply })
          return new Response('OK', { status: 200 })
        }
      }
    }

    if (isPlainTextMessage && isCalendarDraftEditRequest(userText)) {
      const calendarCreateEditReply = await resolveCalendarCreateEditReply({
        supabase,
        userId,
        chatId,
        text: userText,
      })

      if (calendarCreateEditReply !== null) {
        if (isLocalTestMode) {
          console.log('Local test calendar create edit reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarCreateEditReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: calendarCreateEditReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage) {
      const calendarCreateTimeClarificationReply = await resolveCalendarCreateTimeClarificationReply({
        supabase,
        userId,
        chatId,
        text: userText,
      })

      if (calendarCreateTimeClarificationReply !== null) {
        if (isLocalTestMode) {
          console.log('Local test calendar create time clarification reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarCreateTimeClarificationReply)
        }

        await saveMessage({
          supabase,
          userId,
          role: 'assistant',
          content: calendarCreateTimeClarificationReply,
        })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage) {
      const calendarCreateDateClarificationReply = await resolveCalendarCreateDateClarificationReply({
        supabase,
        userId,
        chatId,
        text: userText,
      })

      if (calendarCreateDateClarificationReply !== null) {
        if (isLocalTestMode) {
          console.log('Local test calendar create date clarification reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarCreateDateClarificationReply)
        }

        await saveMessage({
          supabase,
          userId,
          role: 'assistant',
          content: calendarCreateDateClarificationReply,
        })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage) {
      const pendingReminderTimeReply = await resolvePendingReminderTimeReply({
        supabase,
        userId,
        chatId,
        text: userText,
      })

      if (pendingReminderTimeReply !== null) {
        const formattedPendingReminderTimeReply = formatForTelegramPlainText(pendingReminderTimeReply)

        if (isLocalTestMode) {
          console.log('Local test pending reminder time reply generated')
        } else {
          await sendTelegramMessage(chatId, formattedPendingReminderTimeReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: formattedPendingReminderTimeReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage && isLikelyCalendarCreateRequest(userText)) {
      const accessResolution = await resolveCalendarAccessForRequest()

      if (!accessResolution.canUseCalendar) {
        const calendarUnavailableReply = accessResolution.reply

        if (isLocalTestMode) {
          console.log('Local test calendar unavailable reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarUnavailableReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: calendarUnavailableReply })
        return new Response('OK', { status: 200 })
      }

      const calendarCreateRequestReply = await resolveCalendarCreateRequestReply({
        supabase,
        userId,
        chatId,
        text: userText,
      })

      if (calendarCreateRequestReply !== null) {
        if (isLocalTestMode) {
          console.log('Local test calendar create draft reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarCreateRequestReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: calendarCreateRequestReply })
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
          await resolveReminderPreferenceReply({ supabase, userId, awaitingReminder, userText })
        )

        if (isLocalTestMode) {
          console.log('Local test reminder preference reply generated')
        } else {
          await sendTelegramMessage(chatId, preferenceReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: preferenceReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (isPlainTextMessage && isLikelyReminderRequest(userText)) {
      if (!hasExplicitReminderTime(userText)) {
        const missingTimeQuestion = formatMissingReminderTimeQuestion({
          text: userText,
          timezone: 'Asia/Singapore',
        })

        if (missingTimeQuestion !== null) {
          await savePendingReminderTimeClarification({
            supabase,
            userId,
            chatId,
            text: userText,
            timezone: 'Asia/Singapore',
            sourceMessageContent: userText,
          })

          const formattedMissingTimeQuestion = formatForTelegramPlainText(missingTimeQuestion)

          if (isLocalTestMode) {
            console.log('Local test reminder missing time question generated')
          } else {
            await sendTelegramMessage(chatId, formattedMissingTimeQuestion)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: formattedMissingTimeQuestion })
          return new Response('OK', { status: 200 })
        }
      }

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
          console.log('Local test reminder confirmation generated')
        } else {
          await sendTelegramMessage(chatId, reminderConfirmation)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: reminderConfirmation })
        return new Response('OK', { status: 200 })
      }

      if (reminderExtraction.action === 'ask_clarifying_question') {
        await savePendingReminderTimeClarification({
          supabase,
          userId,
          chatId,
          text: userText,
          timezone: 'Asia/Singapore',
          sourceMessageContent: userText,
        })

        const clarifyingQuestion = formatForTelegramPlainText(reminderExtraction.clarifying_question)

        if (isLocalTestMode) {
          console.log('Local test reminder clarifying question generated')
        } else {
          await sendTelegramMessage(chatId, clarifyingQuestion)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: clarifyingQuestion })
        return new Response('OK', { status: 200 })
      }
    }

    if (financeText !== null) {
      const calendarPlanningIntent = detectCalendarPlanningIntent(financeText)

      if (calendarPlanningIntent !== null) {
        console.log('calendar_planning_detected', {
          period: calendarPlanningIntent.period,
          kind: calendarPlanningIntent.kind,
        })

        let calendarPlanningReply: string
        const accessResolution = await resolveCalendarAccessForRequest()

        if (!accessResolution.canUseCalendar) {
          calendarPlanningReply = accessResolution.reply
        } else {
          try {
            calendarPlanningReply = await resolveCalendarPlanningReply({
              supabase,
              userId,
              chatId,
              intent: calendarPlanningIntent,
              calendarAccess: getCalendarAccessParams(accessResolution),
            })
          } catch (error) {
            const calendarError =
              error instanceof CalendarReadError
                ? error
                : new CalendarReadError({ category: 'google_unknown_error' })

            console.error('calendar_planning_failed', {
              category: calendarError.category,
            })
            calendarPlanningReply =
              calendarError.category === 'missing_env'
                ? 'I can read your calendar once the Google Calendar connection is set up.'
                : 'I couldn’t read your calendar right now.'
          }
        }

        if (isLocalTestMode) {
          console.log('Local test calendar planning reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarPlanningReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: calendarPlanningReply })
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
            console.log('Local test future event ask message generated')
          } else {
            await sendTelegramMessage(chatId, askMessage)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: askMessage })
          return new Response('OK', { status: 200 })
        }

        if (futureEventExtraction.action === 'ask_clarifying_question') {
          const clarifyingQuestion = formatForTelegramPlainText(futureEventExtraction.clarifying_question)

          if (isLocalTestMode) {
            console.log('Local test future event clarifying question generated')
          } else {
            await sendTelegramMessage(chatId, clarifyingQuestion)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: clarifyingQuestion })
          return new Response('OK', { status: 200 })
        }
      }
    }

    if (financeText !== null) {
      const calendarQueryIntent = detectCalendarQueryIntent(financeText)

      if (calendarQueryIntent !== null) {
        console.log('calendar_query_detected', {
          period: calendarQueryIntent.period,
          mode: calendarQueryIntent.mode,
        })

        let calendarQueryReply: string
        const accessResolution = await resolveCalendarAccessForRequest()

        if (!accessResolution.canUseCalendar) {
          calendarQueryReply = accessResolution.reply
        } else {
          try {
            calendarQueryReply = await resolveCalendarQueryReply({
              supabase,
              userId,
              chatId,
              intent: calendarQueryIntent,
              calendarAccess: getCalendarAccessParams(accessResolution),
            })
          } catch (error) {
            const calendarError =
              error instanceof CalendarReadError
                ? error
                : new CalendarReadError({ category: 'google_unknown_error' })

            console.error('calendar_query_failed', {
              category: calendarError.category,
              status: calendarError.status,
              reason: calendarError.reason,
            })
            calendarQueryReply =
              calendarError.category === 'missing_env'
                ? 'I can read your calendar once the Google Calendar connection is set up.'
                : 'I couldn’t read your calendar right now.'
          }
        }

        if (isLocalTestMode) {
          console.log('Local test calendar query reply generated')
        } else {
          await sendTelegramMessage(chatId, calendarQueryReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: calendarQueryReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (financeText !== null) {
      const financeQueryIntent = detectFinanceQueryIntent(financeText)

      if (financeQueryIntent !== null) {
        if (!featureFlags.finance_enabled) {
          const financeUnavailableReply = getFeatureUnavailableReply('Finance')

          if (isLocalTestMode) {
            console.log('Local test finance disabled reply generated')
          } else {
            await sendTelegramMessage(chatId, financeUnavailableReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: financeUnavailableReply })
          return new Response('OK', { status: 200 })
        }

        logFinanceInfo('finance_query_detected', {
          period: financeQueryIntent.period,
          hasCategory: financeQueryIntent.category !== undefined,
        })

        let financeQueryReply: string

        try {
          financeQueryReply = await resolveFinanceQueryReply({
            supabase,
            userId,
            chatId,
            intent: financeQueryIntent,
            useNotionFinance: canUseNotionFinance,
          })
        } catch (error) {
          logFinanceError('finance_query_failed', {
            category: error instanceof NotionExpenseLogError ? error.category : 'supabase_or_unknown_error',
          })
          financeQueryReply = 'I couldn’t read your expenses right now.'
        }

        if (isLocalTestMode) {
          console.log('Local test finance query reply generated')
        } else {
          await sendTelegramMessage(chatId, financeQueryReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: financeQueryReply })
        return new Response('OK', { status: 200 })
      }
    }

    if (financeText !== null) {
      const correctionAmount = parseFinanceAmountCorrection(financeText)

      if (correctionAmount !== null) {
        const pendingFinanceConfirmation = await getLatestPendingFinanceConfirmation({ supabase, userId })

        if (pendingFinanceConfirmation !== null) {
          if (!featureFlags.finance_enabled) {
            const financeUnavailableReply = getFeatureUnavailableReply('Finance')

            if (isLocalTestMode) {
              console.log('Local test finance disabled reply generated')
            } else {
              await sendTelegramMessage(chatId, financeUnavailableReply)
            }

            await saveMessage({ supabase, userId, role: 'assistant', content: financeUnavailableReply })
            return new Response('OK', { status: 200 })
          }

          logFinanceInfo('finance_confirmation_detected', {
            hasPendingConfirmation: true,
          })

          const correctionText = formatFinanceCorrectionForParser({
            correctionAmount,
            pendingConfirmation: pendingFinanceConfirmation,
          })
          let expenseLog: Awaited<ReturnType<typeof parseExpenseLogWithLLM>>

          try {
            expenseLog = await parseExpenseLogWithLLM({
              text: correctionText,
              localDate: getLocalDateString(new Date(), 'Asia/Singapore'),
              callLLM,
            })
          } catch (error) {
            logFinanceError('finance_parse_failed', {
              flow: 'confirmation',
              errorName: error instanceof Error ? error.name : 'unknown_error',
            })

            const financeParseErrorReply = "I couldn't understand that expense clearly enough to log it."

            if (isLocalTestMode) {
              console.log('Local test finance confirmation parse error reply generated')
            } else {
              await sendTelegramMessage(chatId, financeParseErrorReply)
            }

            await saveMessage({ supabase, userId, role: 'assistant', content: financeParseErrorReply })
            logFinanceInfo('finance_reply_sent', { outcome: 'confirmation_parse_failed' })
            return new Response('OK', { status: 200 })
          }

          const financeValidation = validateExpenseLogForNotion(correctionText, expenseLog)

          if (!financeValidation.ok) {
            logFinanceInfo(financeValidation.logEvent, {
              flow: 'confirmation',
              reason: financeValidation.reason,
              isExpense: expenseLog.is_expense,
              hasExpenseTitle: expenseLog.expense.length > 0,
              hasPositiveAmount: Number.isFinite(expenseLog.amount) && expenseLog.amount > 0,
            })

            if (isLocalTestMode) {
              console.log('Local test finance confirmation validation reply generated')
            } else {
              await sendTelegramMessage(chatId, financeValidation.reply)
            }

            await saveMessage({ supabase, userId, role: 'assistant', content: financeValidation.reply })
            logFinanceInfo('finance_reply_sent', { outcome: financeValidation.reason })
            return new Response('OK', { status: 200 })
          }

          const financeCreateStartedAt = Date.now()
          logFinanceInfo('finance_confirmation_create_started', {
            store: canUseNotionFinance ? 'notion' : 'supabase',
          })

          try {
            await saveParsedExpenseLog({
              supabase,
              userId,
              expenseLog,
              rawText: correctionText,
              source: 'telegram_finance_confirmation',
              useNotionFinance: canUseNotionFinance,
            })
            logFinanceInfo('finance_confirmation_create_success', {
              durationMs: Date.now() - financeCreateStartedAt,
              store: canUseNotionFinance ? 'notion' : 'supabase',
            })
          } catch (error) {
            const notionError =
              error instanceof NotionExpenseLogError
                ? error
                : new NotionExpenseLogError({ category: 'notion_unknown_error' })

            logFinanceError('finance_confirmation_create_failed', {
              durationMs: Date.now() - financeCreateStartedAt,
              status: notionError.status,
              notionCode: notionError.notionCode,
              category: error instanceof NotionExpenseLogError ? notionError.category : 'supabase_or_unknown_error',
              store: canUseNotionFinance ? 'notion' : 'supabase',
            })

            const financeToolErrorReply =
              canUseNotionFinance && notionError.category === 'notion_schema_mismatch'
                ? 'I found the expense, but my Notion database fields don’t match what I expected yet.'
                : 'I found the expense, but I couldn’t save it right now.'

            if (isLocalTestMode) {
              console.log('Local test finance confirmation tool error reply generated')
            } else {
              await sendTelegramMessage(chatId, financeToolErrorReply)
            }

            await saveMessage({ supabase, userId, role: 'assistant', content: financeToolErrorReply })
            logFinanceInfo('finance_reply_sent', { outcome: 'confirmation_notion_failed' })
            return new Response('OK', { status: 200 })
          }

          const financeReply = formatExpenseLoggedReply(expenseLog)

          if (isLocalTestMode) {
            console.log('Local test finance confirmation reply generated')
          } else {
            await sendTelegramMessage(chatId, financeReply)
          }

          try {
            await saveMessage({ supabase, userId, role: 'assistant', content: financeReply })
          } catch (error) {
            console.error('Failed to save finance confirmation assistant reply:', error)
          }

          logFinanceInfo('finance_reply_sent', { outcome: 'confirmation_logged' })
          return new Response('OK', { status: 200 })
        }
      }
    }

    if (financeText !== null && isFinanceCandidate) {
      if (!featureFlags.finance_enabled) {
        const financeUnavailableReply = getFeatureUnavailableReply('Finance')

        if (isLocalTestMode) {
          console.log('Local test finance disabled reply generated')
        } else {
          await sendTelegramMessage(chatId, financeUnavailableReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: financeUnavailableReply })
        return new Response('OK', { status: 200 })
      }

      if (financeSource === 'voice') {
        logFinanceInfo('voice_transcription_finance_candidate_detected', {
          messageLength: financeText.length,
        })
      }

      logFinanceInfo('finance_candidate_detected', {
        source: financeSource,
        messageLength: financeText.length,
      })

      const financeIntent = classifyFinanceIntent(financeText)

      const shouldTryExpenseLog = financeIntent.intent === 'expense_log'

      if (financeIntent.intent === 'query') {
        logFinanceInfo('finance_ambiguous', { reason: financeIntent.reason ?? 'query' })
      } else if (!shouldTryExpenseLog) {
        logFinanceInfo(
          financeIntent.intent === 'ambiguous' ? 'finance_ambiguous' : 'finance_validation_failed',
          {
            reason: financeIntent.reason ?? financeIntent.intent,
          }
        )

        const financeIntentReply = financeIntent.reply ?? "I couldn't tell if that was an expense to log."

        if (isLocalTestMode) {
          console.log('Local test finance intent reply generated')
        } else {
          await sendTelegramMessage(chatId, financeIntentReply)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: financeIntentReply })
        logFinanceInfo('finance_reply_sent', { outcome: financeIntent.reason ?? financeIntent.intent })
        return new Response('OK', { status: 200 })
      }

      if (shouldTryExpenseLog) {
        const parseStartedAt = Date.now()
        logFinanceInfo('finance_parse_started')
        let expenseLog: Awaited<ReturnType<typeof parseExpenseLogWithLLM>>

        try {
          expenseLog = await parseExpenseLogWithLLM({
            text: financeText,
            localDate: getLocalDateString(new Date(), 'Asia/Singapore'),
            callLLM,
          })
          logFinanceInfo('finance_parse_success', {
            durationMs: Date.now() - parseStartedAt,
            isExpense: expenseLog.is_expense,
            hasExpenseTitle: expenseLog.expense.length > 0,
            hasPositiveAmount: Number.isFinite(expenseLog.amount) && expenseLog.amount > 0,
          })
        } catch (error) {
          logFinanceError('finance_parse_failed', {
            durationMs: Date.now() - parseStartedAt,
            errorName: error instanceof Error ? error.name : 'unknown_error',
          })

          const financeParseErrorReply = "I couldn't understand that expense clearly enough to log it."

          if (isLocalTestMode) {
            console.log('Local test finance parse error reply generated')
          } else {
            await sendTelegramMessage(chatId, financeParseErrorReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: financeParseErrorReply })
          logFinanceInfo('finance_reply_sent', { outcome: 'parse_failed' })
          return new Response('OK', { status: 200 })
        }

        const financeValidation = validateExpenseLogForNotion(financeText, expenseLog)

        if (!financeValidation.ok) {
          logFinanceInfo(financeValidation.logEvent, {
            reason: financeValidation.reason,
            isExpense: expenseLog.is_expense,
            hasExpenseTitle: expenseLog.expense.length > 0,
            hasPositiveAmount: Number.isFinite(expenseLog.amount) && expenseLog.amount > 0,
          })

          if (isLocalTestMode) {
            console.log('Local test finance clarification reply generated')
          } else {
            await sendTelegramMessage(chatId, financeValidation.reply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: financeValidation.reply })
          logFinanceInfo('finance_reply_sent', { outcome: financeValidation.reason })
          return new Response('OK', { status: 200 })
        }

        const financeCreateStartedAt = Date.now()
        logFinanceInfo('finance_create_started', {
          store: canUseNotionFinance ? 'notion' : 'supabase',
        })

        try {
          await saveParsedExpenseLog({
            supabase,
            userId,
            expenseLog,
            rawText: financeText,
            source: financeSource === 'voice' ? 'telegram_voice' : 'telegram_text',
            useNotionFinance: canUseNotionFinance,
          })
          logFinanceInfo('finance_create_success', {
            durationMs: Date.now() - financeCreateStartedAt,
            store: canUseNotionFinance ? 'notion' : 'supabase',
          })
        } catch (error) {
          const notionError =
            error instanceof NotionExpenseLogError
              ? error
              : new NotionExpenseLogError({ category: 'notion_unknown_error' })

          logFinanceError('finance_create_failed', {
            durationMs: Date.now() - financeCreateStartedAt,
            status: notionError.status,
            notionCode: notionError.notionCode,
            category: error instanceof NotionExpenseLogError ? notionError.category : 'supabase_or_unknown_error',
            store: canUseNotionFinance ? 'notion' : 'supabase',
          })

          const financeToolErrorReply =
            canUseNotionFinance && notionError.category === 'notion_schema_mismatch'
              ? 'I found the expense, but my Notion database fields don’t match what I expected yet.'
              : 'I found the expense, but I couldn’t save it right now.'

          if (isLocalTestMode) {
            console.log('Local test finance tool error reply generated')
          } else {
            await sendTelegramMessage(chatId, financeToolErrorReply)
          }

          await saveMessage({ supabase, userId, role: 'assistant', content: financeToolErrorReply })
          logFinanceInfo('finance_reply_sent', { outcome: 'notion_failed' })
          if (financeSource === 'voice') {
            logFinanceInfo('voice_finance_failed', { reason: notionError.category })
          }
          return new Response('OK', { status: 200 })
        }

        const financeReply = formatExpenseLoggedReply(expenseLog)

        if (isLocalTestMode) {
          console.log('Local test finance reply generated')
        } else {
          await sendTelegramMessage(chatId, financeReply)
        }

        try {
          await saveMessage({ supabase, userId, role: 'assistant', content: financeReply })
        } catch (error) {
          console.error('Failed to save finance assistant reply:', error)
        }

        logFinanceInfo('finance_reply_sent', { outcome: 'logged' })
        if (financeSource === 'voice') {
          logFinanceInfo('voice_finance_logged')
        }
        return new Response('OK', { status: 200 })
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
Bergi should feel like a friend continuing the conversation, not a service offering features.
Never claim an expense was logged, saved to Notion, or added to finance records from normal chat. Only the finance logging code can say "Logged:" after the real finance logger succeeds. If an expense-like message reaches normal chat, ask for a clearer text expense instead of pretending it was logged.
Do not default to ending helpful replies with "if you want, I can...". Use that kind of offer only when Min explicitly asks for a template, draft, plan, checklist, concrete next action, or help generating something.
Avoid generic assistant endings like "If you want, I can help you with that", "Let me know if you want me to...", "I can also...", "Would you like me to...", "say so and I’ll...", "if you mean X, say so...", or "tell me if you want...".
If Bergi has already answered enough, just stop. Do not add a trailing meta-offer or clarification offer by default.
If clarification is genuinely needed, ask one direct human question instead of a service-style offer.
For normal companion replies, prefer a small follow-up question, a grounded observation, a casual reassurance, or no extra ending at all.
For memory summaries, end with a grounded observation like "i’m reading the current thread as internship-progress stuff for now.", "that’s the main thread i’m seeing so far.", or "this one seems to be the thing your brain keeps coming back to."
Better endings: "what did you touch today, even roughly?", "that one counts, honestly.", "we can use that as today’s progress check.", "tell me the messy version first." Or simply stop after the useful point.
`
    const recentLifeThreadNotes = featureFlags.memory_enabled
      ? await getRecentLifeThreadNotes({ supabase, userId, limit: 5 })
      : []
    const mostRelevantLifeThreadNote = findMostRelevantLifeThreadNote(userMessageForLLM, recentLifeThreadNotes)
    const mostRelevantLifeThreadNoteContext = formatMostRelevantLifeThreadNoteForPrompt(mostRelevantLifeThreadNote)
    const lifeThreadNotesContext = formatRecentLifeThreadNotesForPrompt(recentLifeThreadNotes)
    const recentProactiveCheckin = await getRecentSentProactiveCheckinForReplyContext({ supabase, userId, chatId })
    if (featureFlags.memory_enabled) {
      await saveProactiveProgressNoteIfMeaningful({
        supabase,
        userId,
        sourceMessageId: savedUserMessageId,
        rawText: userText ?? userMessageToSave,
        recentProactiveCheckin,
      })
    }
    const recentProactiveCheckinContext = formatRecentProactiveCheckinForPrompt(recentProactiveCheckin)
    const finalSystemPrompt = `${systemPrompt}

${recentProactiveCheckinContext ? `${recentProactiveCheckinContext}\n\n` : ''}${
      mostRelevantLifeThreadNoteContext ? `${mostRelevantLifeThreadNoteContext}\n\n` : ''
    }${responseModeGuidance}${lifeThreadNotesContext ? `\n${lifeThreadNotesContext}` : ''}`
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
      console.log('Local test LLM response generated')
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
