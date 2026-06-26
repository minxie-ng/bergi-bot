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

export type FinanceIntent = 'expense_log' | 'budget_note' | 'transfer_or_debt' | 'income' | 'query' | 'ambiguous'

export type FinanceIntentClassification = {
  intent: FinanceIntent
  reason?: FinanceBlockReason
  reply?: string
}

export type FinanceBlockReason =
  | 'budget_note'
  | 'transfer_or_debt'
  | 'income'
  | 'query'
  | 'foreign_currency'
  | 'multiple_expenses'
  | 'suspicious_high_amount'
  | 'invalid_expense'

export type FinanceValidationResult =
  | {
      ok: true
    }
  | {
      ok: false
      reason: FinanceBlockReason
      reply: string
      logEvent: 'finance_validation_failed' | 'finance_ambiguous'
    }

export type FinanceQueryPeriod = 'today' | 'week' | 'month' | 'year' | 'recent'

export type FinanceQueryIntent = {
  period: FinanceQueryPeriod
  category?: FinanceCategory
  kind: 'total' | 'list' | 'summary'
}

export type FinanceExpenseQueryEntry = {
  title: string
  amount: number
  date: string | null
  category: string | null
}

export type FinanceExpenseQueryResult = {
  entries: FinanceExpenseQueryEntry[]
  total: number
  categoryTotals: Array<{ category: string; total: number; count: number }>
}

export type PendingSuspiciousExpenseConfirmation = {
  expense: string
  originalAmount: number
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

type QueryNotionExpensesInput = {
  startIso?: string
  endIso?: string
  category?: FinanceCategory
  recentLimit?: number
  maxPages?: number
}

type NotionOption = {
  name?: unknown
}

type NotionDatabaseProperty = {
  type?: unknown
  select?: {
    options?: NotionOption[]
  }
  status?: {
    options?: NotionOption[]
  }
}

type NotionDatabaseSchema = {
  properties: Record<string, NotionDatabaseProperty>
}

type NotionExpensePropertySelection = {
  title: string
  amount: string
  date?: string
  category?: {
    name: string
    type: 'select' | 'status'
  }
  comment?: string
  source?: {
    name: string
    type: 'select' | 'status'
  }
}

type NotionExpenseQueryPropertySelection = {
  title: string
  amount: string
  date: string
  category?: {
    name: string
    type: 'select' | 'status'
  }
}

export type NotionExpenseLogErrorCategory =
  | 'missing_env'
  | 'notion_unauthorized'
  | 'notion_forbidden_or_not_shared'
  | 'notion_database_not_found'
  | 'notion_validation_error'
  | 'notion_schema_mismatch'
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
  'budget',
  'owe',
  'owed',
  'lend',
  'lent',
  'borrow',
  'borrowed',
  'transfer',
  'transferred',
  'received',
  'income',
  'salary',
  'reimburse',
  'claim',
  'lt',
  'deposit',
  'top up',
  'topup',
]

const BUDGET_KEYWORDS = ['budget']
const INCOME_KEYWORDS = ['received', 'income', 'salary', 'paid me back']
const TRANSFER_OR_DEBT_KEYWORDS = [
  'owe',
  'owed',
  'lend',
  'lent',
  'borrow',
  'borrowed',
  'transfer',
  'transferred',
  'savings',
  'saving',
  'save',
  'deposit',
  'top up',
  'topup',
  'reimburse',
  'claim',
]
const FOREIGN_CURRENCY_KEYWORDS = [
  'rmb',
  'cny',
  'yuan',
  'usd',
  'eur',
  'gbp',
  'jpy',
  'aud',
  'myr',
  'thb',
  'idr',
  'krw',
  'hkd',
  'twd',
  'php',
  'vnd',
]
const FOREIGN_CURRENCY_SYMBOLS = ['€', '£', '¥']
const SUSPICIOUS_HIGH_AMOUNT = 10000
const SUSPICIOUS_EVERYDAY_AMOUNT = 100
const EVERYDAY_EXPENSE_KEYWORDS = [
  'lunch',
  'dinner',
  'breakfast',
  'chicken rice',
  'coffee',
  'milk tea',
  'kopi',
  'grab',
  'mrt',
  'tea',
  'food',
  'drink',
]
const EXPENSE_VERB_PATTERN =
  /\b(spent|spend|paid|pay|bought|buy|renewal|subscription|subscribe|treat|treated)\b/gi
