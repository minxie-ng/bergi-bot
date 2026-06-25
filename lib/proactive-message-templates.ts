import type { LifeThreadNotePromptContext } from './life-thread-notes'

type ProactiveCheckinBlock = 'morning' | 'afternoon' | 'evening'
type ProactiveTemplateBank = Record<ProactiveCheckinBlock, Record<string, readonly string[]>>
type ProactiveContextCategory = 'internship_progress' | 'bergi_product' | 'german_learning'

const CONTEXT_AWARE_PROACTIVE_TEMPLATES: Record<ProactiveContextCategory, readonly string[]> = {
  internship_progress: [
    'small check-in — did anything become clearer, smaller, or easier today?',
    'quick internship check — what changed between this morning and now?',
    'tiny progress check: are you less stuck than earlier?',
  ],
  bergi_product: [
    'quick bergi thought — did anything become clearer about what makes it feel different from chatgpt?',
    'small product check — what part of bergi feels most alive so far?',
    'one bergi question: what still feels too generic?',
  ],
  german_learning: [
    'mini deutsch check — describe your day in one simple german sentence?',
    'quick german moment: one sentence about today, then i’ll correct only the main thing.',
  ],
}

const CONTEXT_CATEGORY_KEYWORDS: Record<ProactiveContextCategory, readonly string[]> = {
  internship_progress: [
    'internship',
    'progress',
    'productive',
    'learn',
    'learned',
    'stuck',
    'clearer',
    'tomorrow easier',
  ],
  bergi_product: ['bergi', 'chatgpt', 'moat', 'companion', 'product', 'feature', 'memory', 'proactive'],
  german_learning: ['german', 'deutsch', 'b1', 'sentence', 'practice', 'grammar'],
}

const PROACTIVE_CHECKIN_TEMPLATES: ProactiveTemplateBank = {
  morning: {
    morning_goal: [
      'morning min — what’s one thing you’d be happy to get done today?',
      'quick morning check-in: what kind of day are we aiming for?',
      'morning — what’s the main thing worth protecting time for today?',
      'before the day gets noisy, what do you want to make progress on?',
      'morning min — what would make today feel decently used?',
    ],
    morning_energy: [
      'morning check-in — energy okay, low, or still loading?',
      'how are we starting today: steady, sleepy, or chaotic?',
      'morning min — what pace feels realistic today?',
      'quick check-in: do you need a gentle start or a proper push today?',
      'morning — anything you need to make today feel less heavy?',
    ],
    morning_internship: [
      'morning — anything internship-related you want to keep in mind today?',
      'quick internship check-in: what’s one thing worth making clearer today?',
      'morning min — any work thing you want to handle before it piles up?',
      'before work mode kicks in, what would be useful to finish today?',
      'morning — what’s one small win you can aim for at work today?',
    ],
  },
  afternoon: {
    afternoon_progress: [
      'quick check-in — how’s the day actually going so far?',
      'midday check-in — what’s done, and what still needs attention?',
      'afternoon min — anything moving better than expected today?',
      'quick check-in: what still feels worth finishing today?',
      'small progress check — what’s one thing you can still move forward?',
    ],
    afternoon_reset: [
      'small reset: what’s one thing that still feels worth finishing today?',
      'quick reset — what can we simplify for the rest of today?',
      'afternoon check-in — anything you need to drop so the day feels lighter?',
      'pause for a sec: what’s the next useful thing, not the perfect thing?',
      'midday reset — what would make the next hour less messy?',
    ],
    afternoon_energy: [
      'midday check-in — energy high, low, or somewhere in between?',
      'afternoon min — how’s your brain battery doing?',
      'quick energy check: still okay, or need a reset?',
      'how’s the afternoon feeling — focused, tired, or scattered?',
      'quick check-in — do you need momentum or a breather right now?',
    ],
  },
  evening: {
    evening_reflection: [
      'end-of-day check-in: anything worth remembering from today?',
      'evening min — what’s one small thing that went okay today?',
      'quick evening check-in — what actually mattered today?',
      'before the day closes, what’s one thing you’re glad you did?',
      'evening — anything from today you want to keep, not lose?',
    ],
    evening_memory_capture: [
      'before the day disappears, anything you want me to remember?',
      'quick memory check — any detail from today worth saving?',
      'evening min — anything useful, funny, or annoying worth noting down?',
      'what’s one thing from today future-you might want to remember?',
      'before sleep mode, anything I should help you keep track of?',
    ],
    evening_wind_down: [
      'evening check-in — what would help you wind down a bit?',
      'quick wind-down check: anything still stuck in your head?',
      'evening min — do we need to park anything for tomorrow?',
      'before you switch off, anything that needs a tiny bit of closure?',
      'night-ish check-in — what can wait until tomorrow?',
    ],
  },
}

function isProactiveCheckinBlock(block: string): block is ProactiveCheckinBlock {
  return block in PROACTIVE_CHECKIN_TEMPLATES
}

function chooseRandomItem<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(Math.min(Math.max(random(), 0), 0.9999999999999999) * items.length)]
}

function getNoteSearchText(note: LifeThreadNotePromptContext): string {
  return [note.title, note.summary, note.open_question, note.next_step, note.raw_text]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function getContextCategoryScore(noteText: string, category: ProactiveContextCategory): number {
  return CONTEXT_CATEGORY_KEYWORDS[category].reduce(
    (score, keyword) => score + (noteText.includes(keyword) ? 1 : 0),
    0
  )
}

function findContextCategory(recentNotes: LifeThreadNotePromptContext[] = []): ProactiveContextCategory | null {
  let bestCategory: ProactiveContextCategory | null = null
  let bestScore = 0

  for (const note of recentNotes) {
    const noteText = getNoteSearchText(note)

    for (const category of Object.keys(CONTEXT_CATEGORY_KEYWORDS) as ProactiveContextCategory[]) {
      const score = getContextCategoryScore(noteText, category)

      if (score > bestScore) {
        bestCategory = category
        bestScore = score
      }
    }
  }

  return bestScore >= 2 ? bestCategory : null
}

export function selectProactiveCheckinMessage(params: {
  block: string
  recentMessages?: string[]
  recentNotes?: LifeThreadNotePromptContext[]
  random?: () => number
}): string {
  const random = params.random ?? Math.random
  const recentMessages = new Set(params.recentMessages ?? [])
  const contextCategory = findContextCategory(params.recentNotes)

  if (contextCategory) {
    const contextTemplates = CONTEXT_AWARE_PROACTIVE_TEMPLATES[contextCategory]
    const freshContextTemplates = contextTemplates.filter((template) => !recentMessages.has(template))

    return chooseRandomItem(freshContextTemplates.length > 0 ? freshContextTemplates : contextTemplates, random)
  }

  const templatesByCategory = isProactiveCheckinBlock(params.block)
    ? PROACTIVE_CHECKIN_TEMPLATES[params.block]
    : PROACTIVE_CHECKIN_TEMPLATES.afternoon
  const categories = Object.keys(templatesByCategory)
  const category = chooseRandomItem(categories, random)
  const templates = templatesByCategory[category]
  const freshTemplates = templates.filter((template) => !recentMessages.has(template))

  return chooseRandomItem(freshTemplates.length > 0 ? freshTemplates : templates, random)
}
