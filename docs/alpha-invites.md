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
