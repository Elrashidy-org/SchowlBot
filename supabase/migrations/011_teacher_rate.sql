begin;

-- Per-session pay rate for instructor payout runs (sessions * rate).
alter table public.teacher add column if not exists session_rate numeric(10, 2) not null default 0;

commit;
