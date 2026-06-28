# Bergi Bot

## 1. Project overview

Bergi is a private Telegram-first AI companion and personal operator. It is live in a small private alpha with invite-based onboarding, real backend persistence, access control, conversation memory, multimodal inputs, reminders, proactive check-ins, finance logging, and Google Calendar workflows.

Current alpha supports:

- Private text chat through Telegram
- Invite-link onboarding through `/start`
- Voice message transcription and understanding
- Photo understanding, including caption/question handling
- Conversation memory stored in Supabase
- Per-user personality prompt loading from Supabase
- Reminder creation, listing, cancellation, rescheduling, and delivery
- Future event detection with reminder clarification
- Proactive check-ins with user controls
- Supabase finance logging and queries for alpha users
- Owner-only Notion finance for Min Xie
- Google Calendar OAuth for alpha users
- Owner-only Google service-account Calendar for Min Xie
- Basic German practice
- Slash commands including `/help`, `/privacy`, `/connect_calendar`, `/calendar_status`, and `/stop_checkins`

Bergi is not a public SaaS product. It is private-alpha only through Telegram allowlists and invite links so privacy and LLM/token usage stay controlled.

## 2. Architecture

Main components:

- **Telegram Bot API** receives messages and sends Bergi's replies.
- **Next.js API route `/api/telegram`** handles Telegram webhook updates, access control, invite onboarding, message persistence, reminder routing, finance routing, Calendar routing, voice/photo processing, and LLM replies.
- **Supabase database** is the source of truth for users, Telegram account mappings, messages, profiles, reminders, proactive check-ins, finance, onboarding, invites, and OAuth integrations.
- **OpenAI-compatible LLM provider** is used for chat, routing/parsing, reminder management intent parsing, image understanding, and structured summaries.
- **OpenAI Whisper-compatible transcription endpoint** is used for Telegram voice messages.
- **Supabase Cron + `pg_net`** calls cron routes for reminders and proactive check-ins.
- **Google Calendar API** is used through OAuth for alpha users and an owner-only service account for Min Xie.
- **Notion API** is used only for the owner finance path.
- **Vercel** hosts the Next.js app and production API routes.

Primary routes:

- `app/api/telegram/route.ts` — Telegram webhook and main bot logic.
- `app/api/cron/send-reminders/route.ts` — cron endpoint for sending due reminders.
- `app/api/cron/generate-proactive-checkins/route.ts` — cron endpoint for creating proactive check-in rows.
- `app/api/cron/send-proactive-checkins/route.ts` — cron endpoint for sending due proactive check-ins.
- `app/api/integrations/google/start/route.ts` — starts Google Calendar OAuth.
- `app/api/integrations/google/callback/route.ts` — handles Google Calendar OAuth callback.
- `app/api/integrations/google/disconnect/route.ts` — disconnects Google Calendar OAuth.

High-level Telegram flow:

1. Telegram sends a webhook update to `/api/telegram`.
2. Bergi checks whether the Telegram user is allowed directly or through an alpha invite.
3. Bergi finds or creates the internal Supabase user/account mapping.
4. The user message or derived transcript/context is saved to Supabase.
5. Deterministic routing handles slash commands, onboarding, pending confirmations, reminders, finance, Calendar, memory capture, proactive controls, and daily recaps before falling back to normal chat.
6. Voice messages are downloaded and transcribed before routing.
7. Photos are downloaded and described by the vision-capable LLM before routing.
8. Recent message history and the user profile prompt are loaded from Supabase for normal chat.
9. Bergi calls the LLM and sends a Telegram reply.
10. The assistant reply is saved to Supabase.

## 3. Environment variables

Real values should stay in `.env.local` or the deployment environment. Do not commit secrets.

```env
# Telegram runtime
TELEGRAM_BOT_TOKEN=
ALLOWED_TELEGRAM_USER_IDS=
# Required for owner-only Notion finance and service-account Calendar separation.
OWNER_TELEGRAM_USER_ID=

# Supabase server-side state
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAI-compatible chat model
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_FALLBACK_MODEL=

# Voice transcription
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=

# Cron routes
CRON_SECRET=

# Token encryption for OAuth tokens and signed state
TOKEN_ENCRYPTION_KEY=

# Google OAuth Calendar for non-owner alpha users
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.events

# Owner-only Notion finance
NOTION_TOKEN=
NOTION_EXPENSES_DATABASE_ID=

# Owner-only Google Calendar service account
GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL=
GOOGLE_CALENDAR_PRIVATE_KEY=
GOOGLE_CALENDAR_ID=

# Local development only
LOCAL_TEST_MODE=
```

