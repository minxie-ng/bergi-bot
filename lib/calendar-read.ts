import { createSign } from 'node:crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

export type CalendarQueryPeriod =
  | 'today'
  | 'tomorrow'
  | 'evening'
  | 'week'
  | 'next_week'
  | 'today_tomorrow'
  | 'next_weekday'
  | 'next'
  | 'unsupported'

export type CalendarQueryMode = 'events' | 'busy' | 'clarify'

export type CalendarQueryIntent = {
  period: CalendarQueryPeriod
  mode: CalendarQueryMode
  weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  weekdayLabel?: string
}

export type CalendarPlanningPeriod = 'today' | 'tomorrow' | 'evening' | 'tomorrow_evening' | 'next_week' | 'unsupported'
export type CalendarPlanningKind = 'plan_day' | 'work_focus' | 'fit_activity' | 'free_time' | 'packed_check' | 'create_request' | 'clarify'

export type CalendarPlanningIntent = {
  period: CalendarPlanningPeriod
  kind: CalendarPlanningKind
  activity?: string
  requestedTime?: string
}

export type CalendarEvent = {
  title: string
  start: string
  end: string | null
  isAllDay: boolean
}

export type CalendarCreateEventInput = {
  title: string
  start: string
  end: string
  timezone: string
  description?: string | null
  colorId?: string
  allDayDate?: string | null
  allDayEndDate?: string | null
}

const WEEKDAY_MATCHES: Array<{ index: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string; pattern: RegExp }> = [
  { index: 1, label: 'next Monday', pattern: /\bnext\s+mon(?:day)?\b/ },
  { index: 2, label: 'next Tuesday', pattern: /\bnext\s+tue(?:s|sday)?\b/ },
  { index: 3, label: 'next Wednesday', pattern: /\bnext\s+wed(?:nesday)?\b/ },
  { index: 4, label: 'next Thursday', pattern: /\bnext\s+thu(?:r|rs|rsday)?\b/ },
  { index: 5, label: 'next Friday', pattern: /\bnext\s+fri(?:day)?\b/ },
  { index: 6, label: 'next Saturday', pattern: /\bnext\s+sat(?:urday)?\b/ },
  { index: 0, label: 'next Sunday', pattern: /\bnext\s+sun(?:day)?\b/ },
]

const CALENDAR_CLARIFICATION_REPLY =
  'I can check your calendar, but which time range do you mean — today, tomorrow, this week, or next Monday?'
const CALENDAR_PLANNING_CLARIFICATION_REPLY =
  'I can help plan around your calendar, but which time range do you mean — today, tomorrow, this evening, or next week?'

export type CalendarReadErrorCategory =
  | 'missing_env'
  | 'invalid_private_key'
  | 'malformed_private_key_after_normalization'
  | 'google_auth_rejected_private_key'
  | 'calendar_api_disabled'
  | 'calendar_not_found_or_not_shared'
  | 'calendar_permission_denied'
  | 'calendar_write_permission_denied'
  | 'google_auth_error'
  | 'google_calendar_api_error'
  | 'google_unknown_error'

export class CalendarReadError extends Error {
  category: CalendarReadErrorCategory
  status?: number
  reason?: string

  constructor(params: { category: CalendarReadErrorCategory; status?: number; reason?: string }) {
    super(params.category)
    this.name = 'CalendarReadError'
    this.category = params.category
    this.status = params.status
    this.reason = params.reason
  }
}

type GoogleCalendarEvent = {
  summary?: unknown
  start?: {
    date?: unknown
    dateTime?: unknown
  }
  end?: {
    date?: unknown
    dateTime?: unknown
  }
}

type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[]
}

type CalendarReadEnvValidationMetadata = {
  hasServiceAccountEmail: boolean
  hasPrivateKey: boolean
  privateKeyIncludesBeginPrivateKey: boolean
  privateKeyIncludesEscapedNewline: boolean
  privateKeyIncludesRealNewline: boolean
  normalizedPrivateKeyIncludesBeginPrivateKey: boolean
  normalizedPrivateKeyIncludesRealNewline: boolean
  normalizedPrivateKeyLineCount: number
  hasCalendarId: boolean
}

type SafeGoogleErrorDetails = {
  status?: number
  reason?: string
}

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null

