# Bergi Roadmap

## Phase 0 — Current completed foundation

Phase 0 establishes Bergi Core as a working private Telegram AI companion.

Completed foundation:

- Next.js backend with Telegram webhook route at `/api/telegram`
- Telegram allowlist access control
- Supabase persistence for users, Telegram account mapping, messages, profiles, and reminders
- Recent conversation memory for LLM context
- Per-user personality prompt loading
- Text chat through an OpenAI-compatible LLM provider
- Voice message transcription through a Whisper-compatible endpoint
- Photo understanding through a vision-capable LLM
- Organise mode for planning, summarising, cleanup, and next steps
- Explicit reminder creation
- Future event detection and reminder clarification
- Reminder preference replies such as `10 mins before`, `remind me now`, and `no`
- Reminder list, cancel, and reschedule flows
- Supabase Cron delivery through `/api/cron/send-reminders`
- Basic German reminder and future-event support
- Reminder state-machine stabilisation for pending vs awaiting reminders
- Phase 0 README and reminder schema documentation

Phase 0 is not a polished product launch. It is a solid backend and product foundation.

## Phase 1 — Planning + n8n exploration prototype

Goal: define the hybrid product direction and test the automation layer without giving Bergi broad external power.

Focus:

- Document Bergi Core / Brain vs Bergi Tools / Hands boundaries.
- Explore n8n as the future automation layer.
- Build one or two isolated n8n proof-of-concept workflows.
- Keep external workflows manual or confirmation-gated.
- Decide how Bergi Core should call n8n safely.
- Identify what credentials, webhooks, and payload schemas are needed.

Possible prototypes:

- A local or test n8n webhook that accepts a proposed calendar event payload and returns a dry-run response.
- A workflow that formats a contact or task row for Google Sheets without writing real data yet.
- A read-only Gmail/Calendar exploration workflow if credentials are ready.

Success criteria:

- Clear architecture for how the Next.js backend will call n8n.
- Clear approval model before real external actions.
- No accidental external writes.
- No changes to Bergi's reminder schema unless separately planned.

## Phase 2 — Hybrid bridge between Bergi backend and n8n

Goal: connect Bergi Core to Bergi Tools through a narrow, safe bridge.

Focus:

- Add a backend-to-n8n integration path from Next.js.
- Define stable request/response payloads for tool proposals.
- Add confirmation state for pending external actions.
- Keep all identity, memory, chat routing, and safety checks in Bergi Core.
- Keep n8n workflows constrained to specific actions.

Example flow:

1. Min asks Bergi to add an event to Calendar.
2. Bergi extracts the event details and replies with a confirmation summary.
3. Min confirms.
4. Bergi Core sends a structured request to n8n.
5. n8n executes the external action and returns the result.
6. Bergi stores/sends the result back to Min.

Success criteria:

- External action requests are explicit and auditable.
- Bergi can call a limited n8n workflow after confirmation.
- Failed tool actions produce clear user-facing replies.

## Phase 3 — External tool actions like Calendar/Gmail

Goal: add practical, confirmation-gated external actions.

Priority candidates:

- Google Calendar: create events, possibly read upcoming events later.
- Gmail: draft replies or summarise selected emails before any sending behavior.
- Google Sheets / contacts: capture structured notes, contacts, or lightweight logs.
- Google Drive / Notion later: save organised notes or project summaries.

Safety rule:

- Bergi should not send emails, create calendar events, update sheets, or modify documents without clear confirmation from Min.

Recommended sequence:

1. Calendar event creation after confirmation.
2. Gmail draft creation or summary, not automatic send.
3. Sheets/contact append after confirmation.
4. Drive/Notion write actions after the approval model is proven.

## Phase 4 — Proactive companion features

Goal: move from reactive bot to useful proactive companion while staying safe.

Possible features:

- Morning or evening briefings.
- Upcoming reminder/event summaries.
- Gentle follow-ups on incomplete plans.
- Context-aware nudges based on reminders, calendar, or recent chat.
- German practice prompts tied to Min's real schedule or interests.

Guardrails:

- Proactive messages should be opt-in and easy to stop.
- Frequency should be conservative.
- Bergi should not create external actions proactively without confirmation.

## Phase 5 — Polish, German learning, demo packaging

Goal: make Bergi presentable as a portfolio-quality technical-depth project.

Focus:

- Improve README and docs for external reviewers.
- Add diagrams or screenshots of flows.
- Add a controlled demo script.
- Improve tests for routing and reminder helper behavior.
- Improve German support beyond reminders/events.
- Package the n8n hybrid architecture as a clear product story.
- Tighten security hardening such as Telegram webhook secret-token verification.

Demo packaging should show:

- Why custom code is needed for the brain/state layer.
- Why n8n is useful for tool execution.
- How confirmation keeps external actions safe.
- How Bergi feels personal rather than generic.

## What not to build yet

Avoid building these too early:

- Public user onboarding
- Billing or subscription features
- Broad multi-user admin UI
- Fully autonomous external actions
- Large plugin marketplace-style tool support
- Complex semantic memory before basic memory is reliable
- Full calendar/email sync before the confirmation model is proven
- Premature mobile/web frontend outside Telegram
- Heavy refactors that do not improve reliability or product direction
