import type { LifeThreadLabel, LifeThreadNotePromptContext } from './life-thread-notes'
import { truncateText } from './text-utils'

export function getLifeThreadNoteTitle(note: LifeThreadNotePromptContext): string {
  return note.title?.trim() || 'captured thought'
}

export function formatLifeThreadTopic(threadLabel: LifeThreadLabel | null): string {
  switch (threadLabel) {
    case 'internship_progress':
      return 'internship progress'
    case 'bergi_product':
      return 'bergi product building'
    case 'german_learning':
      return 'german learning'
    case 'general_reflection':
    case null:
      return 'general reflection'
  }
}

const LIFE_THREAD_NOTE_RECALL_STOPWORDS = new Set([
  'i',
  'me',
  'my',
  'the',
  'a',
  'an',
  'to',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'of',
  'in',
  'on',
  'for',
  'it',
  'this',
  'that',
  'like',
  'feel',
  'feels',
  'today',
  'still',
  'not',
  'how',
  'what',
  'why',
  'can',
])

function getLifeThreadRecallKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !LIFE_THREAD_NOTE_RECALL_STOPWORDS.has(word))

  return new Set(words)
}

function getLifeThreadNoteOverlapCount(currentKeywords: Set<string>, note: LifeThreadNotePromptContext): number {
  const noteKeywords = new Set<string>()
  const noteFields = [note.title ?? '', note.summary, note.open_question ?? '', note.next_step ?? '', note.raw_text]

  for (const field of noteFields) {
    for (const keyword of getLifeThreadRecallKeywords(field)) {
      noteKeywords.add(keyword)
    }
  }

  let overlapCount = 0

  for (const keyword of currentKeywords) {
    if (noteKeywords.has(keyword)) {
      overlapCount += 1
    }
  }

  return overlapCount
}

function scoreLifeThreadNoteRelevance(currentKeywords: Set<string>, note: LifeThreadNotePromptContext): number {
  const weightedFields = [
    { text: note.title ?? '', weight: 1 },
    { text: note.summary, weight: 2 },
    { text: note.open_question ?? '', weight: 1 },
    { text: note.next_step ?? '', weight: 1 },
    { text: note.raw_text, weight: 2 },
  ]
  let score = 0

  for (const field of weightedFields) {
    for (const keyword of getLifeThreadRecallKeywords(field.text)) {
      if (currentKeywords.has(keyword)) {
        score += field.weight
      }
    }
  }

  return score
}

export function findMostRelevantLifeThreadNote(
  currentText: string,
  notes: LifeThreadNotePromptContext[]
): LifeThreadNotePromptContext | null {
  const currentKeywords = getLifeThreadRecallKeywords(currentText)

  if (currentKeywords.size < 2) {
    return null
  }

  let bestNote: LifeThreadNotePromptContext | null = null
  let bestScore = 0
  let bestOverlapCount = 0

  for (const note of notes) {
    const overlapCount = getLifeThreadNoteOverlapCount(currentKeywords, note)
    const score = scoreLifeThreadNoteRelevance(currentKeywords, note)

    if (score > bestScore) {
      bestNote = note
      bestScore = score
      bestOverlapCount = overlapCount
    }
  }

  return bestOverlapCount >= 2 ? bestNote : null
}

export function formatRecentLifeThreadNotesForTelegram(notes: LifeThreadNotePromptContext[]): string {
  if (notes.length === 0) {
    return 'no captured notes yet — send a thought, then say “save this thought”.'
  }

  const noteLines = notes.map((note, index) => {
    const title = getLifeThreadNoteTitle(note)
    const summary = truncateText(note.summary, 180)

    return `${index + 1}. ${title}
${summary}`
  })

  return `latest notes:

${noteLines.join('\n\n')}`
}

export function formatNaturalMemorySummary(notes: LifeThreadNotePromptContext[]): string {
  if (notes.length === 0) {
    return 'i don’t have much captured yet. if something feels worth keeping, just say “save this thought” after telling me.'
  }

  const noteLines = notes.map((note, index) => {
    const title = getLifeThreadNoteTitle(note).toLowerCase()
    const summary = truncateText(note.summary, 190)

    return `${index + 1}. ${title}
${summary}`
  })

  return `recently, you’ve mainly been thinking about:

${noteLines.join('\n\n')}

that’s the main thread i’m seeing so far.`
}

export function formatMostRelevantLifeThreadNoteForPrompt(note: LifeThreadNotePromptContext | null): string {
  if (!note) {
    return ''
  }

  return `Most relevant remembered thought:
The user previously asked Bergi to keep track of this:
- Title: ${getLifeThreadNoteTitle(note)}
- Rough topic: ${formatLifeThreadTopic(note.thread_label)}
- Summary: ${truncateText(note.summary, 240)}
- Original wording excerpt: ${truncateText(note.raw_text, 280)}

A relevant remembered thought has already been selected for this user message.
When this block is present, start your reply with one short, natural callback to the remembered idea before giving advice or answering. Do not skip the callback.
The callback must appear in the first 1-2 lines and should sound like a friend remembering an earlier conversation.
Good: "yeah, this connects to what you said earlier about internship days passing fast and progress feeling invisible."
Bad: "according to your saved note..." "based on my memory..." "from the database..."
After the callback, keep the reply short. Give one simple reframe or one small question.
Avoid bullets/lists/frameworks unless Min explicitly asks for a template, checklist, or plan.`
}

export function formatRecentLifeThreadNotesForPrompt(notes: LifeThreadNotePromptContext[]): string {
  if (notes.length === 0) {
    return ''
  }

  const noteLines = notes.map((note, index) => {
    const title = getLifeThreadNoteTitle(note)
    const details = [
      note.summary,
      note.open_question ? `open question: ${note.open_question}` : null,
      note.next_step ? `next step: ${note.next_step}` : null,
    ]
      .filter(Boolean)
      .join(' ')

    return `${index + 1}. ${title} (${formatLifeThreadTopic(note.thread_label)}) — ${truncateText(details, 260)}`
  })

  return `Recent things Min asked me to keep track of:
${noteLines.join('\n')}

Recent captured notes are things Min explicitly asked Bergi to keep track of. Use them only when relevant.
If Min's current message clearly overlaps with one of these notes, briefly callback to the remembered idea near the start, in the first 1-2 lines, like a friend remembering an earlier conversation. After the callback, continue helping normally.
When a recent captured note is relevant, Bergi is a companion first, not a productivity coach by default. Do not turn the reply into a full framework immediately. Prefer a short conversational reply: one natural callback, one simple reframe, and one small question or next conversational step.
Use lists, templates, checklists, plans, or multi-step systems only if Min asks for structure or clearly needs step-by-step help. For emotionally uncertain messages, ask one grounding question instead of giving a complete system.
Do not over-answer, and do not end every helpful reply with "if you want, I can...". Keep casual/Singlish tone natural and light.
Do not announce memory mechanics. Do not say "according to your saved notes", "in my memory", "saved note", "database", "life_thread_notes", "memory context", or anything technical.
Do not force callbacks when relevance is weak. If the notes are not clearly relevant, ignore them completely.`
}
