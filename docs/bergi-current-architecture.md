# Bergi Current Architecture

## 1. Product framing

Bergi is a Telegram-first AI companion and personal operator. The product direction is not to compete only on raw chat quality, but to build continuity: memory, proactive follow-up, reminders, personal workflows, and useful context that carries across days.

Bergi Core owns personality, memory, reminders, proactive check-ins, finance routing, calendar read/planning/create routing, and decision logic. Supabase is the source of truth for Bergi internal state. Notion is currently used as the finance storage layer for expenses. Google Calendar is currently used for schedule reads and confirmed event creation.

n8n is not active for finance logging anymore. The earlier Bergi Core -> n8n -> Notion finance prototype was removed. n8n may still be useful later for external automations such as Calendar, Gmail, Notion sync, or other tool workflows, but finance currently runs directly in Bergi Core.

## 2. Current working features

- Telegram text chat
- Voice transcription
- Photo understanding
- Reminders
- Proactive check-ins
- Context-aware proactive check-ins
- Proactive reply awareness
- Proactive reply progress capture
- Manual thought capture
- `life_thread_notes`
- `thread_label`
- Thread-aware recall
- Natural daily recap
- Direct Notion finance logging
- Text expense logging
- Voice expense logging
- Spoken-number voice finance support
- Finance validation and edge-case handling
- Finance query/read support from Notion
- Google Calendar schedule queries
- Google Calendar read-only planning suggestions
- Google Calendar confirmed event creation

## 3. Core architecture flow

High-level Telegram flow:

1. Telegram update arrives at `app/api/telegram/route.ts`.
2. Bergi parses message type: text, voice, photo, sticker, animation, or unsupported.
3. Bergi looks up or creates the user/account in Supabase.
4. Bergi saves the user message or derived transcript/context.
5. Bergi routes by deterministic intent before normal LLM chat:
   - Slash command
   - Pending calendar confirmation/change/cancel/clarification
   - Pending reminder clarification/cancel
   - Calendar create intent
   - Reminder management or creation
   - Finance query or logging
   - Calendar schedule query or planning
   - Thought capture
   - Daily recap
   - Memory recall
   - Proactive check-in control
   - Normal LLM chat
6. Bergi sends the Telegram reply.
7. Bergi saves the assistant reply in Supabase.

Normal LLM chat is the fallback path. Finance logging and finance reads must return early before normal chat when matched, so the model cannot pretend that a real action happened.

## 4. Supabase

Known tables and purpose:

- `users`: internal Bergi user records.
- `user_accounts`: external account mapping, currently Telegram user IDs to Bergi users.
- `messages`: saved Telegram user and assistant messages for context/history.
- `reminders`: reminder records, pending/sent/cancelled behavior, source text, and reminder timing.
- `proactive_preferences`: per-user proactive check-in settings such as enabled flag, chat ID, timezone, and daily ranges.
- `proactive_checkins`: generated proactive check-in schedule rows and sender state.
- `life_thread_notes`: captured thoughts and lightweight progress events.

`life_thread_notes` stores:

- Manual captured thoughts via `save this thought` / `/capture_this`.
- Proactive reply progress events.
- `thread_label`, currently used for rough topic grouping such as internship progress, Bergi product building, German learning, and general reflection.
- A DB-level idempotency guard: a unique partial index on non-null `source_message_id`.

Reminder pending clarification:

- If a reminder request has a date but no explicit time, Bergi asks for a time instead of defaulting to midnight.
- Pending missing-time reminders are stored in `reminders` with an awaiting status until the follow-up arrives.
- Time-only replies such as `3pm`, `3.42 pm`, `15:42`, and `1542` complete the pending reminder.
- Bergi sends a reminder success reply only after the Supabase row is successfully inserted or updated into an active pending reminder.
- `list reminders` reads the same active pending reminders that the sender cron uses.

Proactive system:

