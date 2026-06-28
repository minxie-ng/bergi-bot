# Alpha Invite Links

Create short Telegram-safe invite codes manually in Supabase SQL Editor:

```sql
insert into alpha_invites (code, invited_label, max_uses, expires_at)
values ('alpha_friend1', 'Friend 1', 1, now() + interval '7 days');
```

Use only letters, numbers, underscores, and hyphens. Keep codes short for Telegram deep links.

Example invite link:

```text
https://t.me/Bergiii_bot?start=alpha_friend1
```

When a friend opens the link, Telegram sends `/start alpha_friend1`.
Bergi validates the invite, creates or finds that Telegram user account, claims the invite for that actual Telegram user, enables alpha-safe feature flags, and starts normal onboarding.

Alpha invite flags intentionally keep owner-only integrations off:

- `notion_enabled = false`
- `calendar_enabled = false` until Google OAuth is connected
- service-account Calendar is never enabled for invite users

Single-use invites move to `used` after claim. Existing claimed alpha users remain allowed through their `user_feature_flags.alpha_enabled` flag even after the invite itself is used.

For shared invites with `max_uses > 1`, access remains safe because each claimed user receives their own alpha feature flags. The invite row only stores the latest claimed user fields, so use one invite per friend when audit history matters.
