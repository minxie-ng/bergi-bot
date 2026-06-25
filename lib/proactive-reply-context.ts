import { truncateText } from './text-utils'

type RecentProactiveCheckinPromptContext = {
  message_text: string | null
}

export function formatRecentProactiveCheckinForPrompt(checkin: RecentProactiveCheckinPromptContext | null): string {
  if (!checkin?.message_text) {
    return ''
  }

  return `Recent proactive check-in Bergi sent:
"${truncateText(checkin.message_text, 240)}"

The user's current message may be answering this check-in. If so, respond as if continuing that check-in naturally.
Keep the reply short. Prefer validating whether the reply counts as progress, reflection, or an answer to the check-in.
Good style: "that counts. something became clearer — that’s real progress." or "nice, that makes the next step less blurry."
Do not say "based on the proactive check-in", "your response to my check-in indicates", "database", or anything technical. Avoid long coaching frameworks.`
}
