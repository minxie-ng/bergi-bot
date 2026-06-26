create table if not exists public.pending_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null default 'telegram',
  telegram_chat_id bigint not null,
  title text not null,
  start_at timestamp with time zone not null,
  end_at timestamp with time zone not null,
  timezone text not null default 'Asia/Singapore',
  description text,
  status text not null default 'pending',
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists pending_calendar_events_user_chat_status_idx
on public.pending_calendar_events(user_id, platform, telegram_chat_id, status, expires_at);

create index if not exists pending_calendar_events_status_expires_at_idx
on public.pending_calendar_events(status, expires_at);

alter table public.pending_calendar_events enable row level security;
