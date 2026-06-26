export const FINANCE_CATEGORIES = [
  'Home',
  'Food',
  'Groceries',
  'Drinks',
  'Entertainment',
  'Transport',
  'Subscription',
  'Travel',
  'Clothes',
  'Sport',
  'LT Savings',
  'Commitment',
  'Others',
  'Eight',
] as const

export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number]

export type ParsedExpenseLog = {
  is_expense: boolean
  date: string
  expense: string
  amount: number
  category: FinanceCategory
  comment: string | null
}

type CallFinanceParserParams = {
  text: string
  localDate: string
  callLLM: (params: {
    systemPrompt: string
    chatMessages: Array<{ role: 'user'; content: string }>
    maxCompletionTokens?: number
  }) => Promise<string>
}

type CreateNotionExpenseLogInput = {
  expense: string
  date: string
  amount: number
  category: FinanceCategory
  comment?: string | null
}

export type NotionExpenseLogErrorCategory =
  | 'missing_env'
  | 'notion_unauthorized'
  | 'notion_forbidden_or_not_shared'
  | 'notion_database_not_found'
  | 'notion_validation_error'
  | 'notion_timeout'
  | 'notion_unknown_error'

export class NotionExpenseLogError extends Error {
  category: NotionExpenseLogErrorCategory
  status?: number
  notionCode?: string

  constructor(params: { category: NotionExpenseLogErrorCategory; status?: number; notionCode?: string }) {
    super(params.category)
    this.name = 'NotionExpenseLogError'
    this.category = params.category
    this.status = params.status
    this.notionCode = params.notionCode
  }
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

export function detectFinanceCandidate(text: string): boolean {
  const normalized = normalizeFinanceText(text)

  if (!hasAmount(normalized)) {
    return false
  }

  return hasFinanceKeyword(normalized) || hasAmountItemPattern(normalized)
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

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  return !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
}

function normalizeCategory(value: unknown): FinanceCategory {
  if (typeof value !== 'string') {
    return 'Others'
  }

  return FINANCE_CATEGORIES.includes(value as FinanceCategory) ? (value as FinanceCategory) : 'Others'
}

function parseExpenseAmount(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return Number(value.replace(/,/g, '').trim())
  }

  return Number.NaN
}

function parseExpenseJson(raw: string): Partial<ParsedExpenseLog> {
  return JSON.parse(cleanJsonResponse(raw)) as Partial<ParsedExpenseLog>
}

export function validateParsedExpenseLog(raw: Partial<ParsedExpenseLog>, fallbackDate: string): ParsedExpenseLog {
  const amount = parseExpenseAmount(raw.amount)
  const expense = typeof raw.expense === 'string' ? raw.expense.trim() : ''
  const date = typeof raw.date === 'string' && isValidDateString(raw.date) ? raw.date : fallbackDate

  return {
    is_expense: raw.is_expense === true,
    date,
    expense,
    amount,
    category: normalizeCategory(raw.category),
    comment: typeof raw.comment === 'string' && raw.comment.trim() ? raw.comment.trim() : null,
  }
}

export function isValidExpenseLog(expenseLog: ParsedExpenseLog): boolean {
  return (
    expenseLog.is_expense === true &&
    expenseLog.expense.length > 0 &&
    Number.isFinite(expenseLog.amount) &&
    expenseLog.amount > 0 &&
    isValidDateString(expenseLog.date)
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function getNotionErrorCategory(status: number, notionCode?: string): NotionExpenseLogErrorCategory {
  if (status === 401) {
    return 'notion_unauthorized'
  }

  if (status === 403) {
    return 'notion_forbidden_or_not_shared'
  }

  if (status === 404 || notionCode === 'object_not_found') {
    return 'notion_database_not_found'
  }

  if (status === 400 || notionCode === 'validation_error') {
    return 'notion_validation_error'
  }

  return 'notion_unknown_error'
}

async function parseNotionErrorCode(response: Response): Promise<string | undefined> {
  try {
    const data = (await response.json()) as { code?: unknown }

    return typeof data.code === 'string' ? data.code : undefined
  } catch {
    return undefined
  }
}

export async function parseExpenseLogWithLLM(params: CallFinanceParserParams): Promise<ParsedExpenseLog> {
  const allowedCategories = FINANCE_CATEGORIES.join(', ')
  const raw = await params.callLLM({
    systemPrompt: `You parse short Telegram finance logs for Bergi.

Return only valid JSON with exactly these keys:
{
  "is_expense": true,
  "date": "YYYY-MM-DD",
  "expense": "short cleaned title",
  "amount": 0,
  "category": "one allowed category",
  "comment": "optional original message or note"
}

Rules:
- Use current local date ${params.localDate} for "today".
- Resolve "yesterday" relative to current local date ${params.localDate}.
- Correct obvious typos in common expenses, for example "chic rice" should become "chicken rice".
- Infer category from meaning, not only keywords.
- Allowed categories: ${allowedCategories}.
- Use exactly one allowed category name.
- Use "Others" if unsure.
- Treat "savings with lt 50" and "put 100 into lt savings" as category "LT Savings".
- If the message is not a finance log, return is_expense false with amount 0, expense "", category "Others".
- If there is no valid amount, return is_expense false with amount 0.
- Do not add markdown or commentary.`,
    chatMessages: [
      {
        role: 'user',
        content: params.text,
      },
    ],
    maxCompletionTokens: 120,
  })

  return validateParsedExpenseLog(parseExpenseJson(raw), params.localDate)
}

export async function createNotionExpenseLog(input: CreateNotionExpenseLogInput): Promise<void> {
  const notionToken = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_EXPENSES_DATABASE_ID

  if (!notionToken || !databaseId) {
    throw new NotionExpenseLogError({ category: 'missing_env' })
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 1800)

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: {
          database_id: databaseId,
        },
        properties: {
          Expense: {
            title: [
              {
                text: {
                  content: input.expense,
                },
              },
            ],
          },
          Date: {
            date: {
              start: input.date,
            },
          },
          Amount: {
            number: input.amount,
          },
          Category: {
            select: {
              name: input.category,
            },
          },
          Comment: {
            rich_text: input.comment
              ? [
                  {
                    text: {
                      content: input.comment,
                    },
                  },
                ]
              : [],
          },
          Source: {
            select: {
              name: 'Bergi',
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const notionCode = await parseNotionErrorCode(response)

      throw new NotionExpenseLogError({
        category: getNotionErrorCategory(response.status, notionCode),
        status: response.status,
        notionCode,
      })
    }
  } catch (error) {
    if (error instanceof NotionExpenseLogError) {
      throw error
    }

    if (isAbortError(error)) {
      throw new NotionExpenseLogError({ category: 'notion_timeout' })
    }

    throw new NotionExpenseLogError({ category: 'notion_unknown_error' })
  } finally {
    clearTimeout(timeout)
  }
}

export function formatExpenseLoggedReply(expenseLog: ParsedExpenseLog): string {
  return `Logged: ${expenseLog.expense} — SGD ${expenseLog.amount.toFixed(2)} under ${expenseLog.category}.`
}
