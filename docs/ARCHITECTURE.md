# Bergi Architecture

## Current architecture

Bergi currently runs as a private Telegram bot backed by a custom Next.js API and Supabase.

Core components:

- Telegram Bot API
- Next.js API route: `app/api/telegram/route.ts`
- Supabase database
- OpenAI-compatible LLM provider for chat, routing/parsing, and vision
- Whisper-compatible transcription endpoint for Telegram voice messages
- Supabase Cron + `pg_net`
- Next.js cron route: `app/api/cron/send-reminders/route.ts`
- Vercel deployment

Bergi Core owns the main brain/state layer: user identity, allowlist checks, message persistence, conversation context, profile prompt loading, reminder routing, and reminder state transitions.

## Telegram → Next.js → Supabase → LLM → Telegram flow

High-level flow for `/api/telegram`:

1. Telegram sends a webhook update to the Next.js route.
2. The route extracts Telegram user, chat, text, caption, voice, photo, sticker, or GIF details.
3. The Telegram user ID is checked against `ALLOWED_TELEGRAM_USER_IDS`.
4. Bergi finds or creates the internal Supabase user/account mapping.
5. The incoming message is saved to the `messages` table.
6. Text messages are routed through reminder management before normal chat:
   - list reminders
   - cancel reminders
   - reschedule reminders
   - latest awaiting reminder preference reply
   - explicit reminder creation
   - future event detection
   - normal chat / organise mode
7. Voice messages are downloaded from Telegram, transcribed, saved, and then answered through normal chat.
8. Photos are downloaded, described by a vision-capable LLM, saved with caption context if present, and then answered through normal chat.
9. Bergi loads recent messages and the user's profile/personality prompt from Supabase.
10. Bergi calls the OpenAI-compatible LLM provider.
11. Bergi sends the reply through Telegram unless `LOCAL_TEST_MODE=true`.
12. The assistant reply is saved to Supabase.

## Reminder cron flow

Reminder delivery is handled separately from the Telegram webhook.

High-level flow for `/api/cron/send-reminders`:

1. Supabase Cron calls the route on a schedule, using `pg_net`.
2. The route checks `CRON_SECRET`.
3. The route queries due reminders where:
   - `status = pending`
   - `remind_at <= now`
4. For each due reminder, cron attempts to claim it by changing `pending` to `sending`.
5. If the claim succeeds, Bergi sends the reminder through Telegram.
6. On success, the row is marked `sent` and `sent_at` is recorded.
7. On failure, the row is marked `failed`.

Reminder statuses currently used:

- `pending`
- `awaiting_reminder_preference`
- `sending`
- `sent`
- `cancelled`
- `failed`

Important reminder rules:

- Cron only sends `pending` reminders.
- `awaiting_reminder_preference` is a clarification state and should not be sent.
- Normal list/cancel/reschedule only operates on active `pending` reminders.
- Reminder management is scoped by Telegram user and chat.

## Future n8n hybrid architecture

The intended Phase 1+ direction is a hybrid architecture:

- **Bergi Core / Brain:** custom Next.js backend.
- **Bergi Tools / Hands:** n8n workflows for external tool execution.

Proposed future flow:

1. Min asks Bergi for an external action, such as creating a calendar event.
2. Bergi Core parses the request, checks context, and prepares a proposed action.
3. Bergi asks Min for confirmation in Telegram.
4. After explicit confirmation, Bergi Core sends a structured payload to an n8n webhook.
5. n8n executes a narrow workflow, such as Google Calendar event creation.
6. n8n returns a structured success/failure result.
7. Bergi Core sends the final result to Min and stores relevant context if needed.

This keeps reasoning, memory, and safety-sensitive state in code while allowing n8n to handle integrations and workflow execution.

## What stays in code

Keep these responsibilities in Bergi Core / Next.js:

- Telegram webhook handling
- Allowlist and identity mapping
- Conversation persistence
- User profile/personality loading
- Recent context selection
- LLM orchestration for chat and parsing
- Reminder state machine
- Reminder list/cancel/reschedule safety checks
- Confirmation state for external actions
- External action approval rules
- Tool request validation
- User-visible result handling
- Server-side secret boundaries for Bergi-owned providers

These areas need deterministic behavior, careful state validation, or tight coupling to conversation memory.

## What moves to n8n

Move narrow external integrations to n8n when the bridge is ready:

- Google Calendar actions
- Gmail draft/read workflows
- Google Sheets or contacts workflows
- Google Drive or Notion writes later
- Simple workflow orchestration around external APIs
- Credential-heavy third-party connectors that n8n handles well

n8n should receive structured requests from Bergi Core and return structured results. It should not become the owner of Bergi's personality, memory, reminder state machine, or safety decisions.

## Approval/safety model for external actions

External actions should follow a confirmation-first model:

1. Bergi identifies a possible action.
2. Bergi summarizes exactly what will happen.
3. Min confirms explicitly.
4. Bergi sends a constrained request to n8n.
5. n8n performs only the approved action.
6. Bergi reports the outcome.

Safety requirements:

- No calendar/email/sheets/contacts/drive/notion writes without confirmation.
- Prefer drafts or previews before irreversible actions.
- Validate action type, target, payload, and user/chat ownership in Bergi Core.
- Keep tool payloads narrow and explicit.
- Return clear errors when an action cannot be completed.
- Store enough context to avoid duplicate or confusing actions.

## Known limitations

Current limitations:

- Reminder routing still partly uses heuristics.
- Voice reminder commands may not yet go through the reminder pipeline.
- Photo-caption reminder commands may not yet go through the reminder pipeline.
- Telegram webhook secret-token verification is not yet implemented.
- Cron retry/recovery can be improved for transient failures and stale `sending` rows.
- Only the reminder schema is currently versioned in `supabase/schema.sql`.
- Full SQL migrations for users/messages/profiles are not yet committed.
- Long-term/semantic memory is not implemented yet.
- n8n automation is not built yet.

## Open decisions

Important decisions for Phase 1 and Phase 2:

- What exact payload format should Bergi Core send to n8n?
- Should n8n endpoints be one webhook per action type or one router webhook?
- Where should pending external action confirmations be stored?
- How long should pending external action confirmations remain valid?
- Which external action should be implemented first: Calendar event creation, Gmail draft, or Sheets/contact append?
- How should Bergi handle failed n8n workflows in Telegram?
- What audit trail is needed for external actions?
- When should voice/photo reminder commands enter the reminder pipeline?
- When should Telegram webhook secret-token verification be added?