- Generator cron creates daily controlled-random rows.
- Sender cron claims due rows and sends Telegram messages.
- Main statuses include `scheduled`, `sending`, `sent`, and `failed`; paused rows may be marked `cancelled`.
- Context-aware proactive templates use recent life notes to select more relevant controlled templates, not full free-form LLM generation.

## 5. Notion finance integration

Active path:

Telegram -> Bergi Core -> finance detector/parser/validator -> Notion API

Removed path:

Telegram -> Bergi Core -> n8n -> Notion

Target database:

- All Expenses / All Expenses Master

Required environment variables:

- `NOTION_TOKEN`
- `NOTION_EXPENSES_DATABASE_ID`

Notion database properties are detected dynamically:

- Title property for expense name.
- Number property for amount.
- Date property.
- Category property if available.
- Source property if available.
- Comment/raw input property if available.

Direct Notion writes happen only after validation passes. Bergi only sends a `Logged:` success reply after Notion page creation succeeds.

## 6. Finance logging behavior

Supported examples:

- `spent 6.8 on chicken rice today`
- `10 for lunch`
- `spend 10for lunch with zach`
- Voice: "I spent ten dollars on lunch today"

Validation behavior:

- Foreign currency is unsupported for now. Bergi does not silently convert or log it as SGD.
- Suspicious high amounts ask for confirmation before creating a row.
- Corrected amounts can be logged after confirmation, using the same real Notion create path.
- Debts, loans, transfers, savings, budgets, and income are not logged as expenses.
- Multiple expenses in one message are not merged. Bergi asks the user to send them one by one.
- Finance query messages do not create rows.

## 7. Finance query behavior

Supported query examples:

- `how much did i spend today?`
- `what did i spend today?`
- `show my expenses today`
- `how much did i spend this week?`
- `what did i spend this month?`
- `summarise this month’s spending`
- `summarize this month's spending`
- `how much did i spend this year?`
- `what are my recent expenses?`
- `how much did i spend on food this month?`
- `what did i spend on transport this week?`

Finance query mode:

- Uses Notion as source of truth.
- Reads rows from All Expenses / All Expenses Master.
- Supports today, this week, this month, this year, and recent expenses.
- Supports category filters such as food or transport.
- Sums `Amount`.
- Groups by `Category` when useful.
- Handles Notion pagination up to the current MVP limit.
- Uses the user timezone from proactive preferences, with fallback `Asia/Singapore`.
- Does not create or update Notion rows.

## 8. Environment variables

Known environment variables currently used:

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_TELEGRAM_USER_IDS`
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_FALLBACK_MODEL`
- `TRANSCRIPTION_BASE_URL`
- `TRANSCRIPTION_API_KEY`
- `TRANSCRIPTION_MODEL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOCAL_TEST_MODE`
- `CRON_SECRET`
- `NOTION_TOKEN`
- `NOTION_EXPENSES_DATABASE_ID`
- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_CALENDAR_PRIVATE_KEY`
- `GOOGLE_CALENDAR_ID`

Never commit real secrets.

## 9. Google Calendar integration

Active path:

Telegram -> Bergi Core -> calendar intent detector -> Google Calendar API

Current status:

- Google Calendar read/query is working.
- Calendar Router V2 is working.
- Calendar read-only planning suggestions are working.
- Calendar V3 event creation is working through explicit confirmation.
- The current personal Bergi Core uses a Google service account for auth.
- Calendar reads use Google Calendar API `events.list`.
- Calendar writes use Google Calendar API `events.insert`.
- Bergi never creates an event from the first user message alone; it creates a pending draft first.
- Pending calendar draft edit/cancel works.
- Calendar confirmation loads the latest active stored pending draft, not stale in-memory data.
- End-time and duration parsing works for common create requests.
- Calendar event colour mapping works based on Min's personal calendar categories.
- No Google Calendar update, delete, accept, decline, or modify actions exist.

Auth approach:

- Server-side Google service account with Google Calendar Events scope.
- The target Google Calendar must be shared with the service account email.
- `GOOGLE_CALENDAR_ID` should point to the shared calendar ID, often the calendar owner's email address for a primary calendar.
- For event creation, the calendar sharing permission for the service account must be "Make changes to events".
- For read-only access only, "See all event details" is enough.
- The service account approach is for the current personal MVP. A product launch or multi-user version should use OAuth later.

Required environment variables:

- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_CALENDAR_PRIVATE_KEY`
- `GOOGLE_CALENDAR_ID`

