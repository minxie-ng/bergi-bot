create table if not exists public.user_feature_flags (
  user_id uuid primary key references public.users(id) on delete cascade,
  chat_enabled boolean not null default true,
  memory_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  voice_enabled boolean not null default true,
  photo_enabled boolean not null default true,
  proactive_enabled boolean not null default false,
  finance_enabled boolean not null default true,
  calendar_enabled boolean not null default false,
  notion_enabled boolean not null default false,
  alpha_enabled boolean not null default true,
  alpha_expires_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.user_feature_flags enable row level security;

create table if not exists public.onboarding_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text not null default 'not_started',
  preferred_name text,
  proactive_preference text,
  privacy_acknowledged_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.onboarding_state enable row level security;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric not null,
  currency text not null default 'SGD',
  category text,
  merchant text,
  note text,
  spent_at timestamp with time zone not null,
  source text,
  raw_text text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists expenses_user_spent_at_idx
on public.expenses(user_id, spent_at desc);

create index if not exists expenses_user_category_spent_at_idx
on public.expenses(user_id, category, spent_at desc);

alter table public.expenses enable row level security;

alter table public.proactive_preferences
alter column enabled set default false;
