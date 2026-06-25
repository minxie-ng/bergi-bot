export type FinanceWebhookResponse = {
  ok: boolean
  message: string
  expense?: string
  amount?: number
  category?: string
  date?: string
}

type CallFinanceWebhookParams = {
  text: string
  userId: string
  telegramChatId: number
  timezone?: string
}

const FINANCE_KEYWORDS = [
  'spent',
  'spend',
  'paid',
  'pay',
  'bought',
  'buy',
  'renewal',
  'subscription',
  'subscribe',
  'grab',
  'mrt',
  'savings',
  'saving',
  'save',
  'lt',
  'deposit',
  'transfer',
  'top up',
  'topup',
]

function normalizeFinanceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasAmount(text: string): boolean {
  return /(?:\b(?:sgd|s\$|\$)\s*)?\b\d+(?:[.,]\d{1,2})?\b/.test(text)
}

function hasFinanceKeyword(text: string): boolean {
  return FINANCE_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))
}

function hasAmountItemPattern(text: string): boolean {
  return /^(?:(?:today|yesterday|tonight|this morning|this afternoon|this evening)\s+)?(?:sgd|s\$|\$)?\s*\d+(?:[.,]\d{1,2})?\s+[a-z][a-z0-9\s-]{2,}$/i.test(
    text
  )
}

export function isStrongFinanceCandidate(text: string): boolean {
  const normalized = normalizeFinanceText(text)

  return hasAmount(normalized) && hasFinanceKeyword(normalized)
}

export function detectFinanceCandidate(text: string): boolean {
  const normalized = normalizeFinanceText(text)

  if (!hasAmount(normalized)) {
    return false
  }

  return hasFinanceKeyword(normalized) || hasAmountItemPattern(normalized)
}

export async function callFinanceWebhook(params: CallFinanceWebhookParams): Promise<FinanceWebhookResponse> {
  const webhookUrl = process.env.N8N_FINANCE_WEBHOOK_URL

  if (!webhookUrl) {
    throw new Error('Missing N8N_FINANCE_WEBHOOK_URL')
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: params.text,
      user_id: params.userId,
      telegram_chat_id: String(params.telegramChatId),
      timezone: params.timezone ?? 'Asia/Singapore',
      source: 'bergi_core',
    }),
  })

  if (!response.ok) {
    throw new Error(`Finance webhook request failed: ${response.status}`)
  }

  const data = (await response.json()) as Partial<FinanceWebhookResponse>

  return {
    ok: data.ok === true,
    message:
      typeof data.message === 'string' && data.message.trim()
        ? data.message
        : data.ok === true
          ? 'Logged.'
          : "I couldn't log that.",
    expense: typeof data.expense === 'string' ? data.expense : undefined,
    amount: typeof data.amount === 'number' ? data.amount : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
    date: typeof data.date === 'string' ? data.date : undefined,
  }
}
