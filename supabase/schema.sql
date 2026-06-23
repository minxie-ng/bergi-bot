create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null default 'telegram',
  telegram_chat_id bigint not null,
  reminder_text text not null,
  event_time timestamp with time zone,
  remind_at timestamp with time zone not null,
  timezone text not null default 'Asia/Singapore',
  status text not null default 'pending',
  source_message_content text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone
);

create index if not exists reminders_user_id_idx
on reminders(user_id);

create index if not exists reminders_pending_remind_at_idx
on reminders(status, remind_at);

alter table reminders enable row level security;
