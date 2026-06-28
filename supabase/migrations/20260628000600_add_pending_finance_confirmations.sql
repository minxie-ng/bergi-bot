create table if not exists pending_finance_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  telegram_chat_id text,
  amount numeric not null,
  currency text not null default 'SGD',
  category text,
  merchant text,
  note text,
  raw_text text,
  spent_at timestamp with time zone not null default now(),
  status text not null default 'pending',
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists pending_finance_confirmations_user_chat_status_idx
on pending_finance_confirmations(user_id, telegram_chat_id, status, expires_at);

create index if not exists pending_finance_confirmations_status_expires_idx
on pending_finance_confirmations(status, expires_at);

alter table pending_finance_confirmations enable row level security;
