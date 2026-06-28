create table if not exists public.alpha_invites (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'active',
  max_uses integer not null default 1,
  used_count integer not null default 0,
  invited_label text,
  created_by_user_id uuid references public.users(id) on delete set null,
  claimed_by_user_id uuid references public.users(id) on delete set null,
  claimed_by_telegram_user_id text,
  expires_at timestamp with time zone,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists alpha_invites_code_idx
on public.alpha_invites(code);

create index if not exists alpha_invites_status_idx
on public.alpha_invites(status);

create index if not exists alpha_invites_expires_at_idx
on public.alpha_invites(expires_at);

alter table public.alpha_invites enable row level security;
