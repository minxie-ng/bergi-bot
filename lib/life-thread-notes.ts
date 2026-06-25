import type { SupabaseClient } from '@supabase/supabase-js'

export type LifeThreadLabel = 'internship_progress' | 'bergi_product' | 'german_learning' | 'general_reflection'

export type LifeThreadNotePromptContext = {
  title: string | null
  summary: string
  open_question: string | null
  next_step: string | null
  thread_label: LifeThreadLabel | null
  raw_text: string
  created_at: string
}

const THREAD_LABEL_KEYWORDS: Record<Exclude<LifeThreadLabel, 'general_reflection'>, readonly string[]> = {
  internship_progress: [
    'internship',
    'work',
    'progress',
    'productive',
    'learned',
    'learn',
    'clearer',
    'stuck',
    'tomorrow easier',
    'boss',
    'report',
  ],
  bergi_product: [
    'bergi',
    'bot',
    'telegram',
    'proactive',
    'reminder',
    'cron',
    'supabase',
    'n8n',
    'notion',
    'memory',
    'product',
    'feature',
    'chatgpt',
    'claude',
    'moat',
  ],
  german_learning: ['german', 'deutsch', 'sentence', 'grammar', 'b1', 'b2', 'sprechen', 'lernen'],
}

type GetRecentLifeThreadNotesParams = {
  supabase: SupabaseClient
  userId: string
  limit?: number
}

type GetLifeThreadNotesForDateRangeParams = {
  supabase: SupabaseClient
  userId: string
  startIso: string
  endIso: string
  threadLabel?: LifeThreadLabel | null
}

export async function getRecentLifeThreadNotes(
  params: GetRecentLifeThreadNotesParams
): Promise<LifeThreadNotePromptContext[]> {
  const { supabase, userId, limit = 5 } = params
  const { data, error } = await supabase
    .from('life_thread_notes')
    .select('title, summary, open_question, next_step, thread_label, raw_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  return (data ?? []) as LifeThreadNotePromptContext[]
}

export async function getLifeThreadNotesForDateRange(
  params: GetLifeThreadNotesForDateRangeParams
): Promise<LifeThreadNotePromptContext[]> {
  let query = params.supabase
    .from('life_thread_notes')
    .select('title, summary, open_question, next_step, thread_label, raw_text, created_at')
    .eq('user_id', params.userId)
    .gte('created_at', params.startIso)
    .lt('created_at', params.endIso)
    .order('created_at', { ascending: true })

  if (params.threadLabel) {
    query = query.eq('thread_label', params.threadLabel)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data ?? []) as LifeThreadNotePromptContext[]
}

export function classifyLifeThreadLabel(input: {
  title?: string | null
  summary?: string | null
  openQuestion?: string | null
  nextStep?: string | null
  rawText?: string | null
}): LifeThreadLabel {
  const text = [input.title, input.summary, input.openQuestion, input.nextStep, input.rawText]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
  let bestLabel: LifeThreadLabel = 'general_reflection'
  let bestScore = 0

  for (const [label, keywords] of Object.entries(THREAD_LABEL_KEYWORDS) as Array<
    [Exclude<LifeThreadLabel, 'general_reflection'>, readonly string[]]
  >) {
    const score = keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0)

    if (score > bestScore) {
      bestLabel = label
      bestScore = score
    }
  }

  return bestScore > 0 ? bestLabel : 'general_reflection'
}
