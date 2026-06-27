alter table public.pending_calendar_events
add column if not exists is_all_day boolean not null default false,
add column if not exists all_day_date date;

create index if not exists pending_calendar_events_all_day_date_idx
on public.pending_calendar_events(all_day_date)
where is_all_day = true;
