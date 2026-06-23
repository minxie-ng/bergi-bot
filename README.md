# Bergi Bot

## 1. Project overview

Bergi is a private Telegram AI companion bot for Min. It is built as a personal AI system with real backend persistence, access control, conversation memory, multimodal inputs, and reminder workflows.

Phase 0 currently supports:

- Private text chat through Telegram
- Voice message transcription
- Photo understanding, including caption/question handling
- Conversation memory stored in Supabase
- Per-user personality prompt loading from Supabase
- Organise mode for summaries, planning, cleanup, and structured next steps
- Reminder creation from explicit reminder requests
- Future event detection with reminder clarification
- Proactive reminder delivery through Supabase Cron
- Reminder listing, cancelling, and rescheduling
- Basic German reminder and future-event support

Bergi is not a public SaaS product. It is allowlist-only through Telegram user IDs so privacy and LLM/token usage stay controlled.

## 2. Architecture

Main components:

- **Telegram Bot API** receives messages from Min and sends Bergi's replies.
- **Next.js API route `/api/telegram`** handles Telegram webhook updates, access control, message persistence, reminder routing, voice/photo processing, and LLM replies.
- **Supabase database** stores users, Telegram account mappings, messages, profiles, and reminders.
- **OpenAI-compatible LLM provider** is used for chat, reminder/future-event parsing, reminder management intent parsing, and image understanding.
- **OpenAI Whisper-compatible transcription endpoint** is used for Telegram voice messages.
- **Supabase Cron + `pg_net`** calls `/api/cron/send-reminders` on a schedule to deliver due reminders.
- **Vercel** hosts the Next.js app and production API routes.

Primary routes:

- `app/api/telegram/route.ts` — Telegram webhook and main bot logic.
- `app/api/cron/send-reminders/route.ts` — cron endpoint for sending due reminders.

High-level Telegram flow:

1. Telegram sends a webhook update to `/api/telegram`.
2. Bergi checks the Telegram user ID against `ALLOWED_TELEGRAM_USER_IDS`.
3. Bergi finds or creates the internal Supabase user/account mapping.
4. The user message is saved to Supabase.
5. Text routing handles reminder list/cancel/reschedule, pending reminder preference replies, explicit reminders, and future event detection before falling back to normal chat.
6. Voice messages are downloaded and transcribed before normal chat handling.
7. Photos are downloaded and described by the vision-capable LLM before normal chat handling.
8. Recent message history and the user profile prompt are loaded from Supabase.
9. Bergi calls the LLM and sends a Telegram reply.
10. The assistant reply is saved to Supabase.

## 3. Environment variables

Real values should stay in `.env.local` or the deployment environment. Do not commit secrets.

```env
TELEGRAM_BOT_TOKEN=
ALLOWED_TELEGRAM_USER_IDS=

OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=

TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

LOCAL_TEST_MODE=
CRON_SECRET=
```

Notes:

- `ALLOWED_TELEGRAM_USER_IDS` is a comma-separated allowlist, for example `999999,123456789`.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in server-side route handlers and must never be exposed to frontend/client code.
- `LOCAL_TEST_MODE=true` skips Telegram sending and logs replies locally while still saving assistant messages.
- `CRON_SECRET` protects `/api/cron/send-reminders` and should be sent by the cron caller.

## 4. Supabase schema

Reminder schema is versioned in:

- `supabase/schema.sql`

Currently, only the reminder schema is saved there. The existing `users`, `user_accounts`, `messages`, and `user_profiles` tables must already exist in Supabase before running the bot.

The reminder schema includes:

- `reminders.id`
- `user_id`
- `platform`
- `telegram_chat_id`
- `reminder_text`
- `event_time`
- `remind_at`
- `timezone`
- `status`
- `source_message_content`
- `created_at`
- `updated_at`
- `sent_at`

It also enables useful extensions/indexes for reminders, Supabase Cron, and `pg_net`.

## 5. Reminder lifecycle

Reminder statuses used by the current app:

- `pending` — active reminder waiting to be sent by cron.
- `awaiting_reminder_preference` — future event was detected, but Bergi is waiting for Min to choose whether/when to be reminded.
- `sending` — cron has claimed a pending reminder and is attempting delivery.
- `sent` — reminder was delivered.
- `cancelled` — reminder or pending clarification was cancelled.
- `failed` — reminder delivery failed.

Important behavior:

- Cron only sends reminders with `status = pending` and `remind_at <= now`.
- `awaiting_reminder_preference` is clarification state and should not be sent by cron.
- Normal reminder list/cancel/reschedule only operates on active `pending` reminders.
- Reminder management is scoped to the current Telegram user and chat.
- Reschedule/cancel updates verify that a pending row was actually updated before replying with success.
- Explicit reminders and future-event clarification rows are guarded against past times server-side.

## 6. Local development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

For local webhook-style testing, set:

```env
LOCAL_TEST_MODE=true
```

Then send a fake Telegram update to:

```text
http://localhost:3000/api/telegram
```

In local test mode, Bergi should validate the allowlist, save user/assistant messages, call the LLM where needed, and log the reply without calling Telegram `sendMessage`.

Useful commands:

```bash
npm run build
npm run lint
```

## 7. Deployment checklist

Before considering a production deployment ready:

- Set all required environment variables in Vercel.
- Push the latest code to GitHub.
- Wait for the Vercel deployment status to become Ready.
- Confirm the Telegram webhook points to the production `/api/telegram` URL.
- Confirm Supabase Cron is scheduled to call `/api/cron/send-reminders`.
- Confirm the cron request includes the correct `CRON_SECRET`.
- Send a real Telegram smoke-test message from an allowlisted user.

## 8. Manual testing checklist

After deployment or reminder changes, manually test:

- Text chat receives a normal Bergi reply.
- Voice message is transcribed and answered.
- Photo with caption/question is understood and answered.
- Explicit reminder creation, for example `remind me to drink water in 10 minutes`.
- Future event detection followed by reminder clarification.
- `remind me now` resolves an awaiting reminder preference.
- `list reminders` shows active pending reminders.
- `cancel reminder 1` cancels an active reminder.
- Rescheduling an active reminder works.
- Cron sends a due reminder.

## 9. Known limitations

- Reminder management still partly uses routing heuristics before LLM parsing.
- Voice reminder commands may not yet go through the reminder pipeline.
- Photo-caption reminder commands may not yet go through the reminder pipeline.
- The n8n automation layer is not built yet.
- Telegram webhook secret-token verification is not yet implemented.
- Cron retry/recovery can be improved, especially for transient Telegram/API failures or stale `sending` rows.
- The full SQL migration set is not yet complete; only the reminder schema is currently versioned.
- Long-term/semantic memory is not implemented yet.
- There is no admin UI for managing profiles or allowlisted users yet.
