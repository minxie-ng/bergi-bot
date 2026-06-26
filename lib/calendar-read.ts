import { createSign } from 'node:crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export type CalendarQueryPeriod = 'today' | 'tomorrow' | 'evening' | 'week' | 'next'

export type CalendarQueryIntent = {
  period: CalendarQueryPeriod
}

export type CalendarEvent = {
  title: string
  start: string
  end: string | null
  isAllDay: boolean
}

export type CalendarReadErrorCategory =
  | 'missing_env'
  | 'google_unauthorized'
  | 'google_forbidden_or_not_shared'
  | 'google_calendar_not_found'
  | 'google_timeout'
  | 'google_unknown_error'

export class CalendarReadError extends Error {
  category: CalendarReadErrorCategory
  status?: number

  constructor(params: { category: CalendarReadErrorCategory; status?: number }) {
    super(params.category)
    this.name = 'CalendarReadError'
    this.category = params.category
    this.status = params.status
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

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null

function normalizeCalendarText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectCalendarQueryIntent(text: string): CalendarQueryIntent | null {
  const normalized = normalizeCalendarText(text)

  if (/\bnext\s+(calendar\s+)?event\b/.test(normalized) || /\bwhat'?s\s+next\s+on\s+my\s+calendar\b/.test(normalized)) {
    return { period: 'next' }
  }

  if (/\bsummari[sz]e\s+my\s+week\b/.test(normalized) || /\bwhat\s+do\s+i\s+have\s+this\s+week\b/.test(normalized)) {
    return { period: 'week' }
  }

  if (/\b(this\s+)?evening\b/.test(normalized) && /\b(anything|schedule|calendar|have|event|do i have)\b/.test(normalized)) {
    return { period: 'evening' }
  }

  if (/\btomorrow\b/.test(normalized) && /\b(what\s+do\s+i\s+have|schedule|calendar|anything|events?)\b/.test(normalized)) {
    return { period: 'tomorrow' }
  }

  if (
    /\btoday\b/.test(normalized) &&
    /\b(what\s+do\s+i\s+have|what'?s\s+my\s+schedule|schedule|calendar|anything|events?)\b/.test(normalized)
  ) {
    return { period: 'today' }
  }

  if (/\b(schedule|calendar)\b/.test(normalized) && /\b(today|tomorrow|this week|evening)\b/.test(normalized)) {
    if (/\btomorrow\b/.test(normalized)) {
      return { period: 'tomorrow' }
    }

    if (/\bthis\s+week\b/.test(normalized)) {
      return { period: 'week' }
    }

    if (/\bevening\b/.test(normalized)) {
      return { period: 'evening' }
    }

    return { period: 'today' }
  }

  return null
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function getCalendarReadErrorCategory(status: number): CalendarReadErrorCategory {
  if (status === 401) {
    return 'google_unauthorized'
  }

  if (status === 403) {
    return 'google_forbidden_or_not_shared'
  }

  if (status === 404) {
    return 'google_calendar_not_found'
  }

  return 'google_unknown_error'
}

async function getGoogleCalendarAccessToken(): Promise<string> {
  const serviceAccountEmail = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY

  if (!serviceAccountEmail || !privateKey) {
    throw new CalendarReadError({ category: 'missing_env' })
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
      scope: GOOGLE_CALENDAR_READONLY_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: expiresAt,
      iat: issuedAt,
    })
  )
  const unsignedJwt = `${header}.${claim}`
  const signer = createSign('RSA-SHA256')

  signer.update(unsignedJwt)
  signer.end()

  const signature = base64UrlEncode(signer.sign(normalizePrivateKey(privateKey)))
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
      throw new CalendarReadError({ category: getCalendarReadErrorCategory(response.status), status: response.status })
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
      throw new CalendarReadError({ category: 'google_timeout' })
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
      throw new CalendarReadError({ category: getCalendarReadErrorCategory(response.status), status: response.status })
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
      throw new CalendarReadError({ category: 'google_timeout' })
    }

    throw new CalendarReadError({ category: 'google_unknown_error' })
  } finally {
    clearTimeout(timeout)
  }
}
