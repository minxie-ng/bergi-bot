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

create table if not exists proactive_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null default 'telegram',
  telegram_chat_id bigint not null,
  enabled boolean not null default true,
  timezone text not null default 'Asia/Singapore',
  daily_min_messages integer not null default 2,
  daily_max_messages integer not null default 3,
  morning_start time not null default '08:00',
  morning_end time not null default '10:30',
  afternoon_start time not null default '13:00',
  afternoon_end time not null default '18:00',
  evening_start time not null default '19:00',
  evening_end time not null default '21:00',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint proactive_preferences_user_platform_chat_key unique (user_id, platform, telegram_chat_id)
);

create index if not exists proactive_preferences_user_chat_idx
on proactive_preferences(user_id, platform, telegram_chat_id);

alter table proactive_preferences enable row level security;

create table if not exists proactive_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null default 'telegram',
  telegram_chat_id bigint not null,
  scheduled_for timestamp with time zone not null,
  timezone text not null default 'Asia/Singapore',
  block text not null,
  status text not null default 'scheduled',
  message_type text not null default 'check_in',
  message_text text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists proactive_checkins_status_scheduled_for_idx
on proactive_checkins(status, scheduled_for);

create index if not exists proactive_checkins_user_id_scheduled_for_idx
on proactive_checkins(user_id, scheduled_for);

alter table proactive_checkins enable row level security;

create table if not exists life_thread_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_message_id uuid null references messages(id) on delete set null,
  title text,
  summary text not null,
  open_question text,
  next_step text,
  thread_label text,
  raw_text text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table life_thread_notes
add column if not exists thread_label text;

create index if not exists life_thread_notes_user_id_created_at_idx
on life_thread_notes(user_id, created_at desc);

create unique index if not exists life_thread_notes_source_message_id_unique
on life_thread_notes(source_message_id)
where source_message_id is not null;

alter table life_thread_notes enable row level security;
