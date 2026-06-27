import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  FinanceCategory,
  FinanceExpenseQueryResult,
  ParsedExpenseLog,
} from '@/lib/finance-logging'

type CreateSupabaseExpenseInput = {
  supabase: SupabaseClient
  userId: string
  expenseLog: ParsedExpenseLog
  rawText: string
  source: string
}

type QuerySupabaseExpensesInput = {
  supabase: SupabaseClient
  userId: string
  startIso?: string
  endIso?: string
  category?: FinanceCategory
  recentLimit?: number
}

type ExpenseRow = {
  merchant: string | null
  amount: number | string
  spent_at: string
  category: string | null
}

export async function createSupabaseExpense(input: CreateSupabaseExpenseInput): Promise<void> {
  const { error } = await input.supabase.from('expenses').insert({
    user_id: input.userId,
    amount: input.expenseLog.amount,
    currency: 'SGD',
    category: input.expenseLog.category,
    merchant: input.expenseLog.expense,
    note: input.expenseLog.comment,
    spent_at: input.expenseLog.date,
    source: input.source,
    raw_text: input.rawText,
  })

  if (error) {
    throw error
  }
}

export async function querySupabaseExpenses(input: QuerySupabaseExpensesInput): Promise<FinanceExpenseQueryResult> {
  let query = input.supabase
    .from('expenses')
    .select('merchant, amount, spent_at, category')
    .eq('user_id', input.userId)
    .order('spent_at', { ascending: false })

  if (input.startIso) {
    query = query.gte('spent_at', input.startIso)
  }

  if (input.endIso) {
    query = query.lt('spent_at', input.endIso)
  }

  if (input.category) {
    query = query.eq('category', input.category)
  }

  if (input.recentLimit) {
    query = query.limit(input.recentLimit)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return summarizeExpenseRows((data ?? []) as ExpenseRow[])
}

function summarizeExpenseRows(rows: ExpenseRow[]): FinanceExpenseQueryResult {
  const entries = rows.map((row) => ({
    title: row.merchant ?? 'Expense',
    amount: Number(row.amount),
    date: row.spent_at,
    category: row.category,
  }))
  const categoryMap = new Map<string, { category: string; total: number; count: number }>()
  let total = 0

  for (const entry of entries) {
    if (!Number.isFinite(entry.amount)) {
      continue
    }

    total += entry.amount

    const category = entry.category ?? 'Others'
    const existingCategory = categoryMap.get(category) ?? { category, total: 0, count: 0 }
    existingCategory.total += entry.amount
    existingCategory.count += 1
    categoryMap.set(category, existingCategory)
  }

  return {
    entries,
    total,
    categoryTotals: [...categoryMap.values()].sort((a, b) => b.total - a.total),
  }
}
