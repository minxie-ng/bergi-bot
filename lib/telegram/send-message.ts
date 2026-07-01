export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>
}

type SendTelegramMessageOptions = {
  replyMarkup?: TelegramInlineKeyboardMarkup
  missingBotToken?: 'throw' | 'return'
  failedResponse?: 'throw' | 'log'
  failureLogEvent?: string
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkupOrOptions: TelegramInlineKeyboardMarkup | SendTelegramMessageOptions = {}
): Promise<void> {
  const options: SendTelegramMessageOptions = Array.isArray(
    (replyMarkupOrOptions as TelegramInlineKeyboardMarkup).inline_keyboard
  )
    ? { replyMarkup: replyMarkupOrOptions as TelegramInlineKeyboardMarkup }
    : (replyMarkupOrOptions as SendTelegramMessageOptions)
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    if (options.missingBotToken === 'return') {
      return
    }

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
      reply_markup: options.replyMarkup,
    }),
  })

  if (!response.ok) {
    if (options.failedResponse === 'log') {
      console.error(options.failureLogEvent ?? 'telegram_send_message_failed', { status: response.status })
      return
    }

    throw new Error(`Telegram sendMessage request failed: ${response.status}`)
  }
}

export async function answerTelegramCallbackQuery(callbackQueryId: string): Promise<void> {
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