const FINANCE_QUERY_KEYWORDS = [
  'how much did i spend',
  'what did i spend',
  'show my expenses',
  'summarise',
  'summarize',
  'spending',
  'recent expenses',
  'expenses today',
  'expenses this',
]
const CATEGORY_QUERY_KEYWORDS: Array<{ category: FinanceCategory; keywords: string[] }> = [
  { category: 'Food', keywords: ['food', 'lunch', 'dinner', 'breakfast', 'meal', 'coffee', 'kopi', 'milk tea'] },
  { category: 'Transport', keywords: ['transport', 'grab', 'mrt', 'bus', 'taxi', 'ride'] },
  { category: 'Groceries', keywords: ['groceries', 'grocery'] },
  { category: 'Drinks', keywords: ['drinks', 'drink', 'coffee', 'kopi', 'milk tea'] },
  { category: 'Subscription', keywords: ['subscription', 'subscriptions', 'spotify', 'netflix'] },
  { category: 'Clothes', keywords: ['clothes', 'clothing', 'uniqlo', 'socks'] },
  { category: 'Travel', keywords: ['travel', 'flight', 'hotel'] },
  { category: 'Entertainment', keywords: ['entertainment', 'movie', 'movies'] },
  { category: 'Sport', keywords: ['sport', 'gym'] },
  { category: 'Home', keywords: ['home'] },
]
const SPOKEN_NUMBER_VALUES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}

const NOTION_VERSION = '2022-06-28'
let notionDatabaseSchemaCache: NotionDatabaseSchema | null = null

function parseSpokenNumber(value: string): number | null {
  const parts = value.toLowerCase().trim().split(/\s+/)

  if (parts.length === 1) {
    return SPOKEN_NUMBER_VALUES[parts[0]] ?? null
  }

  if (parts.length === 2) {
    const tens = SPOKEN_NUMBER_VALUES[parts[0]]
    const ones = SPOKEN_NUMBER_VALUES[parts[1]]

    if (tens !== undefined && tens >= 20 && ones !== undefined && ones > 0 && ones < 10) {
      return tens + ones
    }
  }

  return null
}

function normalizeSpokenCurrencyAmounts(text: string): string {
  const numberWords = Object.keys(SPOKEN_NUMBER_VALUES).join('|')
  const spokenAmountPattern = new RegExp(
    `\\b((?:${numberWords})(?:\\s+(?:${numberWords}))?)\\s+(dollars?|bucks?)\\b`,
    'gi'
  )

  return text.replace(spokenAmountPattern, (match, amountWords: string, currencyWord: string) => {
    const amount = parseSpokenNumber(amountWords)

    if (amount === null) {
      return match
    }

    return `${amount} ${currencyWord}`
  })
}

