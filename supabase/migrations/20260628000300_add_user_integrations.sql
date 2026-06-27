create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_account_email text,
  scopes text[] not null,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expiry timestamp with time zone,
  status text not null default 'connected',
  connected_at timestamp with time zone not null default now(),
  disconnected_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_integrations_user_provider_key unique (user_id, provider)
);

create index if not exists user_integrations_user_provider_idx
on public.user_integrations(user_id, provider);

create index if not exists user_integrations_provider_status_idx
on public.user_integrations(provider, status);

alter table public.user_integrations enable row level security;
