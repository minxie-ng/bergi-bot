import type { TelegramInlineKeyboardMarkup } from '@/lib/telegram/send-message'

export function getHelpReply(): string {
  return `Not sure what to try? Here are a few things Bergi can help with:

• Send me a normal message or voice note
• Send me a photo and ask something about it
• ‘remind me to drink water in 30 minutes’
• ‘log $5 lunch’
• ‘what did I spend today?’
• ‘what’s on my calendar tomorrow?’ if Calendar is connected
• ‘schedule gym tomorrow 7pm’ if Calendar is connected
• ‘practise German with me’

Useful controls:
• /connect_calendar — connect Google Calendar
• /calendar_status — check Calendar connection
• /stop_checkins — stop proactive check-ins
• /privacy — see what Bergi stores`
}

export function getAlphaStartReply(): string {
  return `Hey, I’m Bergi — Min Xie’s private AI companion project, currently in alpha.

For this short private alpha, I can help with:

• chat naturally with you
• remember useful life notes
• understand voice messages
• understand photos you send
• practise German casually with you
• set reminders
• check in proactively, if you enable it
• log and query simple finance records
• help with Google Calendar planning, if you connect Calendar

To work properly, I may store things like your messages, reminders, finance logs, calendar connection status, and useful memory notes.

Please don’t send passwords, private keys, or highly sensitive information.

Ready to try Bergi?`
}

export function getAlphaPrivacyReply(): string {
  return `Bergi stores only what it needs to work during this private alpha: messages, reminders, finance logs, check-in settings, calendar connection status, and useful memory notes.

Please don’t send passwords, private keys, or highly sensitive information.

Calendar requires connecting Google Calendar later.`
}

export function getAlphaAskNameReply(): string {
  return 'What should I call you?'
}

export function getAlphaProactiveChoiceReply(): string {
  return `Do you want Bergi to proactively check in with you during this test?

This is one of Bergi’s core features — it lets Bergi message first instead of only replying when you start the chat.`
}

export function getAlphaCalendarChoiceReply(): string {
  return `Want to connect Google Calendar?

This lets Bergi help you check your schedule, find free time, and create calendar events after confirmation.`
}

export function getAlphaOnboardingDoneReply(): string {
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

export function getAlphaCalendarUnavailableReply(): string {
  return 'Please connect Google Calendar first.'
}

export function getRuntimeAddress(params: { isOwner: boolean; preferredName?: string | null }): string | null {
  if (params.isOwner) {
    return 'minxie'
  }

  const preferredName = params.preferredName?.trim()
  return preferredName ? preferredName : null
}

export function getVoiceTooLongReply(params: { isOwner: boolean; preferredName?: string | null }): string {
  const address = getRuntimeAddress(params)
  return address
    ? `wah ${address} this voice note too long sia 😭 keep it under 40 seconds first`
    : 'wah this voice note too long sia 😭 keep it under 40 seconds first'
}

export function getGenericWebhookErrorReply(params: { isOwner: boolean; preferredName?: string | null }): string {
  const address = getRuntimeAddress(params)
  return address
    ? `eh ${address} I glitch a bit just now 😵‍💫 try again later can?`
    : 'I glitched a bit just now 😵‍💫 try again later can?'
}

export function getAlphaCalendarNotConfiguredReply(): string {
  return 'Google Calendar connection is not configured yet. I can still help with reminders and planning in chat.'
}

export function getGoogleCalendarConnectReplyMarkup(connectUrl: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Connect Google Calendar', url: connectUrl }]],
  }
}

export function getGoogleCalendarConnectReply(connectUrl: string | null): {
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

export function getFeatureUnavailableReply(feature: string): string {
  return `${feature} isn’t available in this alpha yet.`
}

export function getAlphaStartReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Agree and start', callback_data: 'alpha_onboarding_agree' }],
      [{ text: 'Privacy details', callback_data: 'alpha_onboarding_privacy' }],
    ],
  }
}

export function getAlphaProactiveReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Light check-ins — recommended', callback_data: 'alpha_onboarding_proactive_light' }],
      [{ text: 'No, only reply when I message', callback_data: 'alpha_onboarding_proactive_none' }],
    ],
  }
}

export function getAlphaCalendarReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Connect Google Calendar — recommended', callback_data: 'alpha_onboarding_calendar_connect' }],
      [{ text: 'Skip for now', callback_data: 'alpha_onboarding_calendar_skip' }],
    ],
  }
}
