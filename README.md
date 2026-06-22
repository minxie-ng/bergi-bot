# Bergi Bot

## 1. Project overview

Bergi Bot is a private Telegram AI companion that I am building as a personal portfolio and technical-depth project. The goal is not just to make a bot that replies to messages, but to explore what it takes to build a more personal AI system with memory, personality, access control, and real backend persistence.

Right now, Bergi runs through a Telegram webhook route and talks to an OpenAI-compatible LLM API. It can remember recent conversation context, load a per-user personality prompt from Supabase, and respond in a more consistent way than a basic stateless chatbot.

This is not a public SaaS product. It is meant for me (Min Xie) and maybe one trusted tester only. Access is controlled through a Telegram user ID allowlist so privacy and LLM token usage stay under control.

## 2. Why I built this

I built Bergi because I wanted a project that felt more real than another standard CRUD app or simple chatbot demo. I was interested in the technical pieces behind a personal AI companion: how to identify a user, store their messages, build short-term memory, load a personality profile, and pass useful context into an LLM without overcomplicating the first version.

The project is also a way for me to practice full-stack product thinking on a small but meaningful system. Bergi connects Telegram, a Next.js backend route, Supabase persistence, and an OpenAI-compatible LLM API into one working flow. It is still an MVP, but it already covers many of the backend concerns that real AI products need to handle.

## 3. Why the name ‘Bergi’?

The name Bergi has a few personal links for me.

First, it connects to German, which I am learning while building this project. In German, “Berg” means mountain. That fits me because I love hiking and trekking, so the mountain meaning feels personally relevant instead of random.

Bergi also sounds a bit like “pergi” in Malay, which means “go.” I like that because it gives the project a simple “just go / just do it” feeling. That matches how I approached this project: build the MVP, test the real flow, and keep improving it step by step.

## 4. Current architecture

Current request flow:

1. Telegram sends a webhook update to the Next.js route handler.
2. The route extracts the Telegram user, chat, and message text.
3. The Telegram user ID is checked against an allowlist.
4. The app finds or creates a Supabase user account mapping for the Telegram user.
5. The user message is saved to Supabase.
6. Recent messages for that user are fetched from Supabase.
7. Recent context is trimmed by character limit.
8. The user profile is loaded from Supabase to get Bergi's personality prompt.
9. The LLM is called through an OpenAI-compatible API endpoint.
10. In local test mode, the response is logged locally instead of being sent to Telegram.
11. Outside local test mode, the response is sent through the Telegram Bot API.
12. The assistant response is saved to Supabase.

Main route:

- `app/api/telegram/route.ts`

## 5. Current implemented features

- Telegram webhook route at `app/api/telegram/route.ts`
- Telegram update parsing for:
  - Telegram user ID
  - username
  - first name
  - last name
  - chat ID
  - text message
- Private allowlist access control using `ALLOWED_TELEGRAM_USER_IDS`
- Supabase persistence for:
  - users
  - user accounts
  - messages
  - user profiles
- Short-term memory:
  - saves user messages
  - fetches recent messages for the same user
  - trims recent context by character limit
  - sends recent chat history to the LLM
- Per-user personality:
  - loads `personality_prompt` from `user_profiles`
  - uses a fallback prompt if no profile exists
- Local testing mode:
  - `LOCAL_TEST_MODE=true` skips Telegram API sending
  - logs the LLM response locally
  - still saves assistant messages to Supabase
- Basic try/catch logging around the webhook flow

## 6. Tech stack

- Next.js
- TypeScript
- Supabase
- Telegram Bot API
- OpenAI-compatible LLM API through sub2api
- Vercel planned for deployment

Deployment is planned for Vercel, but the project is currently local-first because deployment is blocked by GitHub/network issues. Local testing works through `curl` with `LOCAL_TEST_MODE=true`.

## 7. Environment variables needed

The project expects these environment variables. Real values should stay in `.env.local` or the deployment environment and should not be committed.

```env
TELEGRAM_BOT_TOKEN=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_TELEGRAM_USER_IDS=
LOCAL_TEST_MODE=
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is used only in the backend route handler.
- The service role key must not be exposed to frontend/client code.
- `ALLOWED_TELEGRAM_USER_IDS` should be a comma-separated list, for example:

```env
ALLOWED_TELEGRAM_USER_IDS=999999,123456789
```

- `LOCAL_TEST_MODE=true` skips Telegram sending and logs the LLM response locally.

## 8. Local testing flow

Local testing is currently done with the Next.js dev server and a fake Telegram webhook payload. This lets me test the important backend flow even when Telegram delivery or deployment is not available.

1. Start the dev server:

```bash
npm run dev
```

2. Set local test mode in `.env.local`:

```env
LOCAL_TEST_MODE=true
```

3. Make sure the fake Telegram user ID used in the test payload is included in:

```env
ALLOWED_TELEGRAM_USER_IDS=
```

4. Send a local webhook-style request with `curl` to:

```text
http://localhost:3000/api/telegram
```

In local test mode, Bergi should:

- validate the allowlisted Telegram user ID
- save the user message to Supabase
- fetch recent message history
- load the user's personality prompt
- call the LLM
- log the LLM response locally
- save the assistant response to Supabase

It should not call the Telegram API while `LOCAL_TEST_MODE=true`.

## 9. Database schema overview

The current Supabase schema includes these tables:

### `users`

Stores internal Bergi users.

- `id`
- `created_at`

### `user_accounts`

Maps external platform accounts to internal users.

- `id`
- `user_id`
- `platform`
- `platform_user_id`
- `username`
- `first_name`
- `last_name`
- `created_at`

For Telegram, `platform` is stored as `telegram`, and `platform_user_id` is the Telegram `from.id` converted to a string.

### `messages`

Stores chat messages.

- `id`
- `user_id`
- `platform`
- `role`
- `content`
- `created_at`

Current roles are:

- `user`
- `assistant`

### `user_profiles`

Stores per-user Bergi personality configuration.

- `id`
- `user_id`
- `display_name`
- `preferred_language`
- `personality_prompt`
- `created_at`
- `updated_at`

For now, Min's profile row is inserted manually.

## 10. Current limitations

- Not deployed publicly yet.
- Vercel deployment is planned but currently blocked by GitHub/network issues.
- The bot is private and allowlist-only.
- No group chat support yet.
- No long-term memory or semantic memory yet.
- No onboarding flow for creating user profiles automatically.
- No admin UI for managing profiles or allowlisted users.
- Error handling is intentionally basic for the MVP.
- Recent memory is based on the latest stored messages and a character limit, not token counting.
- Telegram webhook verification/security hardening is not fully implemented yet.

## 11. Future roadmap

Possible next steps:

- Deploy to Vercel once GitHub/network issues are resolved.
- Configure the real Telegram webhook endpoint.
- Add a safer production configuration for local test mode and environment checks.
- Improve error logging and observability.
- Add profile onboarding so a user profile can be created without manual database insertion.
- Add long-term memory for important facts, preferences, and recurring context.
- Add better memory retrieval beyond simple recent-message history.
- Add simple admin tooling for managing allowlisted Telegram users.
- Add tests for helper functions like message trimming and allowlist parsing.
- Add webhook security checks where appropriate.
