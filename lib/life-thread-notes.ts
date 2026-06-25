import type { SupabaseClient } from '@supabase/supabase-js'

export type LifeThreadNotePromptContext = {
  title: string | null
  summary: string
  open_question: string | null
  next_step: string | null
  created_at: string
}

type GetRecentLifeThreadNotesParams = {
  supabase: SupabaseClient
  userId: string
  limit?: number
}

export async function getRecentLifeThreadNotes(
  params: GetRecentLifeThreadNotesParams
): Promise<LifeThreadNotePromptContext[]> {
  const { supabase, userId, limit = 5 } = params
  const { data, error } = await supabase
    .from('life_thread_notes')
    .select('title, summary, open_question, next_step, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  return (data ?? []) as LifeThreadNotePromptContext[]
}