Notes:

- `ALLOWED_TELEGRAM_USER_IDS` is a comma-separated allowlist, for example `999999,123456789`.
- Alpha invite users are also controlled through Supabase feature flags and invite state.
- `OWNER_TELEGRAM_USER_ID` gates owner-only Notion finance and owner service-account Calendar paths.
- Non-owner alpha Calendar uses Google OAuth only.
- Non-owner alpha finance uses Supabase only.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in server-side route handlers and must never be exposed to frontend/client code.
- `TOKEN_ENCRYPTION_KEY` is required before storing Google OAuth tokens.
- `LOCAL_TEST_MODE=true` skips Telegram sending and logs replies locally while still saving assistant messages.
- `CRON_SECRET` protects cron routes and should be sent by the cron caller.

## 4. Supabase schema

The current local schema snapshot is versioned in:

- `supabase/schema.sql`

It includes the core alpha tables:

- `users`
- `user_accounts`
- `messages`
- `user_profiles`
- `reminders`
- `proactive_preferences`
- `proactive_checkins`
- `user_feature_flags`
- `onboarding_state`
- `alpha_invites`
- `life_thread_notes`
- `pending_calendar_events`
- `expenses`
- `pending_finance_confirmations`
- `user_integrations`

`pending_finance_confirmations.telegram_chat_id` is currently `text` while several other Telegram chat ID columns are `bigint`. Do not change this silently in production; standardize later with an explicit migration if needed.

## 5. Reminder and proactive lifecycle

Reminder statuses used by the current app:

- `pending` — active reminder waiting to be sent by cron.
- `awaiting_reminder_preference` — future event was detected, but Bergi is waiting for the user to choose whether/when to be reminded.
- `sending` — cron has claimed a pending reminder and is attempting delivery.
- `sent` — reminder was delivered.
- `cancelled` — reminder or pending clarification was cancelled.
- `failed` — reminder delivery failed.

Important behavior:

- Cron only sends reminders with `status = pending` and `remind_at <= now`.
- `awaiting_reminder_preference` is clarification state and should not be sent by cron.
- Normal reminder list/cancel/reschedule only operates on active `pending` reminders scoped to the current Telegram user and chat.
- Explicit reminders and future-event clarification rows are guarded against past times server-side.
- Proactive check-ins are generated as scheduled rows, then claimed and sent by a separate cron route.
- `/stop_checkins`, pause, and resume controls update proactive preferences and queued check-ins.

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

In local test mode, Bergi should validate access, save user/assistant messages, call the LLM where needed, and log the reply without calling Telegram `sendMessage`.

Useful commands:

```bash
npm run lint
npm run build
```

## 7. Deployment checklist

Before considering a production deployment ready:

- Set all required environment variables in Vercel.
- Push the latest branch to GitHub and deploy through the configured production flow.
- Wait for the Vercel deployment status to become Ready.
- Confirm the Telegram webhook points to the production `/api/telegram` URL.
- Confirm Supabase Cron is scheduled to call `/api/cron/send-reminders`, `/api/cron/generate-proactive-checkins`, and `/api/cron/send-proactive-checkins` as intended.
- Confirm cron requests include the correct `CRON_SECRET`.
- Confirm owner-only env vars are present only where owner Notion finance or service-account Calendar should work.
- Send a real Telegram smoke-test message from an allowlisted or invited alpha user.

## 8. Manual testing checklist

After deployment or relevant changes, manually test:

- Invite onboarding through `/start` and invite links.
- `/help` and `/privacy` responses.
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
- Proactive check-in opt-in, `/stop_checkins`, and proactive delivery.
- Ambiguous finance messages ask for confirmation, then `yes` logs and `no` cancels.
- Non-owner finance writes and queries use Supabase only.
- Owner finance can still use Notion when owner flags and env are configured.
- `/connect_calendar` starts OAuth for alpha users.
- `/calendar_status` reflects OAuth connection state for alpha users.
- Non-owner Calendar reads/creates use OAuth only.
- Owner Calendar can still use the service-account path when configured.

## 9. Known limitations

- The Telegram route is large and should be split later, but not during risky live-alpha cleanup.
- Reminder, finance, and Calendar routing still partly use deterministic heuristics before LLM parsing.
- OAuth state is signed and short-lived, but one-time server-side nonce persistence is still a follow-up hardening item.
- Telegram webhook secret-token verification is not yet implemented.
- Cron retry/recovery can be improved, especially for transient Telegram/API failures or stale `sending` rows.
- Long-term semantic memory is not implemented yet.
- There is no admin UI for managing profiles, invites, feature flags, or allowlisted users yet.