function normalizeFinanceInputText(text: string): string {
  return normalizeSpokenCurrencyAmounts(text)
    .replace(/(\d)(?=(?:for|on)\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFinanceText(text: string): string {
  return normalizeFinanceInputText(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTimeExpressions(text: string): string {
  return text
    .replace(/\b(?:at\s*)?(?:[01]?\d|2[0-3])(?:(?::|\.)[0-5]\d)?\s*(?:am|pm)\b/gi, ' ')
    .replace(/\b(?:[01]?\d|2[0-3])(?::|\.)[0-5]\d\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isClearCalendarSchedulingRequest(text: string): boolean {
  const normalized = normalizeFinanceText(text)
  const hasCalendarVerb =
    /\b(add|schedule|block)\b/.test(normalized) ||
    /\bcreate\s+(?:calendar\s+)?event\b/.test(normalized) ||
    /\bput\b.*\bcalendar\b/.test(normalized)
  const hasDateOrCalendarWord =
    /\b(calendar|event|today|tdy|tomorrow|tmr|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/.test(
      normalized
    )
  const hasTime = /\b(?:at\s*)?(?:[01]?\d|2[0-3])(?:(?::|\.)[0-5]\d)?\s*(?:am|pm)\b/.test(normalized)

  return hasCalendarVerb && (hasDateOrCalendarWord || hasTime)
}

function hasAmount(text: string): boolean {
  return /(?:\b(?:sgd|s\$|\$)\s*)?\b\d+(?:[.,]\d{1,2})?\b/.test(stripTimeExpressions(text))
}

function hasFinanceKeyword(text: string): boolean {
  return FINANCE_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))
}

function hasAmountItemPattern(text: string): boolean {
  const withoutTimes = stripTimeExpressions(text)

  return /^(?:(?:today|yesterday|tonight|this morning|this afternoon|this evening)\s+)?(?:sgd|s\$|\$)?\s*\d+(?:[.,]\d{1,2})?\s+[a-z][a-z0-9\s-]{2,}$/i.test(
    withoutTimes
  )
}

function hasItemAmountPattern(text: string): boolean {
  return /^[a-z][a-z0-9\s-]{2,}\s+(?:sgd|s\$|\$)?\s*\d+(?:[.,]\d{1,2})?$/i.test(stripTimeExpressions(text))
}

function extractAmountValues(text: string): number[] {
  const normalized = stripTimeExpressions(normalizeFinanceInputText(text))
  const matches = normalized.matchAll(
    /(?:\b(?:sgd|s\$|\$|rmb|cny|yuan|usd|eur|gbp|jpy|aud|myr)\s*)?\b\d+(?:[.,]\d{1,2})?\b/gi
  )

  return Array.from(matches)
    .map((match) => Number(match[0].replace(/[^\d.,]/g, '').replace(/,/g, '')))
    .filter((amount) => Number.isFinite(amount))
}

function hasForeignCurrency(text: string): boolean {
  return (
    hasAnyKeyword(text, FOREIGN_CURRENCY_KEYWORDS) ||
    FOREIGN_CURRENCY_SYMBOLS.some((symbol) => text.includes(symbol))
  )
}

function hasMultipleExpensePattern(text: string): boolean {
  const amounts = extractAmountValues(text)

  if (amounts.length < 2) {
    return false
  }

  return /\b(and|plus|also|,\s*)\b/i.test(text) || /,\s*/.test(text)
}

function isFinanceQuery(text: string): boolean {
  return /^(what|how|why|when|where|can|could|should|do|does|did|is|are)\b/i.test(text)
}

function hasEverydayExpenseKeyword(text: string): boolean {
  return EVERYDAY_EXPENSE_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))
}

function detectFinanceQueryCategory(text: string): FinanceCategory | undefined {
  const categoryMatch = CATEGORY_QUERY_KEYWORDS.find(({ keywords }) => hasAnyKeyword(text, keywords))

  return categoryMatch?.category
}

function detectFinanceQueryPeriod(text: string): FinanceQueryPeriod | null {
  if (/\b(recent|latest)\b/.test(text)) {
    return 'recent'
  }

  if (/\btoday\b/.test(text)) {
    return 'today'
  }

  if (/\bthis\s+week\b/.test(text)) {
    return 'week'
  }

  if (/\bthis\s+month\b|\bmonth'?s\b/.test(text)) {
    return 'month'
  }

  if (/\bthis\s+year\b|\byear\b/.test(text)) {
    return 'year'
  }

  return null
}

function detectFinanceQueryKind(text: string): FinanceQueryIntent['kind'] {
  if (/\b(show|what|recent|latest)\b/.test(text)) {
    return 'list'
  }

  if (/\b(summarise|summarize|summary|spending)\b/.test(text)) {
    return 'summary'
  }

  return 'total'
}

function getPrimaryExpenseAmount(text: string): number | null {
  const amounts = extractAmountValues(text)

  if (amounts.length !== 1) {
    return null
  }

  return amounts[0]
}

function extractFallbackExpenseTitle(text: string): string {
  return stripTimeExpressions(normalizeFinanceInputText(text))
    .replace(/(?:\b(?:sgd|s\$|\$)\s*)?\b\d+(?:[.,]\d{1,2})?\b/gi, ' ')
    .replace(/\b(dollars?|bucks?|sgd)\b/gi, ' ')
    .replace(/\b(i|i'm|im|me|my)\b/gi, ' ')
    .replace(/\b(today|yesterday|tonight|this morning|this afternoon|this evening)\b/gi, ' ')
    .replace(EXPENSE_VERB_PATTERN, ' ')
    .replace(/^\s*(on|for)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectFinanceCandidate(text: string): boolean {
  const normalized = normalizeFinanceText(text)

  if (isClearCalendarSchedulingRequest(normalized)) {
    return false
  }

  if (!hasAmount(normalized)) {
    return false
  }

  return (
    hasFinanceKeyword(normalized) ||
    hasAmountItemPattern(normalized) ||
    hasItemAmountPattern(normalized) ||
    hasEverydayExpenseKeyword(normalized)
  )
}

export function detectFinanceQueryIntent(text: string): FinanceQueryIntent | null {
  const normalized = normalizeFinanceText(text)
  const period = detectFinanceQueryPeriod(normalized)
  const hasQueryPhrase = FINANCE_QUERY_KEYWORDS.some((keyword) => normalized.includes(keyword))
  const asksSpendQuestion = /\b(how much|what|show|summari[sz]e)\b/.test(normalized) && /\b(spend|spent|expenses?|spending)\b/.test(normalized)

  if (!period || (!hasQueryPhrase && !asksSpendQuestion)) {
    return null
  }

  return {
    period,
    category: detectFinanceQueryCategory(normalized),
    kind: detectFinanceQueryKind(normalized),
  }
}

export function parseFinanceAmountCorrection(text: string): number | null {
  const normalized = normalizeFinanceText(text)
  const match = normalized.match(/^(?:sgd|s\$|\$)?\s*(\d+(?:[.,]\d{1,2})?)$/i)

  if (!match) {
    return null
  }

  const amount = Number(match[1].replace(',', '.'))

  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export function classifyFinanceIntent(text: string): FinanceIntentClassification {
  const normalized = normalizeFinanceText(text)

  if (hasAnyKeyword(normalized, BUDGET_KEYWORDS)) {
    return {
      intent: 'budget_note',
      reason: 'budget_note',
      reply: 'I’m not tracking budgets yet, but I can log actual expenses.',
    }
  }

  if (hasAnyKeyword(normalized, INCOME_KEYWORDS)) {
    return {
      intent: 'income',
      reason: 'income',
      reply: 'That looks like income, not an expense. I’m only logging expenses for now.',
    }
  }

  if (hasAnyKeyword(normalized, TRANSFER_OR_DEBT_KEYWORDS)) {
    return {
      intent: 'transfer_or_debt',
      reason: 'transfer_or_debt',
      reply: 'That sounds like money owed, moved, or saved — I’m only logging actual expenses for now.',
    }
  }

  if (hasForeignCurrency(normalized)) {
    return {
      intent: 'ambiguous',
      reason: 'foreign_currency',
      reply: 'I only support SGD expense logging for now, so I won’t log that automatically.',
    }
  }

  if (hasMultipleExpensePattern(normalized)) {
    return {
      intent: 'ambiguous',
      reason: 'multiple_expenses',
      reply: 'I found multiple expenses there — send them one by one for now and I’ll log each properly.',
    }
  }

  if (isFinanceQuery(normalized)) {
    return {
      intent: 'query',
      reason: 'query',
    }
  }

  return {
    intent: 'expense_log',
  }
}

export function parsePendingSuspiciousExpenseConfirmation(
  content: string
): PendingSuspiciousExpenseConfirmation | null {
  const match = content.match(/^(\d+(?:\.\d{1,2})?) on (.+?) sounds unusually high\b/i)

  if (!match) {
    return null
  }

  const originalAmount = Number(match[1])
  const expense = match[2].trim()

  if (!Number.isFinite(originalAmount) || originalAmount <= 0 || expense.length === 0) {
    return null
  }

  return {
    expense,
    originalAmount,
  }
}

export function formatFinanceCorrectionForParser(params: {
  correctionAmount: number
  pendingConfirmation: PendingSuspiciousExpenseConfirmation
}): string {
  return `${params.correctionAmount.toFixed(2)} on ${params.pendingConfirmation.expense}`
}

export function prepareFinanceTextForParsing(text: string): string {
  return normalizeFinanceInputText(text)
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

function applyDeterministicAmount(text: string, expenseLog: ParsedExpenseLog): ParsedExpenseLog {
  const amount = getPrimaryExpenseAmount(text)

  if (amount === null) {
    return expenseLog
  }

  return {
    ...expenseLog,
    amount,
  }
}

function applyDeterministicExpenseFallback(text: string, expenseLog: ParsedExpenseLog): ParsedExpenseLog {
  const amount = getPrimaryExpenseAmount(text)
  const fallbackExpense = extractFallbackExpenseTitle(text)

  if (amount === null || fallbackExpense.length === 0 || (expenseLog.is_expense && expenseLog.expense.length > 0)) {
    return expenseLog
  }

  return {
    ...expenseLog,
    is_expense: true,
    expense: fallbackExpense,
    amount,
    category: expenseLog.category,
  }
}

function getSuspiciousAmountCorrectionSuggestion(amount: number): string {
  if (Number.isInteger(amount) && amount >= 10000) {
    return (Math.floor(amount / 100) / 100).toFixed(2)
  }

  return (amount / 100).toFixed(2)
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

export function validateExpenseLogForNotion(text: string, expenseLog: ParsedExpenseLog): FinanceValidationResult {
  const normalized = normalizeFinanceText(text)

  if (!isValidExpenseLog(expenseLog)) {
    return {
      ok: false,
      reason: 'invalid_expense',
      reply: "I couldn't find a valid amount to log.",
      logEvent: 'finance_validation_failed',
    }
  }

  if (hasForeignCurrency(normalized)) {
    return {
      ok: false,
      reason: 'foreign_currency',
      reply: 'I only support SGD expense logging for now, so I won’t log that automatically.',
      logEvent: 'finance_ambiguous',
    }
  }

  if (hasMultipleExpensePattern(normalized)) {
    return {
      ok: false,
      reason: 'multiple_expenses',
      reply: 'I found multiple expenses there — send them one by one for now and I’ll log each properly.',
      logEvent: 'finance_ambiguous',
    }
  }

  if (
    expenseLog.amount >= SUSPICIOUS_HIGH_AMOUNT ||
    (expenseLog.amount >= SUSPICIOUS_EVERYDAY_AMOUNT && hasEverydayExpenseKeyword(normalized))
  ) {
    return {
      ok: false,
      reason: 'suspicious_high_amount',
      reply: `${expenseLog.amount.toFixed(0)} on ${expenseLog.expense} sounds unusually high — did you mean ${getSuspiciousAmountCorrectionSuggestion(expenseLog.amount)} or should I really log ${expenseLog.amount.toFixed(0)}?`,
      logEvent: 'finance_ambiguous',
    }
  }

  return {
    ok: true,
  }
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

function isNotionDatabaseSchema(value: unknown): value is NotionDatabaseSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    'properties' in value &&
    typeof (value as { properties?: unknown }).properties === 'object' &&
    (value as { properties?: unknown }).properties !== null
  )
}

function getPropertyType(schema: NotionDatabaseSchema, name: string): string | null {
  const type = schema.properties[name]?.type

  return typeof type === 'string' ? type : null
}

function findTitlePropertyName(schema: NotionDatabaseSchema): string | null {
  const titleProperty = Object.entries(schema.properties).find(([, property]) => property.type === 'title')

  return titleProperty?.[0] ?? null
}

function findNumberPropertyName(schema: NotionDatabaseSchema): string | null {
  if (getPropertyType(schema, 'Amount') === 'number') {
    return 'Amount'
  }

  const numberProperty = Object.entries(schema.properties).find(([, property]) => property.type === 'number')

  return numberProperty?.[0] ?? null
}

function getOptionNames(property: NotionDatabaseProperty | undefined): string[] {
  const options = property?.select?.options ?? property?.status?.options ?? []

  return options
    .map((option) => option.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
}

function hasOption(schema: NotionDatabaseSchema, propertyName: string, optionName: string): boolean {
  return getOptionNames(schema.properties[propertyName]).includes(optionName)
}

function getCompatibleSelectOrStatusProperty(
  schema: NotionDatabaseSchema,
  propertyName: string,
  optionName: string
): { name: string; type: 'select' | 'status' } | undefined {
  const type = getPropertyType(schema, propertyName)

  if ((type === 'select' || type === 'status') && hasOption(schema, propertyName, optionName)) {
    return {
      name: propertyName,
      type,
    }
  }

  return undefined
}

function getNotionDatabasePropertyMetadata(schema: NotionDatabaseSchema): Array<{ name: string; type: string }> {
  return Object.entries(schema.properties)
    .map(([name, property]) => ({
      name,
      type: typeof property.type === 'string' ? property.type : 'unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function getNotionExpensePropertySelection(schema: NotionDatabaseSchema, input: CreateNotionExpenseLogInput) {
  const title = findTitlePropertyName(schema)
  const amount = findNumberPropertyName(schema)

  if (!title || !amount) {
    throw new NotionExpenseLogError({ category: 'notion_schema_mismatch' })
  }

  const selection: NotionExpensePropertySelection = {
    title,
    amount,
  }

  if (getPropertyType(schema, 'Date') === 'date') {
    selection.date = 'Date'
  }

  if (getPropertyType(schema, 'Comment') === 'rich_text') {
    selection.comment = 'Comment'
  }

  const category = getCompatibleSelectOrStatusProperty(schema, 'Category', input.category)

  if (category) {
    selection.category = category
  }

  const source = getCompatibleSelectOrStatusProperty(schema, 'Source', 'Bergi')

  if (source) {
    selection.source = source
  }

  return selection
}

function getNotionExpenseQueryPropertySelection(schema: NotionDatabaseSchema): NotionExpenseQueryPropertySelection {
  const title = findTitlePropertyName(schema)
  const amount = findNumberPropertyName(schema)
  const date = getPropertyType(schema, 'Date') === 'date' ? 'Date' : undefined

  if (!title || !amount || !date) {
    throw new NotionExpenseLogError({ category: 'notion_schema_mismatch' })
  }

  const categoryType = getPropertyType(schema, 'Category')

  return {
    title,
    amount,
    date,
    category:
      categoryType === 'select' || categoryType === 'status'
        ? {
            name: 'Category',
            type: categoryType,
          }
        : undefined,
  }
}

function logNotionDatabaseSchemaLoaded(schema: NotionDatabaseSchema): void {
  console.log('notion_database_schema_loaded', {
    properties: getNotionDatabasePropertyMetadata(schema),
  })
}

function logNotionExpensePropertiesSelected(selection: NotionExpensePropertySelection): void {
  console.log('notion_expense_properties_selected', {
    properties: [
      { role: 'title', name: selection.title },
      { role: 'amount', name: selection.amount },
      selection.date ? { role: 'date', name: selection.date } : null,
      selection.comment ? { role: 'comment', name: selection.comment } : null,
      selection.category ? { role: 'category', name: selection.category.name, type: selection.category.type } : null,
      selection.source ? { role: 'source', name: selection.source.name, type: selection.source.type } : null,
    ].filter(Boolean),
  })
}

function getNotionHeaders(notionToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${notionToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  }
}

function normalizeNotionDatabaseId(value: string): string {
  const trimmed = value.trim()
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

  if (uuidMatch) {
    return uuidMatch[0]
  }

  const compactIdMatch = trimmed.match(/[0-9a-f]{32}/i)

  if (compactIdMatch) {
    const compactId = compactIdMatch[0]

    return `${compactId.slice(0, 8)}-${compactId.slice(8, 12)}-${compactId.slice(12, 16)}-${compactId.slice(
      16,
      20
    )}-${compactId.slice(20)}`
  }

  return trimmed
}

async function retrieveNotionDatabaseSchema(params: {
  notionToken: string
  databaseId: string
}): Promise<NotionDatabaseSchema> {
  if (notionDatabaseSchemaCache) {
    logNotionDatabaseSchemaLoaded(notionDatabaseSchemaCache)
    return notionDatabaseSchemaCache
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 1200)

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${params.databaseId}`, {
      method: 'GET',
      signal: abortController.signal,
      headers: getNotionHeaders(params.notionToken),
    })

    if (!response.ok) {
      const notionCode = await parseNotionErrorCode(response)
      const category =
        response.status === 400 && notionCode === 'validation_error'
          ? 'notion_schema_mismatch'
          : getNotionErrorCategory(response.status, notionCode)

      throw new NotionExpenseLogError({
        category,
        status: response.status,
        notionCode,
      })
    }

    const data = (await response.json()) as unknown

    if (!isNotionDatabaseSchema(data)) {
      throw new NotionExpenseLogError({ category: 'notion_schema_mismatch' })
    }

    notionDatabaseSchemaCache = data
    logNotionDatabaseSchemaLoaded(data)

    return data
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

function buildNotionExpenseProperties(
  selection: NotionExpensePropertySelection,
  input: CreateNotionExpenseLogInput
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [selection.title]: {
      title: [
        {
          text: {
            content: input.expense,
          },
        },
      ],
    },
    [selection.amount]: {
      number: input.amount,
    },
  }

  if (selection.date) {
    properties[selection.date] = {
      date: {
        start: input.date,
      },
    }
  }

  if (selection.category) {
    properties[selection.category.name] = {
      [selection.category.type]: {
        name: input.category,
      },
    }
  }

  if (selection.comment) {
    properties[selection.comment] = {
      rich_text: input.comment
        ? [
            {
              text: {
                content: input.comment,
              },
            },
          ]
        : [],
    }
  }

  if (selection.source) {
    properties[selection.source.name] = {
      [selection.source.type]: {
        name: 'Bergi',
      },
    }
  }

  return properties
}

function getTitlePropertyValue(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    Array.isArray((value as { title?: unknown }).title)
  ) {
    const titleParts = (value as { title: Array<{ plain_text?: unknown }> }).title

    return titleParts
      .map((part) => (typeof part.plain_text === 'string' ? part.plain_text : ''))
      .join('')
      .trim()
  }

  return ''
}

function getNumberPropertyValue(value: unknown): number | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'number' in value &&
    typeof (value as { number?: unknown }).number === 'number'
  ) {
    return (value as { number: number }).number
  }

  return null
}

function getDatePropertyValue(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'date' in value &&
    typeof (value as { date?: { start?: unknown } | null }).date?.start === 'string'
  ) {
    return (value as { date: { start: string } }).date.start
  }

  return null
}

function getCategoryPropertyValue(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const property = value as { select?: { name?: unknown } | null; status?: { name?: unknown } | null }
  const name = property.select?.name ?? property.status?.name

  return typeof name === 'string' && name.trim() ? name : null
}

function normalizeNotionExpensePage(
  page: unknown,
  selection: NotionExpenseQueryPropertySelection
): FinanceExpenseQueryEntry | null {
  if (typeof page !== 'object' || page === null || !('properties' in page)) {
    return null
  }

  const properties = (page as { properties?: Record<string, unknown> }).properties

  if (!properties) {
    return null
  }

  const amount = getNumberPropertyValue(properties[selection.amount])

  if (amount === null || !Number.isFinite(amount)) {
    return null
  }

  return {
    title: getTitlePropertyValue(properties[selection.title]) || 'expense',
    amount,
    date: getDatePropertyValue(properties[selection.date]),
    category: selection.category ? getCategoryPropertyValue(properties[selection.category.name]) : null,
  }
}

function buildNotionExpenseQueryFilter(
  selection: NotionExpenseQueryPropertySelection,
  input: QueryNotionExpensesInput
): Record<string, unknown> | undefined {
  const filters: Array<Record<string, unknown>> = []

  if (input.startIso) {
    filters.push({
      property: selection.date,
      date: {
        on_or_after: input.startIso,
      },
    })
  }

  if (input.endIso) {
    filters.push({
      property: selection.date,
      date: {
        before: input.endIso,
      },
    })
  }

  if (input.category && selection.category) {
    filters.push({
      property: selection.category.name,
      [selection.category.type]: {
        equals: input.category,
      },
    })
  }

  if (filters.length === 0) {
    return undefined
  }

  if (filters.length === 1) {
    return filters[0]
  }

  return {
    and: filters,
  }
}

function summarizeExpenseQueryEntries(entries: FinanceExpenseQueryEntry[]): FinanceExpenseQueryResult {
  const categorySummary = new Map<string, { total: number; count: number }>()
  const total = entries.reduce((sum, entry) => {
    const category = entry.category ?? 'Others'
    const existing = categorySummary.get(category) ?? { total: 0, count: 0 }

    categorySummary.set(category, {
      total: existing.total + entry.amount,
      count: existing.count + 1,
    })

    return sum + entry.amount
  }, 0)

  return {
    entries,
    total,
    categoryTotals: Array.from(categorySummary.entries())
      .map(([category, summary]) => ({
        category,
        total: summary.total,
        count: summary.count,
      }))
      .sort((a, b) => b.total - a.total),
  }
}

export async function parseExpenseLogWithLLM(params: CallFinanceParserParams): Promise<ParsedExpenseLog> {
  const allowedCategories = FINANCE_CATEGORIES.join(', ')
  const textForParsing = prepareFinanceTextForParsing(params.text)
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
- Interpret plain integers as their actual amount, never as cents. For example 10 is 10.00, 1000 is 1000.00, and 99999 is 99999.00.
- The user may write amount-first expenses like "10 for lunch", "10 lunch", or "12.90 uniqlo socks".
- Only parse clear SGD expense logs. Do not auto-convert or assume foreign currency is SGD.
- Do not merge multiple expenses into one row. If the message has multiple expenses, return is_expense false.
- Do not treat debts, loans, transfers, reimbursements, savings, budgets, income, or salary as expenses.
- If the message is not a clear expense log, return is_expense false with amount 0, expense "", category "Others".
- If there is no valid amount, return is_expense false with amount 0.
- Do not add markdown or commentary.`,
    chatMessages: [
      {
        role: 'user',
        content: textForParsing,
      },
    ],
    maxCompletionTokens: 120,
  })

  return applyDeterministicExpenseFallback(
    textForParsing,
    applyDeterministicAmount(textForParsing, validateParsedExpenseLog(parseExpenseJson(raw), params.localDate))
  )
}

export async function createNotionExpenseLog(input: CreateNotionExpenseLogInput): Promise<void> {
  const notionToken = process.env.NOTION_TOKEN
  const rawDatabaseId = process.env.NOTION_EXPENSES_DATABASE_ID

  if (!notionToken || !rawDatabaseId) {
    throw new NotionExpenseLogError({ category: 'missing_env' })
  }

  const databaseId = normalizeNotionDatabaseId(rawDatabaseId)
  const schema = await retrieveNotionDatabaseSchema({
    notionToken,
    databaseId,
  })
  const propertySelection = getNotionExpensePropertySelection(schema, input)
  logNotionExpensePropertiesSelected(propertySelection)
  const properties = buildNotionExpenseProperties(propertySelection, input)
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 1800)

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      signal: abortController.signal,
      headers: getNotionHeaders(notionToken),
      body: JSON.stringify({
        parent: {
          database_id: databaseId,
        },
        properties,
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

export async function queryNotionExpenses(input: QueryNotionExpensesInput): Promise<FinanceExpenseQueryResult> {
  const notionToken = process.env.NOTION_TOKEN
  const rawDatabaseId = process.env.NOTION_EXPENSES_DATABASE_ID

  if (!notionToken || !rawDatabaseId) {
    throw new NotionExpenseLogError({ category: 'missing_env' })
  }

  const databaseId = normalizeNotionDatabaseId(rawDatabaseId)
  const schema = await retrieveNotionDatabaseSchema({
    notionToken,
    databaseId,
  })
  const selection = getNotionExpenseQueryPropertySelection(schema)
  const filter = buildNotionExpenseQueryFilter(selection, input)
  const maxPages = input.maxPages ?? 5
  const entries: FinanceExpenseQueryEntry[] = []
  let startCursor: string | undefined

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 1800)

    try {
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        signal: abortController.signal,
        headers: getNotionHeaders(notionToken),
        body: JSON.stringify({
          page_size: Math.min(input.recentLimit ?? 100, 100),
          start_cursor: startCursor,
          filter,
          sorts: [
            {
              property: selection.date,
              direction: 'descending',
            },
          ],
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

      const data = (await response.json()) as {
        results?: unknown[]
        has_more?: unknown
        next_cursor?: unknown
      }
      const pageEntries = (data.results ?? [])
        .map((page) => normalizeNotionExpensePage(page, selection))
        .filter((entry): entry is FinanceExpenseQueryEntry => entry !== null)

      entries.push(...pageEntries)

      if (input.recentLimit && entries.length >= input.recentLimit) {
        return summarizeExpenseQueryEntries(entries.slice(0, input.recentLimit))
      }

      if (data.has_more !== true || typeof data.next_cursor !== 'string') {
        return summarizeExpenseQueryEntries(entries)
      }

      startCursor = data.next_cursor
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

  return summarizeExpenseQueryEntries(entries)
}

export function formatExpenseLoggedReply(expenseLog: ParsedExpenseLog): string {
  return `Logged: ${expenseLog.expense} — SGD ${expenseLog.amount.toFixed(2)} under ${expenseLog.category}.`
}