export function getCalendarReadEnvValidationMetadata(): CalendarReadEnvValidationMetadata {
  const serviceAccountEmail = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY
  const normalizedPrivateKey = typeof privateKey === 'string' ? normalizeGooglePrivateKey(privateKey) : undefined
  const calendarId = process.env.GOOGLE_CALENDAR_ID

  return {
    hasServiceAccountEmail: Boolean(serviceAccountEmail),
    hasPrivateKey: Boolean(privateKey),
    privateKeyIncludesBeginPrivateKey: Boolean(privateKey?.includes('BEGIN PRIVATE KEY')),
    privateKeyIncludesEscapedNewline: Boolean(privateKey?.includes('\\n')),
    privateKeyIncludesRealNewline: Boolean(privateKey?.includes('\n')),
    normalizedPrivateKeyIncludesBeginPrivateKey: Boolean(normalizedPrivateKey?.includes('BEGIN PRIVATE KEY')),
    normalizedPrivateKeyIncludesRealNewline: Boolean(normalizedPrivateKey?.includes('\n')),
    normalizedPrivateKeyLineCount: normalizedPrivateKey ? normalizedPrivateKey.split('\n').length : 0,
    hasCalendarId: Boolean(calendarId),
  }
}

function normalizeCalendarText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectCalendarQueryIntent(text: string): CalendarQueryIntent | null {
  const normalized = normalizeCalendarText(text)
  const hasCalendarWord = /\b(calendar|schedule|agenda|events?|plans?)\b/.test(normalized)
  const hasCalendarTimeRange =
    /\b(?:today|tdy|tomorrow|tmr|tonight|evening|this\s+week|next\s+week)\b/.test(normalized) ||
    WEEKDAY_MATCHES.some(({ pattern }) => pattern.test(normalized))
  const hasCalendarQuestion =
    /\bwhat\s+do\s+i\s+(?:have|hv)\b/.test(normalized) ||
    /\b(?:do\s+i\s+have|have)\s+anything\b/.test(normalized) ||
    (/\banything\b/.test(normalized) && hasCalendarTimeRange) ||
    /\b(?:am\s+i|will\s+i\s+be)\s+busy\b/.test(normalized) ||
    /\bhow\s+busy\b/.test(normalized) ||
    /\b(?:free|busy)\b/.test(normalized)
  const isCalendarish = hasCalendarWord || hasCalendarQuestion
  const mode: CalendarQueryMode = /\b(busy|free|clear|packed)\b|\bhow\s+busy\b/.test(normalized) ? 'busy' : 'events'

  if (!isCalendarish) {
    return null
  }

  const weekdayMatch = WEEKDAY_MATCHES.find(({ pattern }) => pattern.test(normalized))

  if (weekdayMatch) {
    return {
      period: 'next_weekday',
      mode,
      weekday: weekdayMatch.index,
      weekdayLabel: weekdayMatch.label,
    }
  }

  if (
    /\b(?:today|tdy)\s+or\s+(?:tomorrow|tmr)\b/.test(normalized) ||
    /\b(?:tomorrow|tmr)\s+or\s+(?:today|tdy)\b/.test(normalized)
  ) {
    return { period: 'today_tomorrow', mode }
  }

  if (/\bnext\s+week\b/.test(normalized)) {
    return { period: 'next_week', mode }
  }

  if (/\bnext\s+(calendar\s+)?event\b/.test(normalized) || /\bwhat'?s\s+next\s+on\s+my\s+calendar\b/.test(normalized)) {
    return { period: 'next', mode: 'events' }
  }

  if (/\bsummari[sz]e\s+my\s+week\b/.test(normalized) || /\bwhat\s+do\s+i\s+have\s+this\s+week\b/.test(normalized)) {
    return { period: 'week', mode }
  }

  if (/\b(this\s+)?evening\b/.test(normalized) && /\b(anything|schedule|calendar|have|event|do i have)\b/.test(normalized)) {
    return { period: 'evening', mode }
  }

  if (/\b(?:tomorrow|tmr)\b/.test(normalized) && /\b(what\s+do\s+i\s+(?:have|hv)|schedule|calendar|anything|events?|busy|free)\b/.test(normalized)) {
    return { period: 'tomorrow', mode }
  }

  if (
    /\b(?:today|tdy)\b/.test(normalized) &&
    /\b(what\s+do\s+i\s+(?:have|hv)|what'?s\s+my\s+schedule|schedule|calendar|anything|events?|busy|free)\b/.test(normalized)
  ) {
    return { period: 'today', mode }
  }

  if (/\b(schedule|calendar)\b/.test(normalized) && /\b(today|tomorrow|this week|evening)\b/.test(normalized)) {
    if (/\btomorrow\b/.test(normalized)) {
      return { period: 'tomorrow', mode }
    }

    if (/\bthis\s+week\b/.test(normalized)) {
      return { period: 'week', mode }
    }

    if (/\bevening\b/.test(normalized)) {
      return { period: 'evening', mode }
    }

    return { period: 'today', mode }
  }

  return { period: 'unsupported', mode: 'clarify' }
}

export function getCalendarClarificationReply(): string {
  return CALENDAR_CLARIFICATION_REPLY
}

export function detectCalendarPlanningIntent(text: string): CalendarPlanningIntent | null {
  const normalized = normalizeCalendarText(text)
  const hasCalendarTimeRange = /\b(today|tdy|tomorrow|tmr|tonight|evening|next\s+week)\b/.test(normalized)
  const period = detectCalendarPlanningPeriod(normalized)
  const requestedTime = detectCalendarPlanningRequestedTime(normalized)
  const activity = detectCalendarPlanningActivity(normalized)
  const asksCreate =
    /\b(add|create|schedule|put|block)\b/.test(normalized) &&
    hasCalendarTimeRange &&
    /\b(calendar|event|gym|workout|exercise|meeting|class|call|appointment|bergi|work|study)\b/.test(normalized)

  if (asksCreate) {
    return {
      period,
      kind: 'create_request',
      activity,
      requestedTime,
    }
  }

  if (/\bhelp\s+me\s+plan\b/.test(normalized) && hasCalendarTimeRange) {
    return { period, kind: period === 'unsupported' ? 'clarify' : 'plan_day', activity }
  }

  if (/\bwhat\s+should\s+i\s+focus\s+on\b/.test(normalized) && hasCalendarTimeRange) {
    return { period, kind: period === 'unsupported' ? 'clarify' : 'work_focus', activity }
  }

  if (/\bwhen\s+should\s+i\s+work\s+on\b/.test(normalized) && hasCalendarTimeRange) {
    return { period, kind: period === 'unsupported' ? 'clarify' : 'work_focus', activity }
  }

  if (/\bwhen\s+am\s+i\s+free\b/.test(normalized) && hasCalendarTimeRange) {
    return { period, kind: period === 'unsupported' ? 'clarify' : 'free_time', activity }
  }

  if (
    (/\bdo\s+i\s+have\s+time\s+to\b/.test(normalized) ||
      /\bcan\s+i\s+fit\b/.test(normalized) ||
      /\bcan\s+i\s+squeeze\s+in\b/.test(normalized)) &&
    hasCalendarTimeRange
  ) {
    return { period, kind: period === 'unsupported' ? 'clarify' : 'fit_activity', activity }
  }

  if (/\bnext\s+week\b/.test(normalized) && /\b(too\s+packed|packed|too\s+busy|busy|manageable)\b/.test(normalized)) {
    return { period: 'next_week', kind: 'packed_check', activity }
  }

  if (/\b(help\s+me\s+plan|when\s+am\s+i\s+free|when\s+should\s+i\s+work|do\s+i\s+have\s+time|can\s+i\s+fit)\b/.test(normalized)) {
    return { period: 'unsupported', kind: 'clarify', activity }
  }

  return null
}

export function getCalendarPlanningClarificationReply(): string {
  return CALENDAR_PLANNING_CLARIFICATION_REPLY
}

function detectCalendarPlanningPeriod(normalized: string): CalendarPlanningPeriod {
  if (/\bnext\s+week\b/.test(normalized)) {
    return 'next_week'
  }

  if (/\b(tomorrow|tmr)\b/.test(normalized) && /\b(tonight|evening)\b/.test(normalized)) {
    return 'tomorrow_evening'
  }

  if (/\b(tomorrow|tmr)\b/.test(normalized)) {
    return 'tomorrow'
  }

  if (/\b(tonight|evening)\b/.test(normalized)) {
    return 'evening'
  }

  if (/\b(today|tdy)\b/.test(normalized)) {
    return 'today'
  }

  return 'unsupported'
}

function detectCalendarPlanningRequestedTime(normalized: string): string | undefined {
  const match = normalized.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/)

  if (!match) {
    return undefined
  }

  const hour = Number(match[1])
  const minute = match[2] ?? '00'
  const meridiem = match[3]

  if (meridiem === 'pm' && hour < 12) {
    return `${String(hour + 12).padStart(2, '0')}:${minute}`
  }

  if (meridiem === 'am' && hour === 12) {
    return `00:${minute}`
  }

  return `${String(hour).padStart(2, '0')}:${minute}`
}

