# Bergi Product Blueprint

## Product vision

Bergi is Min's private AI companion: a personal brain and trusted helper that lives in Telegram, understands everyday context, remembers useful conversation history, and can gradually connect to real-world tools with explicit approval.

The long-term direction is a hybrid system:

- **Bergi Core / Brain** — the custom backend that owns identity, conversation, memory, personality, reasoning, reminders, and safety-critical state.
- **Bergi Tools / Hands** — a future automation layer, likely starting with n8n, that executes external actions such as calendar, email, sheets, contacts, and document workflows only after confirmation.

The product should feel like a personal companion first, not a generic chatbot or automation dashboard.

## What Bergi is

Bergi is currently a private Telegram AI companion bot for Min with:

- Telegram text chat
- Supabase-backed conversation memory
- Per-user profile/personality prompts
- Voice transcription
- Photo understanding
- Organise mode for summaries, planning, cleanup, and next steps
- Explicit reminder creation
- Future event detection with reminder clarification
- Proactive reminder delivery through Supabase Cron
- Reminder listing, cancelling, and rescheduling
- Basic German reminder and future-event support

Bergi Core is implemented as a custom Next.js backend. It handles safe routing, memory, reminder state, and LLM calls directly in code.

## What Bergi is not

Bergi is not:

- A public SaaS product
- A generic multi-user chatbot platform
- A replacement for full calendar/email clients yet
- An automation agent that performs external actions without confirmation
- A fully autonomous assistant with broad tool permissions
- A polished consumer app UI
- A complete long-term memory or semantic retrieval system yet

For now, Bergi is intentionally Min-first and allowlist-only.

## Target user: Min first

The first and primary user is Min.

This is important because Bergi can optimize for a specific person's workflow, tone, languages, memory, routines, and projects instead of trying to generalize too early. A narrow target user also makes safety and product iteration easier: Bergi can be tested against real daily use without needing public onboarding, admin tooling, billing, or broad permissions.

## Core value proposition

Bergi helps Min turn everyday Telegram messages into useful support:

- Chat naturally without opening another app.
- Send voice notes and photos when text is inconvenient.
- Ask Bergi to organise messy thoughts into clear next steps.
- Create reminders from natural language.
- Mention future events and let Bergi ask whether to remind before them.
- Gradually connect to tools like Calendar, Gmail, Sheets, and contacts once the safety model is ready.

The immediate value is a private AI companion with memory and reminders. The future value is a trusted personal operating layer that understands context and can coordinate external tools safely.

## What makes Bergi hard to replicate

The defensible part is not only the LLM call. The harder-to-replicate parts are:

- Personal context accumulated over time in Supabase memory.
- A tone/personality tuned for Min rather than generic assistant style.
- The custom reminder and clarification state machine.
- Integration with real Telegram behavior: text, voice, photo, unsupported message types, and local test mode.
- A safe hybrid boundary between reasoning in code and future tool execution in n8n.
- German practice and multilingual support shaped around Min's actual learning.
- Product decisions based on real personal use instead of demo-only flows.

## Killer demo idea

A strong Phase 1/2 demo:

1. Min sends a messy voice note about a busy day.
2. Bergi transcribes it, organises it into priorities, and detects a future event.
3. Bergi asks whether Min wants a reminder before the event.
4. Min replies, “yes, remind me 15 mins before.”
5. Bergi creates the reminder and later sends it proactively through cron.
6. In the future hybrid version, Bergi can propose: “Want me to add this to Google Calendar?” and only create the event after Min confirms.

This demonstrates companion behavior, memory, multimodal input, reminders, proactive delivery, and the future action-confirmation model.

## Product principles

- **Min-first:** Build for one real user's actual workflow before generalizing.
- **Telegram-native:** Keep the main experience lightweight and conversational.
- **Useful before flashy:** Prioritize reliable reminders, memory, and organisation over broad tool demos.
- **State matters:** Treat reminders and future actions as state machines, not loose chat responses.
- **Small safe steps:** Add external capabilities incrementally and keep clear boundaries.
- **Plain-language UX:** Bergi should explain what it did and what it needs next without exposing internal complexity.
- **Multimodal by default:** Text, voice, and photo should feel like natural inputs to the same companion.
- **German as a product direction:** Use German practice in realistic daily contexts, not only isolated flashcards.

## Safety principles

- **Allowlist access first:** Bergi remains private unless there is a deliberate reason to expand.
- **Server-side secrets only:** Service role and provider keys stay in backend/deployment environments.
- **No external action without confirmation:** Calendar, Gmail, Sheets, contacts, Drive, or Notion actions must require explicit user approval.
- **Separate brain from hands:** Bergi Core decides and explains; n8n/tool workflows execute constrained actions.
- **Validate state before updates:** Reminder and future tool actions should verify IDs, ownership, chat scope, status, and timing.
- **Reject unsafe/past actions:** Past reminders and stale clarification state should not create surprising behavior.
- **Prefer reversible actions:** Early external integrations should start with drafts, proposals, or read-only summaries where possible.
- **Be transparent:** Bergi should clearly say when it created, cancelled, rescheduled, or failed to perform an action.
