export type TelegramSlashCommand =
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

export function getTelegramStartPayload(text: string | undefined): string | null {
  if (!text) {
    return null
  }

  const [command, ...payloadParts] = text.trim().split(/\s+/)
  const normalizedCommand = command?.toLowerCase().split('@')[0]

  if (normalizedCommand !== '/start' || payloadParts.length === 0) {
    return null
  }

  return payloadParts.join('_').trim() || null
}

export function normalizeTelegramCommand(text: string): TelegramSlashCommand | null {
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
