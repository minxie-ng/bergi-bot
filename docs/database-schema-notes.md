# Database Schema Notes

`supabase/schema.sql` is the current local schema snapshot for Bergi Core alpha.

Important current tables:

- `users`
- `user_accounts`
- `messages`
- `user_profiles`
- `reminders`
- `proactive_preferences`
- `proactive_checkins`
- `life_thread_notes`
- `pending_calendar_events`
- `user_feature_flags`
- `onboarding_state`
- `expenses`
- `pending_finance_confirmations`
- `user_integrations`
- `alpha_invites`

Important migrations:

- `20260626000100_create_pending_calendar_events.sql`
- `20260628000100_add_pending_calendar_all_day_fields.sql`
- `20260628000200_add_alpha_foundation.sql`
- `20260628000300_add_user_integrations.sql`
- `20260628000400_repair_pending_calendar_all_day_fields.sql`
- `20260628000500_add_alpha_invites.sql`
- `20260628000600_add_pending_finance_confirmations.sql`

Production notes:

- The pending Calendar all-day fields had a production repair migration after a schema mismatch.
- `pending_finance_confirmations` is required for durable confirmation of ambiguous finance messages.
- Apply migrations before testing the corresponding Telegram flows in production.
- No migration should drop or rewrite existing alpha data.