### Calendar read/query

Supported query examples and periods:

- `what do i have today?`
- `what's my schedule today?`
- `what do i have tomorrow?`
- `anything this evening?`
- `what do i have this week?`
- `what do i have next week?`
- `summarise my week`
- `what's next on my calendar?`
- `what do i have next Monday?`
- `what do i have next fri?`
- `what do i have today or tomorrow?`
- `what do i hv tdy or tmr?`
- `am i busy next week?`
- `how busy am i next week?`

Calendar Router V2 supports:

- Today.
- Tomorrow.
- This evening.
- This week.
- Next week.
- Next event.
- Next Monday through next Sunday.
- Short weekday forms such as `next mon` and `next fri`.
- Combined today/tomorrow queries such as `today or tomorrow`, `tdy or tmr`, and `tmr or tdy`.
- Busy/free style next-week summaries that count events, group by day, and may estimate scheduled duration when event start/end times exist.

Calendar-ish unsupported or ambiguous queries are blocked from falling through to normal LLM chat. Bergi asks for a time-range clarification instead of saying it cannot access Calendar or answering from memory.

### Calendar planning

Calendar planning suggestions remain read-only and answer from Google Calendar results only. Planning does not create events.

Supported examples:

- `when am i free tomorrow?`
- `help me plan tomorrow`
- `do i have time to exercise tomorrow evening?`

### Calendar creation

Calendar V3 event creation supports:

- `add gym tomorrow 7pm`
- `add lunch with Zach Sunday 12pm to 1:30pm`
- `add meeting tomorrow 2-4pm`
- `add gym tomorrow 7pm to 8:30pm`
- `block 2 hours for Bergi this Saturday morning`
- `add work shift tomorrow 10am-6pm`
- `add IS class tomorrow 9-12pm`

Calendar event creation safety:

- First matching message creates only a pending draft.
- Bergi replies with a clear draft and asks for confirmation.
- Only short confirmation replies such as `yes`, `yea`, `confirm`, `add it`, or `looks good` create the event.
- The user can edit the pending draft before confirmation.
- Cancellation replies such as `no` or `cancel` clear the pending draft without creating an event.
- Missing or ambiguous date/time asks a clarification instead of creating a draft.
- Event creation uses `events.insert` only after confirmation.
- The success reply is sent only after Google Calendar `events.insert` succeeds.
- Confirmation inserts the stored `start_at` and `end_at` from the latest pending draft.
- No event should be created from the first message alone.
- No update/delete Calendar actions exist.

Supported time parsing:

- Explicit ranges such as `2-4pm`, `10am-6pm`, and `9-12pm`.
- `to` ranges such as `7pm to 8:30pm` and `from 8pm to 10pm`.
- Explicit durations such as `block 2 hours for Bergi this Saturday morning`.
- A default one-hour duration only when no end time or duration is provided.
- If an end time appears earlier than the start time and it is not clearly overnight, Bergi asks for clarification.

### Pending calendar events table

`pending_calendar_events` exists in Supabase and stores calendar event drafts before confirmation.

The table is used to prevent immediate unsafe event creation:

- Pending drafts are scoped to `user_id`, Telegram chat ID, and platform.
- Pending drafts expire after 20 minutes.
- Confirmation loads only the latest active pending event for the user/chat.
- When a draft is confirmed or cancelled, it is closed so old pending rows are not reused.
- Draft edit and missing-time completion update the stored pending row before asking for confirmation again.

### Calendar colour mapping

Google Calendar uses `colorId`, not raw colour names. The mapping is configurable in `lib/calendar-colors.ts`.

