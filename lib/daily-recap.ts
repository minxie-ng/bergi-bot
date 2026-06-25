import type { LifeThreadLabel, LifeThreadNotePromptContext } from './life-thread-notes'
import { formatLifeThreadTopic, getLifeThreadNoteTitle } from './memory-prompts'
import { truncateText } from './text-utils'

export function getDailyRecapThreadFilter(text: string): LifeThreadLabel | null {
  const normalized = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[?!.。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.includes('internship')) {
    return 'internship_progress'
  }

  if (normalized.includes('bergi') || normalized.includes('product')) {
    return 'bergi_product'
  }

  if (normalized.includes('german') || normalized.includes('deutsch')) {
    return 'german_learning'
  }

  return null
}

export function isDailyRecapRequest(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[?!.。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return (
    normalized === 'what progress did i make today' ||
    normalized === 'what changed today' ||
    normalized === 'what did i learn today' ||
    normalized === 'summarise today' ||
    normalized === 'summarize today' ||
    normalized === 'what happened today' ||
    normalized === 'what happened in my internship thread today' ||
    normalized === 'what changed in my bergi/product thread today' ||
    normalized === 'what changed in my bergi thread today' ||
    normalized === 'what changed in my product thread today'
  )
}

export function formatDailyRecapNotesForPrompt(notes: LifeThreadNotePromptContext[]): string {
  return notes
    .map((note, index) => {
      const source = note.summary.startsWith('Check-in reply:') ? 'progress event' : 'captured thought'

      return `${index + 1}. thread=${formatLifeThreadTopic(note.thread_label)}; source=${source}; title=${getLifeThreadNoteTitle(
        note
      )}; summary=${truncateText(note.summary, 240)}; raw_excerpt=${truncateText(note.raw_text, 220)}`
    })
    .join('\n')
}

export function getDailyRecapSystemPrompt(): string {
  return `You are Bergi, Min's AI companion. Write a short natural daily recap from saved notes/progress events.

Rules:
- Use only the provided notes. Do not invent progress.
- Group by natural thread names: internship, bergi, german, general.
- If there is only one note, say it simply and do not overstate.
- A small clarity win counts as progress if the notes support it.
- Sound like a friend reflecting the day back, not a report generator.
- Keep it short. Plain text only.
- Do not mention life_thread_notes, database, thread_label, SQL, implementation details, or "saved notes".`
}
