export type CalendarEventColorCategory = 'class' | 'cca' | 'work' | 'admin' | 'personal'

type CalendarColorMapping = {
  category: CalendarEventColorCategory
  colorId: string
}

// Google Calendar uses colorId strings, not color names. These ids are initial
// guesses for Min's visual calendar and can be adjusted here if Google renders
// them differently for the connected calendar.
const CALENDAR_COLOR_IDS = {
  blue: '9',
  green: '10',
  red: '11',
  yellow: '5',
  purple: '3',
} as const

const CALENDAR_EVENT_COLOR_MAPPINGS: Record<CalendarEventColorCategory, CalendarColorMapping> = {
  class: { category: 'class', colorId: CALENDAR_COLOR_IDS.blue },
  cca: { category: 'cca', colorId: CALENDAR_COLOR_IDS.green },
  work: { category: 'work', colorId: CALENDAR_COLOR_IDS.red },
  admin: { category: 'admin', colorId: CALENDAR_COLOR_IDS.yellow },
  personal: { category: 'personal', colorId: CALENDAR_COLOR_IDS.purple },
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))
}

export function inferCalendarEventColor(title: string): { category: CalendarEventColorCategory; colorId?: string } {
  const normalized = title.toLowerCase().replace(/[’']/g, '')

  if (
    hasAnyKeyword(normalized, [
      'deadline',
      'submit',
      'submission',
      'interview',
      'appointment',
      'visa',
      'admin',
      'form',
      'application',
      'payment',
      'renew',
      'checkup',
    ]) ||
    /\bassignment\b.*\bdeadline\b/i.test(normalized)
  ) {
    return CALENDAR_EVENT_COLOR_MAPPINGS.admin
  }

  if (
    hasAnyKeyword(normalized, [
      'class',
      'lecture',
      'tutorial',
      'seminar',
      'assignment',
      'homework',
      'exam',
      'quiz',
      'study session',
      'is class',
    ])
  ) {
    return CALENDAR_EVENT_COLOR_MAPPINGS.class
  }

  if (
    hasAnyKeyword(normalized, [
      'smux',
      'trekking',
      'hike',
      'product club',
      'cca',
      'club event',
      'product event',
      'recce',
    ]) ||
    /\b(?:club|cca)\b.*\bmeeting\b/i.test(normalized) ||
    /\bmeeting\b.*\b(?:club|cca)\b/i.test(normalized)
  ) {
    return CALENDAR_EVENT_COLOR_MAPPINGS.cca
  }

  if (
    hasAnyKeyword(normalized, [
      'work',
      'internship',
      'shift',
      'tigersec',
      'review',
      'standup',
      'client',
      'supervisor',
      'boss',
      'smua',
      'meeting',
    ])
  ) {
    return CALENDAR_EVENT_COLOR_MAPPINGS.work
  }

  return CALENDAR_EVENT_COLOR_MAPPINGS.personal
}