Current user mapping:

- Blue = class schedule / assignment.
- Green = CCA-related, SMUX trekking, Product Club.
- Red = work / internship.
- Yellow = admin stuff, deadlines, interviews.
- Purple = others / fun / personal.

Current initial Google Calendar `colorId` guesses:

- Blue -> `9`.
- Green -> `10`.
- Red -> `11`.
- Yellow -> `5`.
- Purple -> `3`.

These colour guesses may need tuning if Google Calendar's UI colours do not match Min's visual calendar perfectly.

### Routing priority

Current Telegram routing priority:

1. Pending calendar confirmation/change/cancel/clarification.
2. Pending reminder clarification/cancel.
3. Calendar create intent.
4. Reminder create/list/cancel.
5. Finance logging/query.
6. Calendar read/query/planning.
7. Thought/memory/daily recap.
8. Normal LLM chat.

## 10. Cron jobs

Current cron routes:

- Reminder sender cron: sends due reminders from Supabase.
- Proactive check-in generator cron: creates daily proactive check-in rows.
- Proactive check-in sender cron: sends due proactive check-ins.

Timezone expectation:

- Default is `Asia/Singapore`.
- User preference timezone is used where available.

## 11. Logging and privacy

Private webhook payload logging has been removed or redacted.

Logs should not include:

- Raw Telegram updates or full payloads.
- Raw user messages.
- Raw voice transcripts.
- Calendar event titles, descriptions, locations, attendees, or raw Calendar API responses.
- Notion tokens.
- Google service account credentials.
- Database IDs.
- Full Notion request payloads.
- Full prompt bodies.

Safe logs should use metadata only, such as candidate detection, status category, duration, count, transcript length, or safe error category.

Action success messages must be tied to real tool/database success:

- Calendar success messages happen only after Google Calendar API `events.insert` succeeds.
- Reminder success messages happen only after the Supabase reminder insert/update succeeds.
- Finance success messages happen only after the backing write succeeds, currently Notion for expense logging and Supabase where that path applies.

## 12. Current known limitations

- Finance supports SGD only for now.
- No multi-expense logging yet.
- No budgets yet.
- No multi-currency conversion yet.
- No charts or dashboard yet.
- No full Life Thread Engine yet.
- Calendar event creation only supports confirmed create; no update/delete/reschedule yet.
- No Gmail operator integration yet.
- n8n is not active for finance anymore.
- `app/api/telegram/route.ts` is partially modularized but still large and may need more refactor later.

## 13. Suggested next features, later

- Final finance audit.
- Current architecture prompt/context file for future agents.
- Gmail read-only operator layer.
- Calendar event update/delete/reschedule only after explicit confirmation and a separate safety design.
- Notion note sync if needed.
- Better memory correction/forget path later.
- Scheduled daily/weekly summaries later.
- Multi-currency finance later.

## 14. Important recent commits

- `2a3397b` Fix calendar confirmation stale draft.
- `0f502e5` Improve calendar event details.
- `57c3606` Fix calendar and reminder routing edge cases.
- `e7a6453` Fix pending calendar and reminder flows.
- `3d33cf5` Add pending calendar events table.
- `9f7c62b` Add calendar event creation confirmation.
- `3755798` Add calendar planning suggestions.
- `c6e04b1` Document calendar router v2.
- `a04f148` Improve calendar query routing.
- `6ff83c8` Add calendar read-only queries.
- `54a9e3e` Remove private webhook payload logging.
- `82782fa` Harden note idempotency.
- `255efaf` Extract memory recap helpers.
- `5e9ead7` Replace n8n finance hook with Notion logger.
- `53fcffd` Improve finance logging observability.
- `55538a6` Align finance logger with Notion schema.
- `3dfa495` Tighten finance expense validation.
- `9e1680a` Fix finance amount parsing.
- `50e2763` Route voice expenses to finance logger.
- `32f34bf` Fix voice finance routing.
- `011c10b` Add finance expense queries.
