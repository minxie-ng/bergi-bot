import { normalizeTelegramCommand, type TelegramSlashCommand } from '@/lib/telegram/commands'

export type ProactiveCheckinControlAction = 'pause' | 'resume' | 'status'

export function isLikelyReminderRequest(text: string): boolean {
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

export function isLikelyFutureEventMention(text: string): boolean {
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

export function isLikelyReminderPreferenceReply(text: string): boolean {
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

export function isLikelyNewReminderCommand(text: string): boolean {
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

export function isLikelyListRemindersRequest(text: string): boolean {
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

export function isLikelyCancelReminderRequest(text: string): boolean {
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

export function isLikelyRescheduleReminderRequest(text: string): boolean {
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

export function getProactiveCheckinControlActionFromCommand(
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

export function getProactiveCheckinControlAction(text: string): ProactiveCheckinControlAction | null {
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

export function isThoughtCaptureCommand(text: string): boolean {
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

export function isNaturalMemorySummaryRequest(text: string): boolean {
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

export function isMeaningfulThoughtSource(content: string): boolean {
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