function detectCalendarPlanningActivity(normalized: string): string | undefined {
  if (/\bbergi\b/.test(normalized)) {
    return 'Bergi'
  }

  if (/\b(gym|workout|exercise|run|yoga)\b/.test(normalized)) {
    return 'exercise'
  }

  if (/\b(study|class|assignment)\b/.test(normalized)) {
    return 'study'
  }

  if (/\b(work|deep work|focus)\b/.test(normalized)) {
    return 'deep work'
  }

  return undefined
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function normalizeGooglePrivateKey(rawKey: string): string {
  const trimmed = rawKey.trim()
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed

  return unquoted.replace(/\\n/g, '\n').trim()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function getSafeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()

  if (!normalized || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized)) {
    return undefined
  }

  return normalized
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function getSafeGoogleErrorDetails(data: unknown, fallbackStatus?: number): SafeGoogleErrorDetails {
  const root = getRecord(data)
  const rootError = root?.error

  if (typeof rootError === 'string') {
    return {
      status: typeof root?.code === 'number' ? root.code : fallbackStatus,
      reason: getSafeString(rootError),
    }
  }

  const error = getRecord(rootError)
  const errors = Array.isArray(error?.errors) ? error.errors : []
  const firstError = getRecord(errors[0])

  return {
    status: typeof error?.code === 'number' ? error.code : fallbackStatus,
    reason:
      getSafeString(firstError?.reason) ??
      getSafeString(error?.status) ??
      getSafeString(error?.reason) ??
      getSafeString(root?.reason),
  }
}

function getAuthErrorCategory(details: SafeGoogleErrorDetails): CalendarReadErrorCategory {
  if (details.reason === 'invalid_grant' || details.reason === 'invalid_client') {
    return 'google_auth_rejected_private_key'
  }

  if (details.status !== undefined) {
    return 'google_auth_error'
  }

  return 'google_unknown_error'
}

function getCalendarApiErrorCategory(details: SafeGoogleErrorDetails): CalendarReadErrorCategory {
  if (
    details.reason === 'accessNotConfigured' ||
    details.reason === 'serviceDisabled' ||
    details.reason === 'SERVICE_DISABLED' ||
    details.reason === 'API_DISABLED'
  ) {
    return 'calendar_api_disabled'
  }

  if (details.status === 404 || details.reason === 'notFound') {
    return 'calendar_not_found_or_not_shared'
  }

  if (details.status === 401 || details.status === 403) {
    return 'calendar_permission_denied'
  }

  if (details.status !== undefined) {
    return 'google_calendar_api_error'
  }

  return 'google_unknown_error'
}

async function getSafeGoogleErrorDetailsFromResponse(response: Response): Promise<SafeGoogleErrorDetails> {
  try {
    const data = (await response.json()) as unknown
    return getSafeGoogleErrorDetails(data, response.status)
  } catch {
    return { status: response.status }
  }
}

async function getGoogleCalendarAccessToken(): Promise<string> {
  const serviceAccountEmail = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY

  if (!serviceAccountEmail || !privateKey) {
    throw new CalendarReadError({ category: 'missing_env' })
  }

  const normalizedPrivateKey = normalizeGooglePrivateKey(privateKey)

  if (!normalizedPrivateKey.includes('BEGIN PRIVATE KEY')) {
    throw new CalendarReadError({ category: 'malformed_private_key_after_normalization' })
  }

  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.token
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccountEmail,
      scope: GOOGLE_CALENDAR_EVENTS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: expiresAt,
      iat: issuedAt,
    })
  )
  const unsignedJwt = `${header}.${claim}`
  const signer = createSign('RSA-SHA256')

  signer.update(unsignedJwt)
  signer.end()

  let signature: string

  try {
    signature = base64UrlEncode(signer.sign(normalizedPrivateKey))
  } catch {
    throw new CalendarReadError({ category: 'malformed_private_key_after_normalization' })
  }

  const assertion = `${unsignedJwt}.${signature}`
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 1800)

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })

    if (!response.ok) {
      const details = await getSafeGoogleErrorDetailsFromResponse(response)

      throw new CalendarReadError({
        category: getAuthErrorCategory(details),
        status: details.status,
        reason: details.reason,
      })
    }

    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown }

    if (typeof data.access_token !== 'string') {
      throw new CalendarReadError({ category: 'google_unknown_error' })
    }

    cachedAccessToken = {
      token: data.access_token,
      expiresAtMs: Date.now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000,
    }

    return cachedAccessToken.token
  } catch (error) {
    if (error instanceof CalendarReadError) {
      throw error
    }

    if (isAbortError(error)) {
      throw new CalendarReadError({ category: 'google_unknown_error' })
    }

    throw new CalendarReadError({ category: 'google_unknown_error' })
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeGoogleCalendarEvent(event: GoogleCalendarEvent): CalendarEvent | null {
  const start = typeof event.start?.dateTime === 'string' ? event.start.dateTime : event.start?.date
  const end = typeof event.end?.dateTime === 'string' ? event.end.dateTime : event.end?.date

  if (typeof start !== 'string') {
    return null
  }

  return {
    title: typeof event.summary === 'string' && event.summary.trim() ? event.summary.trim() : 'busy',
    start,
    end: typeof end === 'string' ? end : null,
    isAllDay: typeof event.start?.date === 'string' && typeof event.start?.dateTime !== 'string',
  }
}

function getCalendarCreateErrorCategory(details: SafeGoogleErrorDetails): CalendarReadErrorCategory {
  if (details.status === 401 || details.status === 403) {
    return 'calendar_write_permission_denied'
  }

  return getCalendarApiErrorCategory(details)
}

export async function queryGoogleCalendarEvents(params: {
  timeMin: string
  timeMax?: string
  maxResults?: number
}): Promise<CalendarEvent[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID

  if (!calendarId) {
    throw new CalendarReadError({ category: 'missing_env' })
  }

  const accessToken = await getGoogleCalendarAccessToken()
  const searchParams = new URLSearchParams({
    timeMin: params.timeMin,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(params.maxResults ?? 10),
  })

  if (params.timeMax) {
    searchParams.set('timeMax', params.timeMax)
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 1800)

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${searchParams.toString()}`,
      {
        method: 'GET',
        signal: abortController.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const details = await getSafeGoogleErrorDetailsFromResponse(response)

      throw new CalendarReadError({
        category: getCalendarApiErrorCategory(details),
        status: details.status,
        reason: details.reason,
      })
    }

    const data = (await response.json()) as GoogleCalendarEventsResponse

    return (data.items ?? [])
      .map((event) => normalizeGoogleCalendarEvent(event))
      .filter((event): event is CalendarEvent => event !== null)
  } catch (error) {
    if (error instanceof CalendarReadError) {
      throw error
    }

    if (isAbortError(error)) {
      throw new CalendarReadError({ category: 'google_calendar_api_error' })
    }

    throw new CalendarReadError({ category: 'google_unknown_error' })
  } finally {
    clearTimeout(timeout)
  }
}

export async function createGoogleCalendarEvent(params: CalendarCreateEventInput): Promise<void> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID

  if (!calendarId) {
    throw new CalendarReadError({ category: 'missing_env' })
  }

  const accessToken = await getGoogleCalendarAccessToken()
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 1800)
  const start =
    params.allDayDate && params.allDayEndDate
      ? { date: params.allDayDate }
      : {
          dateTime: params.start,
          timeZone: params.timezone,
        }
  const end =
    params.allDayDate && params.allDayEndDate
      ? { date: params.allDayEndDate }
      : {
          dateTime: params.end,
          timeZone: params.timezone,
        }

  try {
    const response = await fetch(`${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.title,
        description: params.description ?? undefined,
        colorId: params.colorId,
        start,
        end,
      }),
    })

    if (!response.ok) {
      const details = await getSafeGoogleErrorDetailsFromResponse(response)

      throw new CalendarReadError({
        category: getCalendarCreateErrorCategory(details),
        status: details.status,
        reason: details.reason,
      })
    }
  } catch (error) {
    if (error instanceof CalendarReadError) {
      throw error
    }

    if (isAbortError(error)) {
      throw new CalendarReadError({ category: 'google_calendar_api_error' })
    }

    throw new CalendarReadError({ category: 'google_unknown_error' })
  } finally {
    clearTimeout(timeout)
  }
}
